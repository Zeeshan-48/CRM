import { ulid } from "ulid";
import { db } from "../db/connection";

// Lookups + writes for inbound message ingestion (matching a sender to a
// lead/contact, deduping by provider id, and applying delivery status).
class InboundRepository {
  async findMessageByExternalId(
    tenantId: string,
    externalId: string
  ): Promise<{ id: string; direction: string } | undefined> {
    return db
      .selectFrom("messages")
      .select(["id", "direction"])
      .where("tenant_id", "=", tenantId)
      .where("external_id", "=", externalId)
      .executeTakeFirst();
  }

  async updateMessageStatus(tenantId: string, externalId: string, status: string): Promise<void> {
    await db
      .updateTable("messages")
      .set({ status, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("external_id", "=", externalId)
      .execute();
  }

  async leadByPhone(tenantId: string, phone: string): Promise<{ id: string } | undefined> {
    return db
      .selectFrom("leads")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("phone", "=", phone)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  async contactByPhone(tenantId: string, phone: string): Promise<{ id: string } | undefined> {
    return db
      .selectFrom("contacts")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("phone", "=", phone)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  async leadByEmail(tenantId: string, email: string): Promise<{ id: string } | undefined> {
    return db
      .selectFrom("leads")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where(db.fn("lower", ["email"]), "=", email.toLowerCase())
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  async contactByEmail(tenantId: string, email: string): Promise<{ id: string } | undefined> {
    return db
      .selectFrom("contacts")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where(db.fn("lower", ["email"]), "=", email.toLowerCase())
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  // Creates a minimal lead for an unknown inbound sender (source = the channel).
  async createLead(data: {
    tenant_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    source: string;
  }): Promise<{ id: string }> {
    const now = new Date();
    const row = await db
      .insertInto("leads")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name || "Unknown",
        email: data.email,
        phone: data.phone,
        source: data.source,
        status: "NEW",
        tags: JSON.stringify([]),
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    return row;
  }
}

export default new InboundRepository();
