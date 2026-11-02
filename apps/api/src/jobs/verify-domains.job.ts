import { db } from "../db/connection";
import emailDomainsRepository from "../repositories/email-domains.repository";
import emailResolverService from "../services/email-resolver.service";
import emailSesClient from "../services/email-ses.client";
import { mapDomainStatus } from "../utils/email-dns";
import logger from "../utils/logger";

// Re-checks PENDING sending domains against SES and persists transitions. No-op
// when SES is not keyed (statuses stay PENDING). Scheduled by scheduler.ts.
export async function runVerifyDomains(): Promise<void> {
  if (!emailSesClient.isLive()) return;
  try {
    const pending = await db
      .selectFrom("email_sending_domains")
      .select(["id", "tenant_id", "subdomain", "status", "created_at"])
      .where("status", "=", "PENDING")
      .execute();

    for (const d of pending) {
      try {
        const s = await emailSesClient.getIdentity(d.subdomain);
        const ageMs = Date.now() - new Date(d.created_at).getTime();
        const next = mapDomainStatus(s.dkimStatus, s.mailFromStatus, ageMs);
        await emailDomainsRepository.update(d.id, d.tenant_id, {
          status: next,
          dkim_status: s.dkimStatus,
          mail_from_status: s.mailFromStatus,
          last_checked_at: new Date(),
          verified_at: next === "VERIFIED" ? new Date() : null,
        });
        if (next !== d.status) {
          emailResolverService.invalidate(d.tenant_id);
          logger.info(`verify poll: ${d.subdomain} ${d.status} -> ${next}`);
        }
      } catch (err) {
        logger.warn(`verify poll: ${d.subdomain} check failed: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`verify poll failed: ${String(err)}`);
  }
}
