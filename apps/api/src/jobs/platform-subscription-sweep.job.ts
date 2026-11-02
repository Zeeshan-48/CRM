import billingService from "../services/operator/billing.service";
import logger from "../utils/logger";

let running = false;

// Hourly enforcement safety net for platform billing. Webhooks are the primary
// driver of subscription state; this catches missed/late webhooks by expiring
// lapsed subscriptions past their grace window and suspending the workspace.
// No-op when there are no lapsed subscriptions. Scheduled by scheduler.ts.
export async function runBillingSweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { pastDue, expired } = await billingService.sweep();
    if (pastDue || expired) {
      logger.info(`billing sweep: ${pastDue} -> past_due, ${expired} -> expired/suspended`);
    }

    // Then reconcile plan entitlements against subscription state. Runs after
    // the transitions above so this tick's expiries are revoked immediately.
    // Independent of the sweep result: it also repairs drift from a missed
    // webhook hook or a tenant reactivated by hand.
    await billingService.reconcileEntitlements();
  } catch (err) {
    logger.warn(`billing sweep tick failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
