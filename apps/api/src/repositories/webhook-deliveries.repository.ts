import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { webhook_deliveries, webhooks } from "../db/types";

export type WebhookDeliveryRow = Selectable<webhook_deliveries>;
export type WebhookRow = Selectable<webhooks>;

export interface DeliveryWithWebhook extends WebhookDeliveryRow {
  url: string;
  secret: string;
  active: boolean;
}

class WebhookDeliveriesRepository {
  /** Active subscriptions for one event in one workspace. */
  async subscribersFor(tenantId: string, event: string): Promise<WebhookRow[]> {
    return db
      .selectFrom("webhooks")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("active", "=", true)
      .where("event", "=", event)
      .execute();
  }

  /** Queues a delivery. Actual sending is done by the dispatch sweep. */
  async enqueue(data: {
    tenant_id: string;
    webhook_id: string;
    event: string;
    payload: Record<string, unknown>;
  }): Promise<WebhookDeliveryRow> {
    const now = new Date();
    return db
      .insertInto("webhook_deliveries")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        webhook_id: data.webhook_id,
        event: data.event,
        payload: JSON.stringify(data.payload),
        status: "PENDING",
        attempt: 0,
        response_code: null,
        response_body: null,
        error: null,
        // Due immediately; the sweep picks it up on its next tick.
        next_retry_at: now,
        delivered_at: null,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Claims due deliveries for this worker.
   *
   * Claiming is a conditional UPDATE that flips PENDING to SENDING, so two
   * cluster workers can never send the same delivery twice. A plain
   * SELECT-then-send would double-deliver on every tick under Node cluster.
   */
  async claimDue(limit: number): Promise<DeliveryWithWebhook[]> {
    const now = new Date();

    const due = await db
      .selectFrom("webhook_deliveries")
      .select(["id"])
      .where("status", "=", "PENDING")
      .where("next_retry_at", "<=", now)
      .orderBy("next_retry_at", "asc")
      .limit(limit)
      .execute();
    if (!due.length) return [];

    const ids = due.map((d) => d.id);
    const claimed = await db
      .updateTable("webhook_deliveries")
      .set({ status: "SENDING" })
      .where("id", "in", ids)
      // The guard: only rows still PENDING are ours. Anything another worker
      // grabbed between the select and now updates zero rows and is skipped.
      .where("status", "=", "PENDING")
      .returning(["id"])
      .execute();
    if (!claimed.length) return [];

    return db
      .selectFrom("webhook_deliveries")
      .innerJoin("webhooks", "webhooks.id", "webhook_deliveries.webhook_id")
      .selectAll("webhook_deliveries")
      .select(["webhooks.url as url", "webhooks.secret as secret", "webhooks.active as active"])
      .where(
        "webhook_deliveries.id",
        "in",
        claimed.map((c) => c.id)
      )
      .execute();
  }

  async markSucceeded(id: string, responseCode: number, attempt: number): Promise<void> {
    await db
      .updateTable("webhook_deliveries")
      .set({
        status: "SUCCEEDED",
        attempt,
        response_code: responseCode,
        error: null,
        delivered_at: new Date(),
        next_retry_at: null,
      })
      .where("id", "=", id)
      .execute();
  }

  async markRetrying(
    id: string,
    attempt: number,
    nextRetryAt: Date,
    responseCode: number | null,
    error: string
  ): Promise<void> {
    await db
      .updateTable("webhook_deliveries")
      .set({
        status: "PENDING",
        attempt,
        response_code: responseCode,
        error: error.slice(0, 2000),
        next_retry_at: nextRetryAt,
      })
      .where("id", "=", id)
      .execute();
  }

  async markExhausted(
    id: string,
    attempt: number,
    responseCode: number | null,
    error: string
  ): Promise<void> {
    await db
      .updateTable("webhook_deliveries")
      .set({
        status: "EXHAUSTED",
        attempt,
        response_code: responseCode,
        error: error.slice(0, 2000),
        next_retry_at: null,
      })
      .where("id", "=", id)
      .execute();
  }

  /** The delivery log for the integration console. */
  async list(
    tenantId: string,
    filters: { webhookId?: string | null; status?: string | null; limit?: number } = {}
  ): Promise<WebhookDeliveryRow[]> {
    let query = db
      .selectFrom("webhook_deliveries")
      .selectAll()
      .where("tenant_id", "=", tenantId);
    if (filters.webhookId) query = query.where("webhook_id", "=", filters.webhookId);
    if (filters.status) query = query.where("status", "=", filters.status);
    return query
      .orderBy("created_at", "desc")
      .limit(Math.min(200, Math.max(1, filters.limit ?? 50)))
      .execute();
  }

  async findById(id: string, tenantId: string): Promise<WebhookDeliveryRow | undefined> {
    return db
      .selectFrom("webhook_deliveries")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  /** Requeues a failed delivery from the UI. Resets the attempt ladder. */
  async requeue(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .updateTable("webhook_deliveries")
      .set({
        status: "PENDING",
        attempt: 0,
        error: null,
        response_code: null,
        next_retry_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("status", "in", ["FAILED", "EXHAUSTED", "SUCCEEDED"])
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0) > 0;
  }

  /**
   * Releases deliveries stuck in SENDING because the worker holding them died.
   * Without this a crash mid-flight would strand them forever.
   */
  async releaseStuck(olderThan: Date): Promise<number> {
    const result = await db
      .updateTable("webhook_deliveries")
      .set({ status: "PENDING", next_retry_at: new Date() })
      .where("status", "=", "SENDING")
      .where("created_at", "<", olderThan)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }
}

export default new WebhookDeliveriesRepository();
