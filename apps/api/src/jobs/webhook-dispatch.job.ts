import webhookDeliveriesRepository from "../repositories/webhook-deliveries.repository";
import webhookDispatchService from "../services/webhook-dispatch.service";
import logger from "../utils/logger";

// Deliveries sent per tick. Each is one outbound HTTP call with a 10s cap, and
// they run concurrently, so this bounds both the fan-out and the worst-case tick.
const BATCH = 25;

// A delivery still SENDING after this long belongs to a worker that died
// mid-flight. Released back to PENDING so it is retried rather than stranded.
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Sends queued outbound webhooks.
 *
 * Claim-then-send: the repository flips PENDING to SENDING in a conditional
 * UPDATE, so under Node cluster (one worker per CPU, all running this sweep)
 * exactly one worker owns each delivery. A plain select-then-send would
 * double-deliver every tick, and a receiver seeing "deal.won" twice may well
 * charge someone twice.
 */
export const runWebhookDispatch = async (): Promise<void> => {
  // Belt and braces alongside the guard in the service: a suite must never make
  // an outbound request to a tenant's configured endpoint.
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return;

  const released = await webhookDeliveriesRepository.releaseStuck(
    new Date(Date.now() - STUCK_AFTER_MS)
  );
  if (released) logger.info(`webhook-dispatch: released ${released} stuck delivery(ies)`);

  const claimed = await webhookDeliveriesRepository.claimDue(BATCH);
  if (!claimed.length) return;

  // Concurrent: these are independent endpoints and one slow receiver must not
  // hold up the rest. deliver() never throws, so allSettled is belt and braces.
  await Promise.allSettled(
    claimed.map((delivery) =>
      webhookDispatchService.deliver({
        id: delivery.id,
        tenant_id: delivery.tenant_id,
        webhook_id: delivery.webhook_id,
        event: delivery.event,
        payload: delivery.payload,
        attempt: delivery.attempt,
        url: delivery.url,
        secret: delivery.secret,
        active: delivery.active,
      })
    )
  );

  logger.info(`webhook-dispatch: processed ${claimed.length} delivery(ies)`);
};
