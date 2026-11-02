import config from "../config";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import emailDomainsRepository, {
  EmailSendingDomainRow,
} from "../repositories/email-domains.repository";
import {
  computeDnsRecords,
  type DnsRecord,
  isApexDomain,
  mailFromFor,
  mapDomainStatus,
  normalizeSubdomain,
} from "../utils/email-dns";
import emailResolverService from "./email-resolver.service";
import emailSesClient from "./email-ses.client";
import engineService from "./engine.service";

const parseDnsRecords = (value: unknown): DnsRecord[] => {
  if (Array.isArray(value)) return value as DnsRecord[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as DnsRecord[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const present = (row: EmailSendingDomainRow) => ({
  ...row,
  dns_records: parseDnsRecords(row.dns_records),
});

class EmailDomainsService {
  async list(tenantId: string) {
    const rows = await emailDomainsRepository.listByTenant(tenantId);
    return rows.map(present);
  }

  async get(tenantId: string, id: string) {
    const row = await emailDomainsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Sending domain not found");
    return present(row);
  }

  // Onboard a new sending domain: create the SES config set + identity, set a
  // custom MAIL FROM, compute DNS records, and persist as PENDING. One domain
  // per tenant in V1.
  async onboard(tenantId: string, actorId: string, body: { subdomain?: string }) {
    let subdomain: string;
    try {
      subdomain = normalizeSubdomain(body.subdomain ?? "");
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : "Invalid domain");
    }

    const existing = await emailDomainsRepository.listByTenant(tenantId);
    if (existing.some((d) => d.status !== "DISABLED")) {
      throw new ConflictError("A sending domain is already configured for this workspace");
    }

    const configSet = await emailSesClient.ensureConfigurationSet(tenantId);
    const dkimTokens = await emailSesClient.createIdentity({ subdomain, configSet, tenantId });
    const mailFrom = mailFromFor(subdomain);
    await emailSesClient.putMailFrom(subdomain, mailFrom);
    const initial = await emailSesClient.getIdentity(subdomain);

    const dnsRecords = computeDnsRecords(subdomain, dkimTokens, config.AWS_SES_REGION);

    const row = await emailDomainsRepository.create({
      tenant_id: tenantId,
      subdomain,
      mail_from_subdomain: mailFrom,
      ses_configuration_set: configSet,
      dkim_status: initial.dkimStatus,
      mail_from_status: initial.mailFromStatus,
      dns_records: dnsRecords,
    });

    engineService.audit(tenantId, actorId, "email_domain.created", "email_sending_domain", row.id, {
      subdomain,
    });
    emailResolverService.invalidate(tenantId);

    return { ...present(row), apex: isApexDomain(subdomain) };
  }

  // Re-check verification status against SES and persist any transition.
  async check(tenantId: string, actorId: string, id: string) {
    const row = await emailDomainsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Sending domain not found");

    const status = await emailSesClient.getIdentity(row.subdomain);
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    const next = mapDomainStatus(status.dkimStatus, status.mailFromStatus, ageMs);

    const updated = await emailDomainsRepository.update(id, tenantId, {
      status: next,
      dkim_status: status.dkimStatus,
      mail_from_status: status.mailFromStatus,
      last_checked_at: new Date(),
      verified_at: next === "VERIFIED" ? (row.verified_at ?? new Date()) : row.verified_at,
    });

    if (next !== row.status && (next === "VERIFIED" || next === "FAILED")) {
      engineService.audit(tenantId, actorId, `email_domain.${next.toLowerCase()}`, "email_sending_domain", id, {
        subdomain: row.subdomain,
      });
    }
    emailResolverService.invalidate(tenantId);

    return present(updated);
  }

  // Lightweight health snapshot for the VERIFIED-state UI.
  async health(tenantId: string, id: string) {
    const row = await emailDomainsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Sending domain not found");
    return {
      id: row.id,
      subdomain: row.subdomain,
      status: row.status,
      dkim_status: row.dkim_status,
      mail_from_status: row.mail_from_status,
      verified_at: row.verified_at,
      last_checked_at: row.last_checked_at,
      dns_records: parseDnsRecords(row.dns_records),
    };
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const row = await emailDomainsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Sending domain not found");

    await emailSesClient.deleteIdentity(row.subdomain);
    await emailDomainsRepository.remove(id, tenantId);

    engineService.audit(tenantId, actorId, "email_domain.deleted", "email_sending_domain", id, {
      subdomain: row.subdomain,
    });
    emailResolverService.invalidate(tenantId);
    return { id };
  }
}

export default new EmailDomainsService();
