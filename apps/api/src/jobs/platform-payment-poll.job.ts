import billingService from "../services/operator/billing.service";
import logger from "../utils/logger";

let running = false;

// Confirms MANUAL platform-billing payments by polling the gateway (Razorpay
// payment links / Stripe checkout sessions), so a paid link activates the
// workspace even without a webhook. Mirrors the tenant-finance payments poller.
// No-op in simulate / when nothing is pending. Scheduled by scheduler.ts.
export async function runBillingPaymentPoll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { activated } = await billingService.pollPendingPayments();
    if (activated) logger.info(`billing payment poll: activated ${activated} subscription(s)`);
  } catch (err) {
    logger.warn(`billing payment poll tick failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
