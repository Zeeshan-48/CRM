import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_sending_status } from "../db/enums";
import type { email_reputation_events } from "../db/types";

export type EmailReputationEventRow = Selectable<email_reputation_events>;

export interface TenantSendingState {
  id: string;
  email_sending_status: email_sending_status;
  email_sending_status_changed_at: Date | null;
}

class EmailReputationRepository {
  async getTenantState(tenantId: string): Promise<TenantSendingState | undefined> {
    return db
      .selectFrom("tenants")
      .select(["id", "email_sending_status", "email_sending_status_changed_at"])
      .where("id", "=", tenantId)
      .executeTakeFirst();
  }

  async setTenantStatus(tenantId: string, status: email_sending_status): Promise<void> {
    const now = new Date();
    await db
      .updateTable("tenants")
      .set({
        email_sending_status: status,
        email_sending_status_changed_at: now,
        updated_at: now,
      })
      .where("id", "=", tenantId)
      .execute();
  }

  // Tenants eligible for automatic recovery (PAUSED requires an admin).
  async listRecoverable(): Promise<TenantSendingState[]> {
    return db
      .selectFrom("tenants")
      .select(["id", "email_sending_status", "email_sending_status_changed_at"])
      .where("email_sending_status", "in", ["WARNING", "THROTTLED"])
      .execute();
  }

  async recordEvent(data: {
    tenantId: string;
    fromStatus: email_sending_status;
    toStatus: email_sending_status;
    trigger: string;
    reason: string;
    ratesSnapshot: unknown;
  }): Promise<void> {
    await db
      .insertInto("email_reputation_events")
      .values({
        id: ulid(),
        tenant_id: data.tenantId,
        from_status: data.fromStatus,
        to_status: data.toStatus,
        trigger: data.trigger,
        reason: data.reason,
        rates_snapshot: JSON.stringify(data.ratesSnapshot),
        created_at: new Date(),
      })
      .execute();
  }

  async listByTenant(tenantId: string, limit = 50): Promise<EmailReputationEventRow[]> {
    return db
      .selectFrom("email_reputation_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }
}

export default new EmailReputationRepository();
