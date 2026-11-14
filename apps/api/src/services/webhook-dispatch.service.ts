import { openSecret } from "../utils/crypto";
import config from "../config";
import integrationsRepository from "../repositories/integrations.repository";
import webhookDeliveriesRepository from "../repositories/webhook-deliveries.repository";
import { assertSafeUrl } from "../utils/http-guard";
import logger from "../utils/logger";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  MAX_ATTEMPTS,
  SIGNATURE_HEADER,
  nextRetryDelay,
  signPayload,
} from "../utils/webhook-signature";

// Outbound delivery to a tenant-supplied URL, so every guard the AI-calling
// client uses applies here too: https only, no private/loopback/metadata hosts
// (re-resolved per call to defeat DNS rebinding), no redirects, hard timeout.
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 2000;

// Mirrors the guard the rate limiter and the Redis client already use.
const UNDER_TEST = process.env.VITEST === "true" || config.NODE_ENV === "test";

export interface WebhookEventPayload {
  id: string;
  event: string;
  created_at: string;
  data: Record<string, unknown>;
}

/**
 * Outbound webhooks: the half of "integration" that was never built.
 *
 * The `webhooks` subscription table has existed since the CRM was written, with
 * a signing secret and a delivery counter, but nothing ever dispatched: the old
 * `testWebhook` incremented the counter and returned a hardcoded
 * `{ id: "demo" }`. This is the real dispatcher.
 *
 * Queue-then-sweep rather than send-inline, deliberately. Emitting happens
 * inside request paths (a deal is won, a lead is created), and a tenant's slow
 * or dead endpoint must never add latency to a CRM user's click, nor fail the
 * business operation that triggered it.
 */
class WebhookDispatchService {
  /**
   * Queues one CRM event to every active subscriber. Fire-and-forget by design:
   * callers are business flows that must not care whether anyone is listening.
   *
   * Silent under test. This hangs off `engine.emit`, so without the guard a test
   * that wins a deal queues a real, signed `deal.won` POST to whatever endpoint
   * the workspace has configured, and the sweep then sends it. Running the suite
   * against a workspace with live webhooks would fire fabricated events at a
   * customer's production system. The explicit `test()` path below is
   * deliberately NOT gated: an admin pressing "Test" is asking us to send.
   */
  emit(tenantId: string, event: string, data: Record<string, unknown>): void {
    if (UNDER_TEST) return;
    void this.enqueue(tenantId, event, data).catch((err) =>
      logger.warn(`webhook enqueue failed for ${event}: ${String(err)}`)
    );
  }

  async enqueue(
    tenantId: string,
    event: string,
    data: Record<string, unknown>
  ): Promise<number> {
    const subscribers = await webhookDeliveriesRepository.subscribersFor(tenantId, event);
    if (!subscribers.length) return 0;

    for (const webhook of subscribers) {
      await webhookDeliveriesRepository
        .enqueue({ tenant_id: tenantId, webhook_id: webhook.id, event, payload: data })
        .catch((err) => logger.warn(`webhook enqueue failed: ${String(err)}`));
    }
    return subscribers.length;
  }

  /**
   * Sends one claimed delivery and records the outcome.
   *
   * Never throws: the sweep processes a batch, and one dead endpoint must not
   * abort delivery to everyone else.
   */
  async deliver(delivery: {
    id: string;
    tenant_id: string;
    webhook_id: string;
    event: string;
    payload: unknown;
    attempt: number;
    url: string;
    secret: string;
    active: boolean;
  }): Promise<void> {
    const attempt = delivery.attempt + 1;

    if (!delivery.active) {
      await webhookDeliveriesRepository.markExhausted(
        delivery.id,
        attempt,
        null,
        "Subscription is inactive"
      );
      return;
    }

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      created_at: new Date().toISOString(),
      data:
        typeof delivery.payload === "string"
          ? JSON.parse(delivery.payload)
          : (delivery.payload ?? {}),
    } satisfies WebhookEventPayload);

    try {
      // Re-validated per attempt, not once at subscription time: a hostname that
      // resolved publicly yesterday can point at 169.254.169.254 today.
      await assertSafeUrl(delivery.url);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let status = 0;
      let text = "";
      try {
        const res = await fetch(delivery.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [EVENT_HEADER]: delivery.event,
            [DELIVERY_HEADER]: delivery.id,
            [SIGNATURE_HEADER]: signPayload(openSecret(delivery.secret), body),
            "User-Agent": "OpenCRM-Webhooks/1.0",
          },
          body,
          redirect: "error",
          signal: controller.signal,
        });
        status = res.status;
        text = (await res.text()).slice(0, MAX_RESPONSE_CHARS);
      } finally {
        clearTimeout(timer);
      }

      if (status >= 200 && status < 300) {
        await webhookDeliveriesRepository.markSucceeded(delivery.id, status, attempt);
        await integrationsRepository
          .recordWebhookDelivery(delivery.webhook_id, delivery.tenant_id)
          .catch(() => undefined);
        return;
      }

      // 4xx other than 408/429 means the receiver understood and refused. Retrying
      // will not change the answer, so stop immediately instead of burning six
      // attempts over six hours on a permanent rejection.
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
      await this.recordFailure(
        delivery.id,
        attempt,
        status,
        `HTTP ${status}: ${text.slice(0, 300)}`,
        permanent
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.recordFailure(delivery.id, attempt, null, reason, false);
    }
  }

  private async recordFailure(
    id: string,
    attempt: number,
    status: number | null,
    error: string,
    permanent: boolean
  ): Promise<void> {
    const delay = permanent ? null : nextRetryDelay(attempt);
    if (delay === null || attempt >= MAX_ATTEMPTS) {
      await webhookDeliveriesRepository.markExhausted(id, attempt, status, error);
      return;
    }
    await webhookDeliveriesRepository.markRetrying(
      id,
      attempt,
      new Date(Date.now() + delay),
      status,
      error
    );
  }

  /**
   * Sends a real, signed test delivery. Replaces the placeholder that returned
   * `{ id: "demo" }` without ever making a request, so "Test" now genuinely
   * tells an admin whether their endpoint works.
   */
  async test(tenantId: string, webhookId: string): Promise<{ ok: boolean; deliveryId: string }> {
    const webhook = await integrationsRepository.findWebhookById(webhookId, tenantId);
    if (!webhook) throw new Error("Webhook not found");

    const delivery = await webhookDeliveriesRepository.enqueue({
      tenant_id: tenantId,
      webhook_id: webhook.id,
      event: webhook.event,
      payload: {
        test: true,
        message: "This is a test delivery from Bn Orbit.",
        sent_at: new Date().toISOString(),
      },
    });

    // Sent inline rather than queued: an admin pressing "Test" is waiting for
    // the answer, which is the one case where inline delivery is right.
    await this.deliver({
      id: delivery.id,
      tenant_id: tenantId,
      webhook_id: webhook.id,
      event: webhook.event,
      payload: delivery.payload,
      attempt: 0,
      url: webhook.url,
      secret: webhook.secret,
      active: webhook.active,
    });

    const after = await webhookDeliveriesRepository.findById(delivery.id, tenantId);
    return { ok: after?.status === "SUCCEEDED", deliveryId: delivery.id };
  }
}

export default new WebhookDispatchService();
