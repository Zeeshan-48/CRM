import config from "../../config";
import razorpayClient, { RazorpayCreds } from "../razorpay.client";
import stripeClient, { StripeCreds, StripeWebhookResult } from "../stripe.client";

// Platform billing gateway seam (operator tier). Unlike payment-gateway.service
// (tenant BYO-first, charging a tenant's own customers), this ALWAYS uses the operator's
// own platform account credentials from config and normalises Razorpay
// Subscriptions + Stripe Billing into one shape. Takes the external gateway
// plan/price id as input, resolving it from plan_gateway_refs is the billing
// service's job. Never throws.

export type BillingGateway = "RAZORPAY" | "STRIPE";
export const BILLING_GATEWAYS: BillingGateway[] = ["RAZORPAY", "STRIPE"];

export const isBillingGateway = (value: string): value is BillingGateway =>
  (BILLING_GATEWAYS as readonly string[]).includes(value);

export interface PlatformSubscriptionResult {
  gateway: BillingGateway;
  subscriptionId: string | null;
  customerId: string | null;
  checkoutUrl: string | null; // hosted page the tenant admin completes (upfront pay)
  currentPeriodEnd: Date | null;
  status: string; // raw gateway status; mapped to subscription_status by the caller
  simulated: boolean;
  error: string | null;
}

class PlatformGatewayService {
  // BILLING_SIMULATE forces canned subscriptions even when the platform gateway
  // keys are live; tests always simulate. When true we never touch the network.
  isSimulated(): boolean {
    return config.BILLING_SIMULATE || config.NODE_ENV === "test" || process.env.VITEST === "true";
  }

  // Whether the platform account for a gateway is usable (live creds, or sim).
  isConfigured(gateway: BillingGateway): boolean {
    if (this.isSimulated()) return true;
    return gateway === "RAZORPAY"
      ? Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET)
      : Boolean(config.STRIPE_SECRET_KEY);
  }

  private razorpayCreds(): RazorpayCreds {
    return { keyId: config.RAZORPAY_KEY_ID, keySecret: config.RAZORPAY_KEY_SECRET };
  }

  private stripeCreds(): StripeCreds {
    return { secretKey: config.STRIPE_SECRET_KEY };
  }

  private simResult(
    gateway: BillingGateway,
    referenceId: string,
    anchorAt?: Date
  ): PlatformSubscriptionResult {
    const subscriptionId = `sub_sim_${referenceId}`;
    return {
      gateway,
      subscriptionId,
      customerId: `cust_sim_${referenceId}`,
      checkoutUrl: `${config.BILLING_RETURN_URL}?sim_sub=${subscriptionId}`,
      currentPeriodEnd: anchorAt ?? new Date(Date.now() + 30 * 86400000),
      status: gateway === "RAZORPAY" ? "created" : "incomplete",
      simulated: true,
      error: null,
    };
  }

  // Creates a customer + subscription on the platform account and returns the
  // hosted checkout/authorization url. The subscription is not ACTIVE yet, the
  // first successful charge (via webhook) activates it.
  async createSubscription(params: {
    gateway: BillingGateway;
    planExternalId: string;
    referenceId: string;
    customer: { name?: string | null; email?: string | null; contact?: string | null };
    // Defer the first auto-charge to this time (MANUAL->AUTO: the paid period end).
    anchorAt?: Date;
  }): Promise<PlatformSubscriptionResult> {
    if (this.isSimulated()) {
      return this.simResult(params.gateway, params.referenceId, params.anchorAt);
    }
    const anchorUnix = params.anchorAt ? Math.floor(params.anchorAt.getTime() / 1000) : undefined;

    if (params.gateway === "RAZORPAY") {
      const creds = this.razorpayCreds();
      const customer = await razorpayClient.createCustomer({ creds, ...params.customer });
      const sub = await razorpayClient.createSubscription({
        creds,
        planId: params.planExternalId,
        referenceId: params.referenceId,
        customerId: customer.id ?? undefined,
        startAt: anchorUnix,
      });
      return {
        gateway: "RAZORPAY",
        subscriptionId: sub.id,
        customerId: customer.id,
        checkoutUrl: sub.shortUrl,
        currentPeriodEnd: sub.currentEnd ? new Date(sub.currentEnd * 1000) : null,
        status: sub.status,
        simulated: sub.simulated,
        error: sub.error ?? customer.error,
      };
    }

    const creds = this.stripeCreds();
    const customer = await stripeClient.createCustomer({
      creds,
      name: params.customer.name,
      email: params.customer.email,
    });
    const sub = await stripeClient.createSubscriptionCheckout({
      creds,
      priceId: params.planExternalId,
      referenceId: params.referenceId,
      customerId: customer.id ?? undefined,
      customerEmail: params.customer.email,
      successUrl: `${config.BILLING_RETURN_URL}?status=success`,
      cancelUrl: `${config.BILLING_RETURN_URL}?status=cancelled`,
      trialEnd: anchorUnix,
    });
    return {
      gateway: "STRIPE",
      subscriptionId: sub.id,
      customerId: customer.id,
      checkoutUrl: sub.url,
      currentPeriodEnd: sub.currentEnd ? new Date(sub.currentEnd * 1000) : null,
      status: sub.status,
      simulated: sub.simulated,
      error: sub.error ?? customer.error,
    };
  }

  async fetchSubscription(
    gateway: BillingGateway,
    subscriptionId: string
  ): Promise<PlatformSubscriptionResult> {
    if (this.isSimulated()) {
      return {
        gateway,
        subscriptionId,
        customerId: null,
        checkoutUrl: null,
        currentPeriodEnd: null,
        status: "active",
        simulated: true,
        error: null,
      };
    }
    const sub =
      gateway === "RAZORPAY"
        ? await razorpayClient.fetchSubscription(this.razorpayCreds(), subscriptionId)
        : await stripeClient.fetchSubscription(this.stripeCreds(), subscriptionId);
    return {
      gateway,
      subscriptionId: sub.id,
      customerId: null,
      checkoutUrl: null,
      currentPeriodEnd: sub.currentEnd ? new Date(sub.currentEnd * 1000) : null,
      status: sub.status,
      simulated: sub.simulated,
      error: sub.error,
    };
  }

  async cancelSubscription(
    gateway: BillingGateway,
    subscriptionId: string,
    atPeriodEnd = false
  ): Promise<PlatformSubscriptionResult> {
    if (this.isSimulated()) {
      return {
        gateway,
        subscriptionId,
        customerId: null,
        checkoutUrl: null,
        currentPeriodEnd: null,
        status: "cancelled",
        simulated: true,
        error: null,
      };
    }
    const sub =
      gateway === "RAZORPAY"
        ? await razorpayClient.cancelSubscription({
            creds: this.razorpayCreds(),
            subscriptionId,
            atCycleEnd: atPeriodEnd,
          })
        : await stripeClient.cancelSubscription({
            creds: this.stripeCreds(),
            subscriptionId,
            atPeriodEnd,
          });
    return {
      gateway,
      subscriptionId: sub.id,
      customerId: null,
      checkoutUrl: null,
      currentPeriodEnd: sub.currentEnd ? new Date(sub.currentEnd * 1000) : null,
      status: sub.status,
      simulated: sub.simulated,
      error: sub.error,
    };
  }

  // Creates a one-time hosted payment link on the platform account, used for
  // MANUAL billing (no mandate): the tenant pays a fresh link each cycle.
  async createPaymentLink(params: {
    gateway: BillingGateway;
    amountPaise: number;
    description: string;
    referenceId: string;
    customer: { name?: string | null; email?: string | null; contact?: string | null };
  }): Promise<{ url: string | null; ref: string | null; simulated: boolean; error: string | null }> {
    if (this.isSimulated()) {
      return {
        url: `${config.BILLING_RETURN_URL}?sim_pay=${params.referenceId}`,
        ref: `plink_sim_${params.referenceId}`,
        simulated: true,
        error: null,
      };
    }
    if (params.gateway === "RAZORPAY") {
      const link = await razorpayClient.createPaymentLink({
        creds: this.razorpayCreds(),
        amountPaise: params.amountPaise,
        description: params.description,
        referenceId: params.referenceId,
        customer: params.customer,
      });
      return { url: link.shortUrl || null, ref: link.id || null, simulated: link.simulated, error: link.error };
    }
    const session = await stripeClient.createCheckoutSession({
      creds: this.stripeCreds(),
      amountPaise: params.amountPaise,
      description: params.description,
      referenceId: params.referenceId,
      customer: { email: params.customer.email },
      successUrl: `${config.BILLING_RETURN_URL}?status=success`,
      cancelUrl: `${config.BILLING_RETURN_URL}?status=cancelled`,
    });
    return { url: session.url || null, ref: session.id || null, simulated: session.simulated, error: session.error };
  }

  // Polls a one-time hosted link/session for payment (MANUAL billing without a
  // webhook). Returns paid=false for simulated/unknown refs so the poller skips.
  async fetchPaymentStatus(
    gateway: BillingGateway,
    ref: string
  ): Promise<{ paid: boolean; paymentId: string | null }> {
    if (this.isSimulated()) return { paid: false, paymentId: null };
    if (gateway === "RAZORPAY") {
      const s = await razorpayClient.fetchPaymentLink(this.razorpayCreds(), ref);
      return { paid: s?.status === "paid", paymentId: s?.paymentId ?? null };
    }
    const s = await stripeClient.fetchSession(this.stripeCreds(), ref);
    return { paid: s?.status === "paid", paymentId: s?.paymentId ?? null };
  }

  // --- Webhook signature verification (platform webhook secrets from config) ---

  verifyRazorpayWebhook(rawBody: string, signature: string): boolean {
    return razorpayClient.verifyWebhookSignature(rawBody, signature, config.RAZORPAY_WEBHOOK_SECRET);
  }

  verifyStripeWebhook(rawBody: string, signature: string): StripeWebhookResult {
    return stripeClient.constructWebhookEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  }
}

export default new PlatformGatewayService();
