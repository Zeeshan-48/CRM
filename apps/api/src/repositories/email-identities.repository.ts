import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_category } from "../db/enums";
import type { DB, email_sender_identities } from "../db/types";

export type EmailSenderIdentityRow = Selectable<email_sender_identities>;

export interface CreateEmailIdentityData {
  tenant_id: string;
  sending_domain_id: string;
  email_address: string;
  display_name: string | null;
  reply_to: string | null;
  is_default_transactional: boolean;
  is_default_notification: boolean;
  is_default_marketing: boolean;
}

export interface UpdateEmailIdentityData {
  display_name?: string | null;
  reply_to?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
  is_default_transactional?: boolean;
  is_default_notification?: boolean;
  is_default_marketing?: boolean;
}

const defaultColumn = (category: email_category) =>
  category === "TRANSACTIONAL"
    ? "is_default_transactional"
    : category === "MARKETING"
      ? "is_default_marketing"
      : "is_default_notification";

class EmailIdentitiesRepository {
  async create(
    data: CreateEmailIdentityData,
    trx?: Transaction<DB>
  ): Promise<EmailSenderIdentityRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("email_sender_identities")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        sending_domain_id: data.sending_domain_id,
        email_address: data.email_address,
        display_name: data.display_name,
        reply_to: data.reply_to,
        status: "ACTIVE",
        is_default_transactional: data.is_default_transactional,
        is_default_notification: data.is_default_notification,
        is_default_marketing: data.is_default_marketing,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listByTenant(tenantId: string): Promise<EmailSenderIdentityRow[]> {
    return db
      .selectFrom("email_sender_identities")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async findById(id: string, tenantId: string): Promise<EmailSenderIdentityRow | undefined> {
    return db
      .selectFrom("email_sender_identities")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findByEmail(
    tenantId: string,
    email: string
  ): Promise<EmailSenderIdentityRow | undefined> {
    return db
      .selectFrom("email_sender_identities")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("email_address", "=", email)
      .executeTakeFirst();
  }

  // The ACTIVE default identity for a category, used by the send resolver.
  async findDefault(
    tenantId: string,
    category: email_category
  ): Promise<EmailSenderIdentityRow | undefined> {
    return db
      .selectFrom("email_sender_identities")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "ACTIVE")
      .where(defaultColumn(category), "=", true)
      .executeTakeFirst();
  }

  async update(
    id: string,
    tenantId: string,
    patch: UpdateEmailIdentityData,
    trx?: Transaction<DB>
  ): Promise<EmailSenderIdentityRow> {
    return (trx || db)
      .updateTable("email_sender_identities")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Clear an existing category default for the tenant (at most one default per
  // category). Runs inside the same transaction as the promotion.
  async clearDefault(
    tenantId: string,
    category: email_category,
    trx: Transaction<DB>
  ): Promise<void> {
    await trx
      .updateTable("email_sender_identities")
      .set({ [defaultColumn(category)]: false, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where(defaultColumn(category), "=", true)
      .execute();
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await db
      .deleteFrom("email_sender_identities")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }
}

export default new EmailIdentitiesRepository();
