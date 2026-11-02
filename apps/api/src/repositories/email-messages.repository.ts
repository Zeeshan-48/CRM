import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_category, email_message_status } from "../db/enums";
import type { email_messages } from "../db/types";

export type EmailMessageRow = Selectable<email_messages>;

export interface CreateEmailMessageData {
  tenant_id: string;
  category: email_category;
  sending_domain_id: string | null;
  sender_identity_id: string | null;
  from_address: string;
  to_address: string;
  subject: string | null;
  idempotency_key: string | null;
  status: email_message_status;
}

class EmailMessagesRepository {
  async create(data: CreateEmailMessageData): Promise<EmailMessageRow> {
    const now = new Date();
    return db
      .insertInto("email_messages")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        category: data.category,
        sending_domain_id: data.sending_domain_id,
        sender_identity_id: data.sender_identity_id,
        from_address: data.from_address,
        to_address: data.to_address,
        subject: data.subject,
        idempotency_key: data.idempotency_key,
        status: data.status,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Real engagement aggregate for a tenant, derived from the SES event pipeline
  // (delivered/opened/clicked timestamps + bounce status). `sent` counts only
  // messages SES actually accepted (excludes QUEUED/FAILED/SUPPRESSED/REJECTED).
  async engagementStats(tenantId: string): Promise<{
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
  }> {
    const row = await db
      .selectFrom("email_messages")
      .select((eb) => [
        eb.fn
          .count<number>("id")
          .filterWhere("status", "in", ["SENT", "DELIVERED", "BOUNCED", "COMPLAINED"])
          .as("sent"),
        eb.fn.count<number>("id").filterWhere("delivered_at", "is not", null).as("delivered"),
        eb.fn.count<number>("id").filterWhere("opened_at", "is not", null).as("opened"),
        eb.fn.count<number>("id").filterWhere("clicked_at", "is not", null).as("clicked"),
        eb.fn.count<number>("id").filterWhere("status", "=", "BOUNCED").as("bounced"),
      ])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return {
      sent: Number(row?.sent ?? 0),
      delivered: Number(row?.delivered ?? 0),
      opened: Number(row?.opened ?? 0),
      clicked: Number(row?.clicked ?? 0),
      bounced: Number(row?.bounced ?? 0),
    };
  }

  async markSent(id: string, sesMessageId: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ status: "SENT", ses_message_id: sesMessageId, updated_at: new Date() })
      .where("id", "=", id)
      .execute();
  }

  async markFailed(id: string, error: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ status: "FAILED", error: error.slice(0, 500), updated_at: new Date() })
      .where("id", "=", id)
      .execute();
  }

  // ---- Idempotent event updates (SQS is at-least-once: guard on the
  // timestamp being null so a redelivered event is a no-op). ----

  async markDelivered(id: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ status: "DELIVERED", delivered_at: new Date(), updated_at: new Date() })
      .where("id", "=", id)
      .where("delivered_at", "is", null)
      .execute();
  }

  // Returns true when this call actually transitioned the row (so a redelivered
  // SQS event does not double-count toward reputation).
  async markBounced(id: string): Promise<boolean> {
    const res = await db
      .updateTable("email_messages")
      .set({ status: "BOUNCED", bounced_at: new Date(), updated_at: new Date() })
      .where("id", "=", id)
      .where("bounced_at", "is", null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async markComplained(id: string): Promise<boolean> {
    const res = await db
      .updateTable("email_messages")
      .set({ status: "COMPLAINED", complained_at: new Date(), updated_at: new Date() })
      .where("id", "=", id)
      .where("complained_at", "is", null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async markOpened(id: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ opened_at: new Date(), updated_at: new Date() })
      .where("id", "=", id)
      .where("opened_at", "is", null)
      .execute();
  }

  async markClicked(id: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ clicked_at: new Date(), updated_at: new Date() })
      .where("id", "=", id)
      .where("clicked_at", "is", null)
      .execute();
  }

  async markRejected(id: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ status: "REJECTED", updated_at: new Date() })
      .where("id", "=", id)
      .where("status", "in", ["QUEUED", "SENT"])
      .execute();
  }

  async listByTenant(tenantId: string, limit = 100): Promise<EmailMessageRow[]> {
    return db
      .selectFrom("email_messages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  // Used by the SES events consumer (phase: events) to map an event back to a
  // row when mail tags are unavailable.
  async findBySesMessageId(sesMessageId: string): Promise<EmailMessageRow | undefined> {
    return db
      .selectFrom("email_messages")
      .selectAll()
      .where("ses_message_id", "=", sesMessageId)
      .executeTakeFirst();
  }
}

export default new EmailMessagesRepository();
