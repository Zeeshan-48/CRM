import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, email_templates } from "../db/types";

export type EmailTemplateRow = Selectable<email_templates>;

/** A resolved send target plus the fields its templates can merge in. */
export interface EmailRecipient {
  name: string;
  email: string | null;
  company: string | null;
}

export interface CreateEmailTemplateData {
  tenant_id: string;
  name: string;
  subject: string;
  body?: string | null;
  category?: string | null;
}

export interface UpdateEmailTemplateData {
  name: string;
  subject: string;
  body: string;
  category: string | null;
}

class EmailRepository {
  async listTemplates(tenantId: string): Promise<EmailTemplateRow[]> {
    return db
      .selectFrom("email_templates")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async findTemplateById(
    id: string,
    tenantId: string
  ): Promise<EmailTemplateRow | undefined> {
    return db
      .selectFrom("email_templates")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async updateTemplate(
    id: string,
    tenantId: string,
    data: UpdateEmailTemplateData
  ): Promise<EmailTemplateRow | undefined> {
    return db
      .updateTable("email_templates")
      .set({
        name: data.name,
        subject: data.subject,
        body: data.body,
        category: data.category,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteTemplate(id: string, tenantId: string): Promise<void> {
    await db
      .deleteFrom("email_templates")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  async createTemplate(
    data: CreateEmailTemplateData,
    trx?: Transaction<DB>
  ): Promise<EmailTemplateRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("email_templates")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        subject: data.subject,
        body: data.body ?? "",
        category: data.category ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async outboundEmailIds(tenantId: string): Promise<string[]> {
    const rows = await db
      .selectFrom("messages")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("channel", "=", "EMAIL")
      .where("direction", "=", "OUTBOUND")
      .execute();
    return rows.map((r) => r.id);
  }

  async countInboundEmails(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("messages")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .where("channel", "=", "EMAIL")
      .where("direction", "=", "INBOUND")
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // `company` feeds the `{company}` merge field. Leads have no company column,
  // so it is always null there and the token renders empty.
  async leadRecipient(
    tenantId: string,
    leadId: string
  ): Promise<EmailRecipient | undefined> {
    const row = await db
      .selectFrom("leads")
      .select(["name", "email"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", leadId)
      .executeTakeFirst();
    return row ? { ...row, company: null } : undefined;
  }

  async contactRecipient(
    tenantId: string,
    contactId: string
  ): Promise<EmailRecipient | undefined> {
    return db
      .selectFrom("contacts")
      .select(["name", "email", "company"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", contactId)
      .executeTakeFirst();
  }

  async tenantBrand(
    tenantId: string
  ): Promise<{ name: string; brand_color: string | null } | undefined> {
    return db
      .selectFrom("tenants")
      .select(["name", "brand_color"])
      .where("id", "=", tenantId)
      .executeTakeFirst();
  }

  async senderEmail(tenantId: string, userId: string): Promise<string | null> {
    const row = await db
      .selectFrom("users")
      .select(["email"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", userId)
      .executeTakeFirst();
    return row?.email ?? null;
  }
}

export default new EmailRepository();
