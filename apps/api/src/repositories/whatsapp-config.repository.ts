import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { telephony_status } from "../db/enums";
import type { tenant_whatsapp } from "../db/types";

export type TenantWhatsappRow = Selectable<tenant_whatsapp>;

// BYO WhatsApp (Meta Cloud API) config, one per tenant. Mirrors the telephony
// config repository: secrets (access token + app secret) are stored already
// encrypted by the service layer.
class WhatsappConfigRepository {
  async getConfig(tenantId: string): Promise<TenantWhatsappRow | undefined> {
    return db
      .selectFrom("tenant_whatsapp")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  // Resolve a tenant from the per-tenant webhook token in the callback URL
  // (legacy per-tenant webhook path; kept for backward compatibility).
  async findByVerifyToken(token: string): Promise<TenantWhatsappRow | undefined> {
    if (!token) return undefined;
    return db
      .selectFrom("tenant_whatsapp")
      .selectAll()
      .where("webhook_verify_token", "=", token)
      .executeTakeFirst();
  }

  // Resolve a tenant from the WABA id in a webhook payload (entry[0].id). Used
  // by the shared Embedded-Signup webhook where one app callback serves every
  // connected WABA.
  async findByWabaId(wabaId: string): Promise<TenantWhatsappRow | undefined> {
    if (!wabaId) return undefined;
    return db
      .selectFrom("tenant_whatsapp")
      .selectAll()
      .where("waba_id", "=", wabaId)
      .executeTakeFirst();
  }

  // Upsert a tenant's WhatsApp account from an Embedded Signup onboarding. The
  // access token + registration PIN arrive already encrypted from the service.
  async upsertEmbedded(data: {
    tenant_id: string;
    waba_id: string;
    phone_number_id: string;
    business_id: string | null;
    access_token_encrypted: string;
    registration_pin_encrypted: string | null;
    display_phone_number: string | null;
    verified_name: string | null;
    status: telephony_status;
  }): Promise<TenantWhatsappRow> {
    const existing = await this.getConfig(data.tenant_id);
    const now = new Date();
    const shared = {
      provider: "META",
      connect_method: "EMBEDDED",
      waba_id: data.waba_id,
      phone_number_id: data.phone_number_id,
      business_id: data.business_id,
      access_token_encrypted: data.access_token_encrypted,
      registration_pin_encrypted: data.registration_pin_encrypted,
      display_phone_number: data.display_phone_number,
      verified_name: data.verified_name,
      status: data.status,
      verified_at: data.status === "ACTIVE" ? now : null,
      last_error: null,
      updated_at: now,
    };
    if (existing) {
      return db
        .updateTable("tenant_whatsapp")
        .set(shared)
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return db
      .insertInto("tenant_whatsapp")
      .values({ id: ulid(), tenant_id: data.tenant_id, created_at: now, ...shared })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateStatus(
    tenantId: string,
    patch: {
      status?: telephony_status;
      verified_at?: Date | null;
      last_error?: string | null;
      display_phone_number?: string | null;
      verified_name?: string | null;
    }
  ): Promise<TenantWhatsappRow> {
    return db
      .updateTable("tenant_whatsapp")
      .set({ ...patch, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async removeConfig(tenantId: string): Promise<void> {
    await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
  }

  // ---- Recipient lookup (used by the send paths in Phase 1) ----
  async recipientPhone(
    tenantId: string,
    ref: { leadId?: string | null; contactId?: string | null }
  ): Promise<{ name: string; phone: string | null } | undefined> {
    if (ref.leadId) {
      return db
        .selectFrom("leads")
        .select(["name", "phone"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", ref.leadId)
        .executeTakeFirst();
    }
    if (ref.contactId) {
      return db
        .selectFrom("contacts")
        .select(["name", "phone"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", ref.contactId)
        .executeTakeFirst();
    }
    return undefined;
  }
}

export default new WhatsappConfigRepository();
