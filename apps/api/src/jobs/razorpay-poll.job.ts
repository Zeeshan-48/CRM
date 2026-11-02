import financeService from "../services/finance.service";
import logger from "../utils/logger";

let running = false;

// Polls PENDING gateway payment links/sessions (Razorpay + Stripe) and confirms
// paid ones (invoice -> PAID). Neither gateway needs a webhook for this flow, // we check status on a schedule. No-op without a live gateway account.
// Scheduled by scheduler.ts.
export async function runPaymentsPoll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { confirmed } = await financeService.confirmPendingPayments();
    if (confirmed) logger.info(`payments poll: confirmed ${confirmed} payment(s)`);
  } catch (err) {
    logger.warn(`payments poll tick failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
