import type { email_sending_status } from "../db/enums";
import { getRedis } from "../db/redis";
import emailReputationRepository from "../repositories/email-reputation.repository";
import logger from "../utils/logger";

export interface ReputationRates {
  sends: number;
  bounces: number;
  complaints: number;
  bounceRate: number;
  complaintRate: number;
}

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14-day rolling window
const KEY_TTL_SEC = Math.ceil(WINDOW_MS / 1000) + 3600;

// Act only once a tenant has meaningful volume, so a single early bounce does
// not pause a brand-new domain.
export const MIN_SENDS_FOR_ACTION = 100;

// Thresholds from the spec. A status is the worst tier whose bound is crossed.
const BOUNCE = { WARNING: 0.03, THROTTLED: 0.05, PAUSED: 0.08 };
const COMPLAINT = { WARNING: 0.0005, THROTTLED: 0.001, PAUSED: 0.003 };

// Maps rolling rates to a sending status. Returns ACTIVE below the action
// volume or when rates are clean.
export const tierFor = (rates: ReputationRates): email_sending_status => {
  if (rates.sends < MIN_SENDS_FOR_ACTION) return "ACTIVE";
  if (rates.bounceRate >= BOUNCE.PAUSED || rates.complaintRate >= COMPLAINT.PAUSED) return "PAUSED";
  if (rates.bounceRate >= BOUNCE.THROTTLED || rates.complaintRate >= COMPLAINT.THROTTLED)
    return "THROTTLED";
  if (rates.bounceRate >= BOUNCE.WARNING || rates.complaintRate >= COMPLAINT.WARNING)
    return "WARNING";
  return "ACTIVE";
};

const RANK: Record<email_sending_status, number> = {
  ACTIVE: 0,
  WARNING: 1,
  THROTTLED: 2,
  PAUSED: 3,
};
const ORDER: email_sending_status[] = ["ACTIVE", "WARNING", "THROTTLED", "PAUSED"];

// Wait this long after a status change before auto-recovering one level.
const RECOVERY_COOLDOWN_MS = 48 * 60 * 60 * 1000;

const reason = (r: ReputationRates): string =>
  `sends=${r.sends} bounceRate=${(r.bounceRate * 100).toFixed(2)}% complaintRate=${(r.complaintRate * 100).toFixed(3)}%`;

// Tracks per-tenant send/bounce/complaint counts in Redis sorted sets scored by
// timestamp, trimmed to a 14-day window. No-op (and rates null) without Redis.
// Also owns the throttle (degrade) and recovery (upgrade) transitions, which
// persist to tenants.email_sending_status and email_reputation_events.
class ReputationService {
  private key(kind: "sends" | "bounces" | "complaints", tenantId: string): string {
    return `rep:${kind}:${tenantId}`;
  }

  private async record(
    kind: "sends" | "bounces" | "complaints",
    tenantId: string,
    member: string
  ): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
      const now = Date.now();
      const key = this.key(kind, tenantId);
      await redis.zadd(key, now, `${member}:${now}`);
      await redis.zremrangebyscore(key, 0, now - WINDOW_MS);
      await redis.expire(key, KEY_TTL_SEC);
    } catch (err) {
      logger.warn(`reputation record(${kind}) failed: ${String(err)}`);
    }
  }

  recordSend(tenantId: string, messageId: string): Promise<void> {
    return this.record("sends", tenantId, messageId);
  }
  recordBounce(tenantId: string, messageId: string): Promise<void> {
    return this.record("bounces", tenantId, messageId);
  }
  recordComplaint(tenantId: string, messageId: string): Promise<void> {
    return this.record("complaints", tenantId, messageId);
  }

  async getRates(tenantId: string): Promise<ReputationRates | null> {
    const redis = getRedis();
    if (!redis) return null;
    try {
      const now = Date.now();
      const since = now - WINDOW_MS;
      const [sends, bounces, complaints] = await Promise.all([
        redis.zcount(this.key("sends", tenantId), since, now),
        redis.zcount(this.key("bounces", tenantId), since, now),
        redis.zcount(this.key("complaints", tenantId), since, now),
      ]);
      return {
        sends,
        bounces,
        complaints,
        bounceRate: sends ? bounces / sends : 0,
        complaintRate: sends ? complaints / sends : 0,
      };
    } catch (err) {
      logger.warn(`reputation getRates failed: ${String(err)}`);
      return null;
    }
  }

  // Degrade only: called after a bounce/complaint. Moves the tenant to a worse
  // tier immediately when rates cross a threshold; never recovers here.
  async evaluateAndApply(tenantId: string, trigger: string): Promise<void> {
    const rates = await this.getRates(tenantId);
    if (!rates) return;
    const target = tierFor(rates);
    const state = await emailReputationRepository.getTenantState(tenantId);
    if (!state) return;

    if (RANK[target] > RANK[state.email_sending_status]) {
      await emailReputationRepository.setTenantStatus(tenantId, target);
      await emailReputationRepository.recordEvent({
        tenantId,
        fromStatus: state.email_sending_status,
        toStatus: target,
        trigger,
        reason: reason(rates),
        ratesSnapshot: rates,
      });
      logger.warn(
        `reputation: tenant ${tenantId} ${state.email_sending_status} -> ${target} (${reason(rates)})`
      );
    }
  }

  // Recovery sweep: step WARNING/THROTTLED tenants up one level once the
  // cooldown has passed and rates have cleared. PAUSED is left for an admin.
  async recoverAll(): Promise<void> {
    const tenants = await emailReputationRepository.listRecoverable();
    const now = Date.now();
    for (const t of tenants) {
      const changedAt = t.email_sending_status_changed_at
        ? new Date(t.email_sending_status_changed_at).getTime()
        : 0;
      if (now - changedAt < RECOVERY_COOLDOWN_MS) continue;

      const rates = await this.getRates(t.id);
      if (!rates) continue;
      const target = tierFor(rates);
      if (RANK[target] >= RANK[t.email_sending_status]) continue; // not improved

      const next = ORDER[RANK[t.email_sending_status] - 1]; // one step toward ACTIVE
      await emailReputationRepository.setTenantStatus(t.id, next);
      await emailReputationRepository.recordEvent({
        tenantId: t.id,
        fromStatus: t.email_sending_status,
        toStatus: next,
        trigger: "recovery",
        reason: reason(rates),
        ratesSnapshot: rates,
      });
      logger.info(`reputation recovery: tenant ${t.id} ${t.email_sending_status} -> ${next}`);
    }
  }
}

export default new ReputationService();
