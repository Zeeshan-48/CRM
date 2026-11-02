import crypto from "crypto";
import config from "../config";
import logger from "../utils/logger";

export interface StripeCreds {
  secretKey: string;
}

export interface StripeValidateResult {
  ok: boolean;
  error?: string;
}

export interface StripeSession {
  id: string;
  url: string;
  status: string;
  simulated: boolean;
  error: string | null;
}

export interface StripeSessionStatus {
  // Normalised: paid | pending | failed.
  status: string;
  paymentId: string | null;
  error: string | null;
}

export interface StripeRefund {
  id: string | null;
  status: string;
  simulated: boolean;
  error: string | null;
}

// --- Platform subscriptions (operator billing) ---

export interface StripeCustomer {
  id: string | null;
  simulated: boolean;
  error: string | null;
}

export interface StripeSubscription {
  id: string | null; // subscription id (null right after checkout create, set via webhook)
  checkoutId: string | null; // checkout session id
  url: string | null; // hosted checkout url the tenant admin completes
  // incomplete | active | past_due | canceled | unpaid
  status: string;
  currentEnd: number | null; // current_period_end (unix seconds)
  simulated: boolean;
  error: string | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeWebhookResult {
  valid: boolean;
  event: StripeEvent | null;
}

const BASE = "https://api.stripe.com/v1";

const simulated = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true" || config.STRIPE_SIMULATE;

const authHeaders = (creds: StripeCreds): Record<string, string> => ({
  Authorization: `Bearer ${creds.secretKey}`,
  "Content-Type": "application/x-www-form-urlencoded",
});

// Stripe seam. Every call to api.stripe.com funnels through here (fixed host, // no SSRF surface). Uses Checkout Sessions as the hosted payment page (the
// Stripe analog of a Razorpay payment link) and polling to confirm, no webhook
// / public URL required. Never throws.
class StripeClientService {
  isSimulated(): boolean {
    return simulated();
  }

  isDefaultLive(): boolean {
    return Boolean(config.STRIPE_SECRET_KEY) && !simulated();
  }

  private keyed(creds: StripeCreds): boolean {
    return Boolean(creds.secretKey);
  }

  async validateCredentials(secretKey: string): Promise<StripeValidateResult> {
    if (simulated()) return { ok: true };
    if (!secretKey) return { ok: false, error: "secret key is required" };
    try {
      const res = await fetch(`${BASE}/balance`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (res.status === 401) return { ok: false, error: "Invalid Stripe secret key" };
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, error: body.error?.message ?? `Stripe returned ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "validation failed" };
    }
  }

  // Creates a hosted Checkout Session. amountPaise is the smallest currency unit
  // (paise for INR), invoices are in rupees, so callers ×100.
  async createCheckoutSession(params: {
    creds: StripeCreds;
    amountPaise: number;
    description: string;
    referenceId: string;
    customer?: { name?: string | null; email?: string | null; contact?: string | null };
    // Optional redirect overrides (platform billing points these at the billing
    // page); default to the tenant-finance page for BYO tenant collection.
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<StripeSession> {
    if (simulated() || !this.keyed(params.creds)) {
      const id = `cs_sim_${params.referenceId}`;
      return {
        id,
        url: `${config.APP_PUBLIC_URL}/sim-pay/${id}`,
        status: "open",
        simulated: true,
        error: null,
      };
    }
    try {
      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("line_items[0][price_data][currency]", config.STRIPE_CURRENCY);
      form.set("line_items[0][price_data][product_data][name]", params.description.slice(0, 250));
      form.set("line_items[0][price_data][unit_amount]", String(params.amountPaise));
      form.set("line_items[0][quantity]", "1");
      // Redirect the browser back to the SPA (not the API host) after payment.
      form.set("success_url", params.successUrl ?? `${config.CRM_APP_URL}/finance?paid=1`);
      form.set("cancel_url", params.cancelUrl ?? `${config.CRM_APP_URL}/finance?cancelled=1`);
      form.set("client_reference_id", params.referenceId);
      if (params.customer?.email) form.set("customer_email", params.customer.email);

      const res = await fetch(`${BASE}/checkout/sessions`, {
        method: "POST",
        headers: authHeaders(params.creds),
        body: form.toString(),
      });
      const data = (await res.json()) as {
        id?: string;
        url?: string;
        status?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.message ?? `Stripe returned ${res.status}`;
        logger.warn(`stripe createCheckoutSession: ${err}`);
        return { id: "", url: "", status: "failed", simulated: false, error: err };
      }
      return {
        id: data.id,
        url: data.url ?? "",
        status: data.status ?? "open",
        simulated: false,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "create session failed";
      logger.warn(`stripe createCheckoutSession error: ${msg}`);
      return { id: "", url: "", status: "failed", simulated: false, error: msg };
    }
  }

  // Polls a Checkout Session. Returns null for simulated sessions so the poll
  // job leaves them untouched.
  async fetchSession(creds: StripeCreds, sessionId: string): Promise<StripeSessionStatus | null> {
    if (simulated() || sessionId.startsWith("cs_sim_") || !this.keyed(creds)) return null;
    try {
      const res = await fetch(`${BASE}/checkout/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${creds.secretKey}` },
      });
      const data = (await res.json()) as {
        payment_status?: string;
        status?: string;
        payment_intent?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.error) {
        return {
          status: "pending",
          paymentId: null,
          error: data.error?.message ?? `Stripe returned ${res.status}`,
        };
      }
      // payment_status: paid | unpaid | no_payment_required; status: complete | open | expired.
      let status = "pending";
      if (data.payment_status === "paid" || data.payment_status === "no_payment_required") {
        status = "paid";
      } else if (data.status === "expired") {
        status = "failed";
      }
      return { status, paymentId: data.payment_intent ?? null, error: null };
    } catch (err) {
      logger.warn(`stripe fetchSession ${sessionId}: ${String(err)}`);
      return null;
    }
  }

  // Refunds a captured PaymentIntent. amountPaise omitted = full refund.
  async createRefund(params: {
    creds: StripeCreds;
    paymentId: string;
    amountPaise?: number;
  }): Promise<StripeRefund> {
    if (simulated() || !this.keyed(params.creds)) {
      return { id: `re_sim_${params.paymentId}`, status: "succeeded", simulated: true, error: null };
    }
    try {
      const form = new URLSearchParams();
      form.set("payment_intent", params.paymentId);
      if (params.amountPaise) form.set("amount", String(params.amountPaise));
      const res = await fetch(`${BASE}/refunds`, {
        method: "POST",
        headers: authHeaders(params.creds),
        body: form.toString(),
      });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.message ?? `Stripe returned ${res.status}`;
        logger.warn(`stripe createRefund: ${err}`);
        return { id: null, status: "failed", simulated: false, error: err };
      }
      return { id: data.id, status: data.status ?? "pending", simulated: false, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "refund failed";
      logger.warn(`stripe createRefund error: ${msg}`);
      return { id: null, status: "failed", simulated: false, error: msg };
    }
  }

  // --- Platform subscriptions (operator billing) -------------------------
  // Same creds seam as the checkout methods; the platform layer passes the operator's
  // own account creds. Self-guard on simulated() so the suite/dev never hit Stripe.

  async createCustomer(params: {
    creds: StripeCreds;
    name?: string | null;
    email?: string | null;
  }): Promise<StripeCustomer> {
    if (simulated() || !this.keyed(params.creds)) {
      return { id: `cus_sim_${Date.now().toString(36)}`, simulated: true, error: null };
    }
    try {
      const form = new URLSearchParams();
      if (params.name) form.set("name", params.name);
      if (params.email) form.set("email", params.email);
      const res = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers: authHeaders(params.creds),
        body: form.toString(),
      });
      const data = (await res.json()) as { id?: string; error?: { message?: string } };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.message ?? `Stripe returned ${res.status}`;
        logger.warn(`stripe createCustomer: ${err}`);
        return { id: null, simulated: false, error: err };
      }
      return { id: data.id, simulated: false, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "create customer failed";
      logger.warn(`stripe createCustomer error: ${msg}`);
      return { id: null, simulated: false, error: msg };
    }
  }

  // Creates a Checkout Session in subscription mode against an existing recurring
  // price id. Returns the hosted url the tenant admin completes; the subscription
  // id itself arrives later via the checkout.session.completed / invoice.paid
  // webhook, so `id` is null here on the live path.
  async createSubscriptionCheckout(params: {
    creds: StripeCreds;
    priceId: string;
    referenceId: string;
    customerId?: string | null;
    customerEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
    // Unix seconds: start the subscription with a trial until this time so the
    // first charge lands at the paid period's end (MANUAL->AUTO switch).
    trialEnd?: number;
  }): Promise<StripeSubscription> {
    if (simulated() || !this.keyed(params.creds)) {
      const checkoutId = `cs_sim_${params.referenceId}`;
      return {
        id: `sub_sim_${params.referenceId}`,
        checkoutId,
        url: `${config.BILLING_RETURN_URL}?sim_sub=${checkoutId}`,
        status: "active",
        currentEnd: params.trialEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400,
        simulated: true,
        error: null,
      };
    }
    try {
      const form = new URLSearchParams();
      form.set("mode", "subscription");
      form.set("line_items[0][price]", params.priceId);
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", params.successUrl);
      form.set("cancel_url", params.cancelUrl);
      form.set("client_reference_id", params.referenceId);
      if (params.trialEnd) form.set("subscription_data[trial_end]", String(params.trialEnd));
      if (params.customerId) form.set("customer", params.customerId);
      else if (params.customerEmail) form.set("customer_email", params.customerEmail);

      const res = await fetch(`${BASE}/checkout/sessions`, {
        method: "POST",
        headers: authHeaders(params.creds),
        body: form.toString(),
      });
      const data = (await res.json()) as {
        id?: string;
        url?: string;
        subscription?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.message ?? `Stripe returned ${res.status}`;
        logger.warn(`stripe createSubscriptionCheckout: ${err}`);
        return { id: null, checkoutId: null, url: null, status: "failed", currentEnd: null, simulated: false, error: err };
      }
      return {
        id: data.subscription ?? null,
        checkoutId: data.id,
        url: data.url ?? null,
        status: "incomplete",
        currentEnd: null,
        simulated: false,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "create subscription failed";
      logger.warn(`stripe createSubscriptionCheckout error: ${msg}`);
      return { id: null, checkoutId: null, url: null, status: "failed", currentEnd: null, simulated: false, error: msg };
    }
  }

  async fetchSubscription(creds: StripeCreds, subscriptionId: string): Promise<StripeSubscription> {
    if (simulated() || subscriptionId.startsWith("sub_sim_") || !this.keyed(creds)) {
      return { id: subscriptionId, checkoutId: null, url: null, status: "active", currentEnd: null, simulated: true, error: null };
    }
    try {
      const res = await fetch(`${BASE}/subscriptions/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${creds.secretKey}` },
      });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        current_period_end?: number;
        error?: { message?: string };
      };
      if (!res.ok || data.error) {
        return {
          id: subscriptionId,
          checkoutId: null,
          url: null,
          status: "unknown",
          currentEnd: null,
          simulated: false,
          error: data.error?.message ?? `Stripe returned ${res.status}`,
        };
      }
      return {
        id: data.id ?? subscriptionId,
        checkoutId: null,
        url: null,
        status: data.status ?? "unknown",
        currentEnd: data.current_period_end ?? null,
        simulated: false,
        error: null,
      };
    } catch (err) {
      logger.warn(`stripe fetchSubscription ${subscriptionId}: ${String(err)}`);
      return { id: subscriptionId, checkoutId: null, url: null, status: "unknown", currentEnd: null, simulated: false, error: String(err) };
    }
  }

  async cancelSubscription(params: {
    creds: StripeCreds;
    subscriptionId: string;
    atPeriodEnd?: boolean;
  }): Promise<StripeSubscription> {
    if (simulated() || params.subscriptionId.startsWith("sub_sim_") || !this.keyed(params.creds)) {
      return { id: params.subscriptionId, checkoutId: null, url: null, status: "canceled", currentEnd: null, simulated: true, error: null };
    }
    try {
      // cancel_at_period_end keeps access until the period ends; immediate uses DELETE.
      const res = params.atPeriodEnd
        ? await fetch(`${BASE}/subscriptions/${params.subscriptionId}`, {
            method: "POST",
            headers: authHeaders(params.creds),
            body: "cancel_at_period_end=true",
          })
        : await fetch(`${BASE}/subscriptions/${params.subscriptionId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${params.creds.secretKey}` },
          });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        current_period_end?: number;
        error?: { message?: string };
      };
      if (!res.ok || data.error) {
        const err = data.error?.message ?? `Stripe returned ${res.status}`;
        logger.warn(`stripe cancelSubscription: ${err}`);
        return { id: params.subscriptionId, checkoutId: null, url: null, status: "failed", currentEnd: null, simulated: false, error: err };
      }
      return {
        id: data.id ?? params.subscriptionId,
        checkoutId: null,
        url: null,
        status: data.status ?? "canceled",
        currentEnd: data.current_period_end ?? null,
        simulated: false,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "cancel subscription failed";
      logger.warn(`stripe cancelSubscription error: ${msg}`);
      return { id: params.subscriptionId, checkoutId: null, url: null, status: "failed", currentEnd: null, simulated: false, error: msg };
    }
  }

  // Verifies the Stripe-Signature header (t=timestamp,v1=hmac) and returns the
  // parsed event. Signed payload is `${t}.${rawBody}`, HMAC-SHA256 hex with the
  // webhook secret. Pure crypto, runs even in simulate mode so tests can sign
  // synthetic events. Returns { valid:false } on any mismatch/parse issue.
  constructWebhookEvent(rawBody: string, sigHeader: string, secret: string): StripeWebhookResult {
    if (!secret || !sigHeader) return { valid: false, event: null };
    try {
      const parts: Record<string, string> = {};
      for (const kv of sigHeader.split(",")) {
        const idx = kv.indexOf("=");
        if (idx > 0) parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
      }
      const t = parts["t"];
      const v1 = parts["v1"];
      if (!t || !v1) return { valid: false, event: null };
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${t}.${rawBody}`, "utf8")
        .digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(v1);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, event: null };
      return { valid: true, event: JSON.parse(rawBody) as StripeEvent };
    } catch {
      return { valid: false, event: null };
    }
  }
}

export default new StripeClientService();
