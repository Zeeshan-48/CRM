import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_domain_status } from "../db/enums";
import type { DB, email_sending_domains } from "../db/types";

export type EmailSendingDomainRow = Selectable<email_sending_domains>;

export interface CreateEmailDomainData {
  tenant_id: string;
  subdomain: string;
  mail_from_subdomain: string;
  ses_configuration_set: string;
  dkim_status: string | null;
  mail_from_status: string | null;
  dns_records: unknown;
}

export interface UpdateEmailDomainData {
  status?: email_domain_status;
  dkim_status?: string | null;
  mail_from_status?: string | null;
  verified_at?: Date | null;
  last_checked_at?: Date | null;
}

class EmailDomainsRepository {
  async create(data: CreateEmailDomainData, trx?: Transaction<DB>): Promise<EmailSendingDomainRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("email_sending_domains")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        subdomain: data.subdomain,
        mail_from_subdomain: data.mail_from_subdomain,
        ses_configuration_set: data.ses_configuration_set,
        status: "PENDING",
        dkim_status: data.dkim_status,
        mail_from_status: data.mail_from_status,
        dns_records: JSON.stringify(data.dns_records),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Resolve the tenant that owns a sending (sub)domain, used to route an
  // inbound email (addressed to that domain) to the right tenant's inbox.
  async tenantBySubdomain(subdomain: string): Promise<string | undefined> {
    const row = await db
      .selectFrom("email_sending_domains")
      .select(["tenant_id"])
      .where(db.fn("lower", ["subdomain"]), "=", subdomain.toLowerCase())
      .executeTakeFirst();
    return row?.tenant_id;
  }

  async listByTenant(tenantId: string): Promise<EmailSendingDomainRow[]> {
    return db
      .selectFrom("email_sending_domains")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async findById(id: string, tenantId: string): Promise<EmailSendingDomainRow | undefined> {
    return db
      .selectFrom("email_sending_domains")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findBySubdomain(
    tenantId: string,
    subdomain: string
  ): Promise<EmailSendingDomainRow | undefined> {
    return db
      .selectFrom("email_sending_domains")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("subdomain", "=", subdomain)
      .executeTakeFirst();
  }

  async update(
    id: string,
    tenantId: string,
    patch: UpdateEmailDomainData
  ): Promise<EmailSendingDomainRow> {
    return db
      .updateTable("email_sending_domains")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await db
      .deleteFrom("email_sending_domains")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }
}

export default new EmailDomainsRepository();
