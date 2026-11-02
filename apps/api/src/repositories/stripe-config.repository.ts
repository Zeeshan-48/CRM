import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { telephony_status } from "../db/enums";
import type { tenant_stripe } from "../db/types";

export type TenantStripeRow = Selectable<tenant_stripe>;

// BYO Stripe config, one per tenant. Mirrors the razorpay config repository; the
// secret key is stored already encrypted by the service.
class StripeConfigRepository {
  async getConfig(tenantId: string): Promise<TenantStripeRow | undefined> {
    return db
      .selectFrom("tenant_stripe")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async upsertConfig(data: {
    tenant_id: string;
    secret_key_encrypted: string;
  }): Promise<TenantStripeRow> {
    const existing = await this.getConfig(data.tenant_id);
    const now = new Date();
    if (existing) {
      return db
        .updateTable("tenant_stripe")
        .set({
          secret_key_encrypted: data.secret_key_encrypted,
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
      .insertInto("tenant_stripe")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        provider: "STRIPE",
        secret_key_encrypted: data.secret_key_encrypted,
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
  ): Promise<TenantStripeRow> {
    return db
      .updateTable("tenant_stripe")
      .set({ ...patch, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async removeConfig(tenantId: string): Promise<void> {
    await db.deleteFrom("tenant_stripe").where("tenant_id", "=", tenantId).execute();
  }
}

export default new StripeConfigRepository();
