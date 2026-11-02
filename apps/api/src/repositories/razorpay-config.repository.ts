import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { telephony_status } from "../db/enums";
import type { tenant_razorpay } from "../db/types";

export type TenantRazorpayRow = Selectable<tenant_razorpay>;

// BYO Razorpay config, one per tenant. Mirrors the telephony/whatsapp config
// repositories: the key secret is stored already encrypted by the service.
class RazorpayConfigRepository {
  async getConfig(tenantId: string): Promise<TenantRazorpayRow | undefined> {
    return db
      .selectFrom("tenant_razorpay")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async upsertConfig(data: {
    tenant_id: string;
    key_id: string;
    key_secret_encrypted: string;
  }): Promise<TenantRazorpayRow> {
    const existing = await this.getConfig(data.tenant_id);
    const now = new Date();
    if (existing) {
      return db
        .updateTable("tenant_razorpay")
        .set({
          key_id: data.key_id,
          key_secret_encrypted: data.key_secret_encrypted,
          // A credentials change invalidates prior validation.
          status: "PENDING",
          verified_at: null,
          last_error: null,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return db
      .insertInto("tenant_razorpay")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        provider: "RAZORPAY",
        key_id: data.key_id,
        key_secret_encrypted: data.key_secret_encrypted,
        status: "PENDING",
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateStatus(
    tenantId: string,
    patch: { status?: telephony_status; verified_at?: Date | null; last_error?: string | null }
  ): Promise<TenantRazorpayRow> {
    return db
      .updateTable("tenant_razorpay")
      .set({ ...patch, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async removeConfig(tenantId: string): Promise<void> {
    await db.deleteFrom("tenant_razorpay").where("tenant_id", "=", tenantId).execute();
  }
}

export default new RazorpayConfigRepository();
