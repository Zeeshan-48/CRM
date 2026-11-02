import { db } from "../db/connection";
import telephonyNumbersRepository from "../repositories/telephony-numbers.repository";
import telephonyRepository from "../repositories/telephony.repository";
import { normalizePhone } from "../utils/phone";

// Who should pick up an inbound call, and when outbound calling is allowed.
//
// The routing brain is deliberately separate from the webhook plumbing so the
// priority order (dedicated number > sticky agent > least-recently-called) is
// unit-testable without HTTP, and so the webhook handler stays inside Exotel's
// 5-second dynamic-URL budget: every helper here is one indexed query.

export interface RoutingDecision {
  userId: string | null;
  phone: string | null;
  exhausted: boolean;
}

// TRAI's permitted window for commercial calls to Indian numbers, fixed to IST
// regardless of the tenant's own timezone: it is the callee's regulator that
// matters, not the caller's workday.
const TRAI_START_MIN = 9 * 60;
const TRAI_END_MIN = 21 * 60;

class TelephonyRoutingService {
  isWithinTraiWindow(at: Date = new Date()): boolean {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const mins = hour * 60 + minute;
    return mins >= TRAI_START_MIN && mins < TRAI_END_MIN;
  }

  /**
   * Picks ONE agent per invocation (one Connect dial attempt). The webhook
   * stores each pick in the call row's structured_data and passes them back as
   * excludeUserIds on every fetch_after_attempt re-fetch, which is what turns
   * repeated calls to this method into a clean no-answer cascade.
   */
  async pickNextAgent(
    tenantId: string,
    opts: {
      leadId: string | null;
      calledNumber: string;
      excludeUserIds: string[];
    }
  ): Promise<RoutingDecision> {
    const exclude = new Set(opts.excludeUserIds);

    // 1. Dedicated number: a call to an agent's own ExoPhone is FOR that agent.
    const dialed = await telephonyNumbersRepository.findByPhone(
      tenantId,
      normalizePhone(opts.calledNumber)
    );
    if (dialed?.kind === "AGENT" && dialed.assigned_user_id && !exclude.has(dialed.assigned_user_id)) {
      const phone = await this.eligiblePhone(tenantId, dialed.assigned_user_id);
      if (phone) return { userId: dialed.assigned_user_id, phone, exhausted: false };
    }

    // 2. Sticky agent: continuity beats fairness. The person who owns the lead
    // (or last finished a call with them) already has the context.
    if (opts.leadId) {
      const stickyId = await this.stickyAgentId(tenantId, opts.leadId);
      if (stickyId && !exclude.has(stickyId)) {
        const phone = await this.eligiblePhone(tenantId, stickyId);
        if (phone) return { userId: stickyId, phone, exhausted: false };
      }
    }

    // 3. Least-recently-called round-robin among everyone eligible.
    const ranked = await telephonyRepository.eligibleAgents(tenantId, [...exclude]);
    const next = ranked[0];
    if (!next) return { userId: null, phone: null, exhausted: true };
    return { userId: next.id, phone: normalizePhone(next.phone), exhausted: false };
  }

  private async stickyAgentId(tenantId: string, leadId: string): Promise<string | null> {
    const lead = await db
      .selectFrom("leads")
      .select(["owner_id"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", leadId)
      .executeTakeFirst();
    if (lead?.owner_id) return lead.owner_id;
    return telephonyRepository.lastCompletedAgentForLead(tenantId, leadId);
  }

  // An agent is only ring-able when ACTIVE, available, and has a phone linked.
  private async eligiblePhone(tenantId: string, userId: string): Promise<string | null> {
    const row = await db
      .selectFrom("users")
      .select(["phone"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", userId)
      .where("status", "=", "ACTIVE")
      .where("available_for_calls", "=", true)
      .where("phone", "is not", null)
      .executeTakeFirst();
    return row?.phone ? normalizePhone(row.phone) : null;
  }
}

export default new TelephonyRoutingService();
