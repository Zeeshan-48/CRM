import { ulid } from "ulid";
import { db } from "../../db/connection";

// Idempotency ledger for inbound gateway webhooks. Razorpay/Stripe retry
// delivery, so every event is recorded by its gateway event id and processed
// at most once. We check isProcessed() before applying and markProcessed()
// only after success, so a transient failure is safely retried by the gateway.
class WebhookEventsRepository {
  async isProcessed(eventId: string): Promise<boolean> {
    const row = await db
      .selectFrom("platform_webhook_events")
      .select("id")
      .where("event_id", "=", eventId)
      .executeTakeFirst();
    return Boolean(row);
  }

  async markProcessed(data: {
    gateway: string;
    eventId: string;
    eventType: string;
    status?: string;
    error?: string | null;
  }): Promise<void> {
    await db
      .insertInto("platform_webhook_events")
      .values({
        id: ulid(),
        gateway: data.gateway,
        event_id: data.eventId,
        event_type: data.eventType,
        status: data.status ?? "PROCESSED",
        error: data.error ?? null,
        processed_at: new Date(),
        created_at: new Date(),
      })
      .onConflict((oc) => oc.column("event_id").doNothing())
      .execute();
  }
}

export default new WebhookEventsRepository();
