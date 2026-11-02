import { getRedis } from "../db/redis";
import type { email_category } from "../db/enums";
import emailDomainsRepository from "../repositories/email-domains.repository";
import emailIdentitiesRepository from "../repositories/email-identities.repository";

export type ResolvedSender =
  | { mode: "legacy" }
  | {
      mode: "custom";
      fromAddress: string;
      displayName: string | null;
      replyTo: string | null;
      configurationSetName: string | null;
      sendingDomainId: string;
      senderIdentityId: string;
    };

const CACHE_TTL_SEC = 60;
const CATEGORIES: email_category[] = ["TRANSACTIONAL", "NOTIFICATION", "MARKETING"];

// Resolves the tenant's verified custom sending domain per category, cached in
// Redis (shared across workers, 60s TTL) and invalidated on any domain/identity
// change. Falls back to direct DB compute when Redis is unavailable, and to the
// legacy platform default when the tenant has no verified domain. Never throws.
class EmailResolverService {
  private key(tenantId: string, category: email_category): string {
    return `resolve:${tenantId}:${category}`;
  }

  invalidate(tenantId: string): void {
    const redis = getRedis();
    if (!redis) return;
    const keys = CATEGORIES.map((c) => this.key(tenantId, c));
    // Fire-and-forget: callers invalidate synchronously.
    void redis.del(...keys).catch(() => undefined);
  }

  async resolveSender(tenantId: string, category: email_category): Promise<ResolvedSender> {
    const redis = getRedis();
    const cacheKey = this.key(tenantId, category);

    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as ResolvedSender;
      } catch {
        // fall through to compute
      }
    }

    const value = await this.compute(tenantId, category);

    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(value), "EX", CACHE_TTL_SEC);
      } catch {
        // caching is best-effort
      }
    }
    return value;
  }

  private async compute(tenantId: string, category: email_category): Promise<ResolvedSender> {
    const identity = await emailIdentitiesRepository.findDefault(tenantId, category);
    if (!identity) return { mode: "legacy" };

    const domain = await emailDomainsRepository.findById(identity.sending_domain_id, tenantId);
    if (!domain || domain.status !== "VERIFIED") return { mode: "legacy" };

    return {
      mode: "custom",
      fromAddress: identity.email_address,
      displayName: identity.display_name,
      replyTo: identity.reply_to,
      configurationSetName: domain.ses_configuration_set,
      sendingDomainId: domain.id,
      senderIdentityId: identity.id,
    };
  }
}

export default new EmailResolverService();
