import crypto from "crypto";
import config from "../../config";
import platformTransactionsRepository from "../../repositories/operator/platform-transactions.repository";
import subscriptionsRepository, {
  SubscriptionRow,
} from "../../repositories/operator/subscriptions.repository";
import tenantsRepository from "../../repositories/operator/tenants.repository";
import webhookEventsRepository from "../../repositories/operator/webhook-events.repository";
import logger from "../../utils/logger";
import entitlementsSyncService from "./entitlements-sync.service";
import platformGateway from "./platform-gateway.service";
import type { platform_txn_status } from "../../db/enums";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const unixToDate = (v: unknown): Date | null => {
  const n = num(v);
  return n ? new Date(n * 1000) : null;
};

const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

// Applies verified gateway webhook events to the platform-billing state. Every
// transition is idempotent (safe to replay): activating an already-active
// subscription is a no-op, and transactions are de-duped by gateway_invoice_id.
class BillingWebhookService {
  async processRazorpay(rawBody: string, signature: string): Promise<number> {
    if (!platformGateway.verifyRazorpayWebhook(rawBody, signature)) return 401;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return 400;
    }
    const eventType = str(body.event) ?? "";
    // Idempotency key derived from the SIGNED body, NOT the X-Razorpay-Event-Id
    // header (unsigned; an attacker could vary it to replay a captured event).
    const evId = `rzp_${crypto.createHash("sha256").update(rawBody).digest("hex")}`;

    if (await webhookEventsRepository.isProcessed(evId)) return 200;
    try {
      await this.applyRazorpay(eventType, body);
      await webhookEventsRepository.markProcessed({
        gateway: "RAZORPAY",
        eventId: evId,
        eventType,
      });
      return 200;
    } catch (err) {
      logger.error(`[billing-webhook] razorpay ${eventType} failed: ${String(err)}`);
      return 500;
    }
  }

  async processStripe(rawBody: string, signature: string): Promise<number> {
    const result = platformGateway.verifyStripeWebhook(rawBody, signature);
    if (!result.valid || !result.event) return 401;
    const event = result.event;

    if (await webhookEventsRepository.isProcessed(event.id)) return 200;
    try {
      await this.applyStripe(event.type, event.data.object);
      await webhookEventsRepository.markProcessed({
        gateway: "STRIPE",
        eventId: event.id,
        eventType: event.type,
      });
      return 200;
    } catch (err) {
      logger.error(`[billing-webhook] stripe ${event.type} failed: ${String(err)}`);
      return 500;
    }
  }

  // --- Razorpay event -> state -----------------------------------------

  private async applyRazorpay(eventType: string, body: Record<string, unknown>): Promise<void> {
    const payload = (body.payload as Record<string, unknown>) ?? {};

    // MANUAL billing: a one-time payment link was paid. Correlate via the link's
    // reference_id (`pmsub_<subscriptionId>`).
    if (eventType === "payment_link.paid") {
      const linkEntity =
        ((payload.payment_link as Record<string, unknown>)?.entity as Record<string, unknown>) ?? {};
      const payment =
        ((payload.payment as Record<string, unknown>)?.entity as Record<string, unknown>) ?? {};
      await this.manualRenewByRef(str(linkEntity.reference_id), {
        amount: num(payment.amount),
        currency: str(payment.currency),
        invoiceId: str(payment.invoice_id) ?? str(payment.id),
        paymentId: str(payment.id),
      });
      return;
    }

    const subEntity =
      ((payload.subscription as Record<string, unknown>)?.entity as Record<string, unknown>) ?? {};
    const gatewaySubId = str(subEntity.id);
    if (!gatewaySubId) return;

    const sub = await subscriptionsRepository.findByGatewaySubscriptionId(gatewaySubId);
    if (!sub) return;

    switch (eventType) {
      case "subscription.charged": {
        const payment =
          ((payload.payment as Record<string, unknown>)?.entity as Record<string, unknown>) ?? {};
        const currentEnd = unixToDate(subEntity.current_end);
        await this.recordTxn(sub, {
          status: "PAID",
          amount: num(payment.amount) ?? sub.amount,
          currency: (str(payment.currency) ?? sub.currency).toUpperCase(),
          gatewayInvoiceId: str(payment.invoice_id) ?? str(payment.id),
          gatewayPaymentId: str(payment.id),
          periodEnd: currentEnd,
          hostedInvoiceUrl: null,
          failureReason: null,
        });
        await this.activate(sub, currentEnd);
        break;
      }
      case "subscription.pending":
        await this.pastDue(sub);
        break;
      case "subscription.halted":
      case "subscription.cancelled":
        await this.canceledAndSuspend(sub);
        break;
      default:
        break;
    }
  }

  // --- Stripe event -> state -------------------------------------------

  private async applyStripe(type: string, obj: Record<string, unknown>): Promise<void> {
    switch (type) {
      case "checkout.session.completed": {
        const ref = str(obj.client_reference_id);
        const stripeSubId = str(obj.subscription);
        // MANUAL billing: one-time checkout (mode=payment) has no subscription id;
        // the ref is `pmsub_<subscriptionId>`.
        if (!stripeSubId) {
          await this.manualRenewByRef(ref, {
            amount: num(obj.amount_total),
            currency: str(obj.currency),
            invoiceId: str(obj.payment_intent) ?? str(obj.id),
            paymentId: str(obj.payment_intent),
          });
          return;
        }
        // AUTO first activation: correlate the new subscription id to our PENDING
        // row via client_reference_id (`${tenantId}-${ts}`).
        if (!ref) return;
        const tenantId = ref.slice(0, ref.lastIndexOf("-")) || ref;
        const sub = await subscriptionsRepository.liveForTenant(tenantId);
        if (!sub) return;
        await subscriptionsRepository.update(sub.id, {
          gateway_subscription_id: stripeSubId,
          gateway_customer_id: str(obj.customer) ?? sub.gateway_customer_id,
        });
        await this.activate({ ...sub, gateway_subscription_id: stripeSubId }, null);
        break;
      }
      case "invoice.paid": {
        const stripeSubId = str(obj.subscription);
        if (!stripeSubId) return;
        const sub = await subscriptionsRepository.findByGatewaySubscriptionId(stripeSubId);
        if (!sub) return;
        const periodEnd = unixToDate(obj.period_end);
        await this.recordTxn(sub, {
          status: "PAID",
          amount: num(obj.amount_paid) ?? sub.amount,
          currency: (str(obj.currency) ?? sub.currency).toUpperCase(),
          gatewayInvoiceId: str(obj.id),
          gatewayPaymentId: str(obj.payment_intent),
          periodEnd,
          hostedInvoiceUrl: str(obj.hosted_invoice_url),
          failureReason: null,
        });
        await this.activate(sub, periodEnd);
        break;
      }
      case "invoice.payment_failed": {
        const stripeSubId = str(obj.subscription);
        if (!stripeSubId) return;
        const sub = await subscriptionsRepository.findByGatewaySubscriptionId(stripeSubId);
        if (!sub) return;
        await this.recordTxn(sub, {
          status: "FAILED",
          amount: num(obj.amount_due) ?? sub.amount,
          currency: (str(obj.currency) ?? sub.currency).toUpperCase(),
          gatewayInvoiceId: str(obj.id),
          gatewayPaymentId: null,
          periodEnd: null,
          hostedInvoiceUrl: str(obj.hosted_invoice_url),
          failureReason: "payment_failed",
        });
        await this.pastDue(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const stripeSubId = str(obj.id);
        if (!stripeSubId) return;
        const sub = await subscriptionsRepository.findByGatewaySubscriptionId(stripeSubId);
        if (!sub) return;
        await this.canceledAndSuspend(sub);
        break;
      }
      default:
        break;
    }
  }

  // --- Shared transitions ----------------------------------------------

  private async activate(sub: SubscriptionRow, currentEnd: Date | null): Promise<void> {
    await subscriptionsRepository.update(sub.id, {
      status: "ACTIVE",
      current_period_start: sub.current_period_start ?? new Date(),
      current_period_end: currentEnd ?? sub.current_period_end,
      grace_until: null,
      canceled_at: null,
      checkout_url: null,
    });
    await tenantsRepository.update(sub.tenant_id, { status: "ACTIVE" });
    await entitlementsSyncService.sync(sub.tenant_id);
  }

  // MANUAL renewal: a one-time link/checkout (ref = `pmsub_<subId>`) was paid.
  // Extend the period by a month from whichever is later (now / current end),
  // activate, record the txn (idempotent via gateway invoice id), clear the link.
  private async manualRenewByRef(
    ref: string | null,
    payment: {
      amount: number | null;
      currency: string | null;
      invoiceId: string | null;
      paymentId: string | null;
    }
  ): Promise<void> {
    if (!ref || !ref.startsWith("pmsub_")) return;
    const sub = await subscriptionsRepository.findById(ref.slice("pmsub_".length));
    if (!sub) return;

    const key = payment.invoiceId ?? payment.paymentId;

    // Idempotent: if this payment was already applied (a prior webhook delivery
    // or the poller), just ensure ACTIVE + clear the pending link. Never roll the
    // period again, this is what stops webhook replays / poller overlap from
    // granting free months.
    if (key) {
      const existing = await platformTransactionsRepository.findByGatewayInvoiceId(key);
      if (existing) {
        await subscriptionsRepository.update(sub.id, {
          status: "ACTIVE",
          grace_until: null,
          canceled_at: null,
          checkout_url: null,
          checkout_ref: null,
        });
        await tenantsRepository.update(sub.tenant_id, { status: "ACTIVE" });
        await entitlementsSyncService.sync(sub.tenant_id);
        return;
      }
    }

    const now = new Date();
    const base =
      sub.current_period_end && sub.current_period_end > now ? sub.current_period_end : now;
    const periodEnd = addMonths(base, 1);

    await this.recordTxn(sub, {
      status: "PAID",
      amount: payment.amount ?? sub.amount,
      currency: (payment.currency ?? sub.currency).toUpperCase(),
      gatewayInvoiceId: key,
      gatewayPaymentId: payment.paymentId,
      periodEnd,
      hostedInvoiceUrl: null,
      failureReason: null,
    });
    await subscriptionsRepository.update(sub.id, {
      status: "ACTIVE",
      current_period_start: sub.current_period_start ?? now,
      current_period_end: periodEnd,
      grace_until: null,
      canceled_at: null,
      checkout_url: null,
      checkout_ref: null,
    });
    await tenantsRepository.update(sub.tenant_id, { status: "ACTIVE" });
    await entitlementsSyncService.sync(sub.tenant_id);
  }

  private async pastDue(sub: SubscriptionRow): Promise<void> {
    const grace = new Date(Date.now() + config.BILLING_GRACE_DAYS * 86400000);
    await subscriptionsRepository.update(sub.id, { status: "PAST_DUE", grace_until: grace });
    // PAST_DUE keeps access (grace window). Sync is a no-op here unless a prior
    // lapse had revoked the plan rows, in which case it reinstates them.
    await entitlementsSyncService.sync(sub.tenant_id);
  }

  private async canceledAndSuspend(sub: SubscriptionRow): Promise<void> {
    await subscriptionsRepository.update(sub.id, { status: "CANCELED", canceled_at: new Date() });
    await tenantsRepository.update(sub.tenant_id, { status: "SUSPENDED" });
    await entitlementsSyncService.sync(sub.tenant_id);
  }

  private async recordTxn(
    sub: SubscriptionRow,
    data: {
      status: platform_txn_status;
      amount: number;
      currency: string;
      gatewayInvoiceId: string | null;
      gatewayPaymentId: string | null;
      periodEnd: Date | null;
      hostedInvoiceUrl: string | null;
      failureReason: string | null;
    }
  ): Promise<void> {
    // De-dupe by gateway invoice id so a replayed webhook never double-charges
    // the ledger.
    if (data.gatewayInvoiceId) {
      const existing = await platformTransactionsRepository.findByGatewayInvoiceId(
        data.gatewayInvoiceId
      );
      if (existing) return;
    }
    await platformTransactionsRepository.create({
      tenantId: sub.tenant_id,
      subscriptionId: sub.id,
      gateway: sub.gateway,
      gatewayInvoiceId: data.gatewayInvoiceId,
      gatewayPaymentId: data.gatewayPaymentId,
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      kind: "CYCLE",
      periodStart: null,
      periodEnd: data.periodEnd,
      hostedInvoiceUrl: data.hostedInvoiceUrl,
      failureReason: data.failureReason,
      occurredAt: new Date(),
    });
  }
}

export default new BillingWebhookService();
