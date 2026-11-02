import config from "../config";
import { getRedis } from "../db/redis";
import logger from "../utils/logger";

// Result of a single fixed-window consume: whether this hit is allowed plus the
// numbers needed to emit standard RateLimit-* / Retry-After response headers.
export interface ConsumeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSec: number;
}

// In-memory fallback window used when Redis is unavailable. Per-instance (not
// shared across workers), but it still protects a single node, important so
// auth endpoints are guarded even when REDIS_URL is unset or Redis is down.
interface MemWindow {
  count: number;
  resetAt: number; // epoch ms
}

class RateLimitService {
  // Per-instance store for the no-Redis path. Entries self-expire on access; a
  // size cap with a cheap sweep keeps it bounded under key churn (many IPs).
  private mem = new Map<string, MemWindow>();
  private static readonly MEM_MAX_KEYS = 50_000;

  /**
   * Generic fixed-window rate limiter for HTTP endpoints. Uses a Redis counter
   * when available (shared across all instances) and falls back to an in-memory
   * window otherwise. Unlike {@link allowEmailSend}, the no-Redis path does NOT
   * fail open, it enforces the limit in-process so protection never silently
   * disappears. Only a Redis *error* (not absence) fails open, to preserve
   * availability.
   */
  async consume(key: string, windowSec: number, max: number): Promise<ConsumeResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const redis = getRedis();

    if (redis) {
      try {
        const bucket = Math.floor(nowSec / windowSec);
        const redisKey = `rl:${key}:${bucket}`;
        const count = await redis.incr(redisKey);
        if (count === 1) await redis.expire(redisKey, windowSec + 1);
        const resetSec = (bucket + 1) * windowSec - nowSec;
        return {
          allowed: count <= max,
          limit: max,
          remaining: Math.max(0, max - count),
          resetSec: Math.max(1, resetSec),
        };
      } catch (err) {
        // Fail open on a Redis fault so an outage never blocks traffic.
        logger.warn(`rate limit (redis) failed, allowing: ${String(err)}`);
        return { allowed: true, limit: max, remaining: max, resetSec: windowSec };
      }
    }

    return this.consumeMemory(key, windowSec, max);
  }

  private consumeMemory(key: string, windowSec: number, max: number): ConsumeResult {
    const now = Date.now();
    let entry = this.mem.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowSec * 1000 };
      this.mem.set(key, entry);
    }
    entry.count += 1;

    if (this.mem.size > RateLimitService.MEM_MAX_KEYS) this.sweepMemory(now);

    return {
      allowed: entry.count <= max,
      limit: max,
      remaining: Math.max(0, max - entry.count),
      resetSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  // Drop expired windows; if still oversized, clear entirely (cheap, and only
  // ever hit under pathological key churn).
  private sweepMemory(now: number): void {
    for (const [k, v] of this.mem) {
      if (now >= v.resetAt) this.mem.delete(k);
    }
    if (this.mem.size > RateLimitService.MEM_MAX_KEYS) this.mem.clear();
  }

  // Two fixed-window (1s) Redis counters, BOTH must pass: a per-tenant cap
  // (capacity = base TPS x reputation multiplier, passed in by the mailer) and an
  // account-wide ceiling (EMAIL_ACCOUNT_TPS) across all tenants. Shared across
  // workers. Fails open: if Redis is unavailable the send is allowed, so a Redis
  // outage never blocks email.
  async allowEmailSend(tenantId: string, perTenantCapacity: number): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true;

    const windowSec = Math.floor(Date.now() / 1000);
    const accountCap = config.EMAIL_ACCOUNT_TPS;
    try {
      if (perTenantCapacity > 0) {
        const key = `rl:email:${tenantId}:${windowSec}`;
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, 2);
        if (count > perTenantCapacity) return false;
      }
      if (accountCap > 0) {
        const accountKey = `rl:email:account:${windowSec}`;
        const count = await redis.incr(accountKey);
        if (count === 1) await redis.expire(accountKey, 2);
        if (count > accountCap) return false;
      }
      return true;
    } catch (err) {
      logger.warn(`rate limit check failed (allowing): ${String(err)}`);
      return true;
    }
  }
}

export default new RateLimitService();
