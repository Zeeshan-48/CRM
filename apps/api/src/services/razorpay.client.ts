import crypto from "crypto";
import config from "../config";
import logger from "../utils/logger";

export interface RazorpayCreds {
  keyId: string;
  keySecret: string;
}

export interface RzpValidateResult {
  ok: boolean;
  error?: string;
}

export interface RzpPaymentLink {
  id: string;
  shortUrl: string;
  status: string;
  simulated: boolean;
  error: string | null;
}

export interface RzpLinkStatus {
  // Razorpay payment-link status: created | paid | cancelled | expired.
  status: string;
  paymentId: string | null;
  error: string | null;
}

export interface RzpRefund {
  id: string | null;
  status: string;
  simulated: boolean;
  error: string | null;
}

// --- Platform subscriptions (operator billing) ---

export interface RzpCustomer {
  id: string | null;
  simulated: boolean;
  error: string | null;
}

export interface RzpSubscription {
  id: string | null;
  // created | authenticated | active | pending | halted | cancelled | completed | expired
  status: string;
  shortUrl: string | null; // hosted authorization page for the first payment
  currentEnd: number | null; // unix seconds; end of the current billing cycle
  simulated: boolean;
  error: string | null;
}

const BASE = "https://api.razorpay.com/v1";

// Simulated under tests, or when RAZORPAY_SIMULATE is set, so the whole flow is
// demoable in dev without a Razorpay account and the suite never calls Razorpay.
const simulated = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true" || config.RAZORPAY_SIMULATE;

const authHeader = (creds: RazorpayCreds): string =>
  `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;

// Razorpay seam. Every outbound call to api.razorpay.com funnels through here
// (fixed host, no SSRF surface). Never throws: callers get a structured
// { error } so a failed payment action is surfaced, not swallowed.
class RazorpayClientService {
  isSimulated(): boolean {
    return simulated();
  }

  isDefaultLive(): boolean {
    return Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET) && !simulated();
  }

  private keyed(creds: RazorpayCreds): boolean {
    return Boolean(creds.keyId && creds.keySecret);
  }

  // Confirms the credentials by hitting a lightweight authenticated endpoint.
  async validateCredentials(keyId: string, keySecret: string): Promise<RzpValidateResult> {
    if (simulated()) return { ok: true };
    if (!keyId || !keySecret) return { ok: false, error: "key id and key secret are required" };
    try {
      const res = await fetch(`${BASE}/payments?count=1`, {
        headers: { Authorization: authHeader({ keyId, keySecret }) },
      });
      if (res.status === 401) return { ok: false, error: "Invalid Razorpay credentials" };
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
        return { ok: false, error: body.error?.description ?? `Razorpay returned ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "validation failed" };
    }
  }

  // Creates a hosted payment link the customer can pay. amountPaise is the
  // amount in the smallest unit (paise), invoices are in rupees, so callers ×100.
  async createPaymentLink(params: {
    creds: RazorpayCreds;
    amountPaise: number;
    description: string;
    referenceId: string;
    customer?: { name?: string | null; email?: string | null; contact?: string | null };
  }): Promise<RzpPaymentLink> {
    if (simulated() || !this.keyed(params.creds)) {
      const id = `plink_sim_${params.referenceId}`;
      return {
        id,
        shortUrl: `${config.APP_PUBLIC_URL}/sim-pay/${id}`,
        status: "created",
        simulated: true,
        error: null,
      };
    }
    try {
      const customer = params.customer
        ? {
            name: params.customer.name ?? undefined,
            email: params.customer.email ?? undefined,
            contact: params.customer.contact ?? undefined,
          }
        : undefined;
      const res = await fetch(`${BASE}/payment_links`, {
        method: "POST",
        headers: {
          Authorization: authHeader(params.creds),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: params.amountPaise,
          currency: "INR",
          description: params.description.slice(0, 2048),
          reference_id: params.referenceId,
          ...(customer ? { customer } : {}),
          notify: { sms: false, email: false },
          reminder_enable: false,
        }),
      });
      const data = (await res.json()) as {
        id?: string;
        short_url?: string;
        status?: string;
        error?: { description?: string };
      };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.description ?? `Razorpay returned ${res.status}`;
        logger.warn(`razorpay createPaymentLink: ${err}`);
        return { id: "", shortUrl: "", status: "failed", simulated: false, error: err };
      }
      return {
        id: data.id,
        shortUrl: data.short_url ?? "",
        status: data.status ?? "created",
        simulated: false,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "create link failed";
      logger.warn(`razorpay createPaymentLink error: ${msg}`);
      return { id: "", shortUrl: "", status: "failed", simulated: false, error: msg };
    }
  }

  // Polls a payment link's status. Returns null for simulated links so the poll
  // job leaves them untouched.
  async fetchPaymentLink(creds: RazorpayCreds, linkId: string): Promise<RzpLinkStatus | null> {
    if (simulated() || linkId.startsWith("plink_sim_") || !this.keyed(creds)) return null;
    try {
      const res = await fetch(`${BASE}/payment_links/${linkId}`, {
        headers: { Authorization: authHeader(creds) },
      });
      const data = (await res.json()) as {
        status?: string;
        payments?: Array<{ payment_id?: string; status?: string }>;
        error?: { description?: string };
      };
      if (!res.ok || data.error) {
        return {
          status: "unknown",
          paymentId: null,
          error: data.error?.description ?? `Razorpay returned ${res.status}`,
        };
      }
      const captured = (data.payments ?? []).find((p) => p.status === "captured");
      return { status: data.status ?? "unknown", paymentId: captured?.payment_id ?? null, error: null };
    } catch (err) {
      logger.warn(`razorpay fetchPaymentLink ${linkId}: ${String(err)}`);
      return null;
    }
  }

  // Issues a refund against a captured payment. amountPaise omitted = full refund.
  async createRefund(params: {
    creds: RazorpayCreds;
    paymentId: string;
    amountPaise?: number;
  }): Promise<RzpRefund> {
    if (simulated() || !this.keyed(params.creds)) {
      return { id: `rfnd_sim_${params.paymentId}`, status: "processed", simulated: true, error: null };
    }
    try {
      const res = await fetch(`${BASE}/payments/${params.paymentId}/refund`, {
        method: "POST",
        headers: {
          Authorization: authHeader(params.creds),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params.amountPaise ? { amount: params.amountPaise } : {}),
      });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        error?: { description?: string };
      };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.description ?? `Razorpay returned ${res.status}`;
        logger.warn(`razorpay createRefund: ${err}`);
        return { id: null, status: "failed", simulated: false, error: err };
      }
      return { id: data.id, status: data.status ?? "pending", simulated: false, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "refund failed";
      logger.warn(`razorpay createRefund error: ${msg}`);
      return { id: null, status: "failed", simulated: false, error: msg };
    }
  }

  // --- Platform subscriptions (operator billing) -------------------------
  // Same creds seam as the payment-link methods; the platform layer passes
  // the operator's own account creds. All self-guard on simulated() so the test suite
  // and dev never hit Razorpay.

  async createCustomer(params: {
    creds: RazorpayCreds;
    name?: string | null;
    email?: string | null;
    contact?: string | null;
  }): Promise<RzpCustomer> {
    if (simulated() || !this.keyed(params.creds)) {
      return { id: `cust_sim_${Date.now().toString(36)}`, simulated: true, error: null };
    }
    try {
      const res = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers: { Authorization: authHeader(params.creds), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: params.name ?? undefined,
          email: params.email ?? undefined,
          contact: params.contact ?? undefined,
          // Reuse an existing customer with the same email instead of erroring.
          fail_existing: 0,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: { description?: string } };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.description ?? `Razorpay returned ${res.status}`;
        logger.warn(`razorpay createCustomer: ${err}`);
        return { id: null, simulated: false, error: err };
      }
      return { id: data.id, simulated: false, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "create customer failed";
      logger.warn(`razorpay createCustomer error: ${msg}`);
      return { id: null, simulated: false, error: msg };
    }
  }

  // Creates a subscription against an existing Razorpay plan id. total_count is
  // the number of billing cycles to authorize (default 120 = 10 years monthly,
  // effectively "until cancelled"). Returns short_url, the hosted page the
  // tenant admin completes to authorize + pay the first cycle.
  async createSubscription(params: {
    creds: RazorpayCreds;
    planId: string;
    referenceId: string;
    customerId?: string | null;
    totalCount?: number;
    notes?: Record<string, string>;
    // Unix seconds: defer the first charge to this time (used when switching
    // MANUAL->AUTO so the auto cycle begins at the paid period's end).
    startAt?: number;
  }): Promise<RzpSubscription> {
    if (simulated() || !this.keyed(params.creds)) {
      const id = `sub_sim_${params.referenceId}`;
      return {
        id,
        status: "created",
        shortUrl: `${config.BILLING_RETURN_URL}?sim_sub=${id}`,
        currentEnd: params.startAt ?? Math.floor(Date.now() / 1000) + 30 * 86400,
        simulated: true,
        error: null,
      };
    }
    try {
      const res = await fetch(`${BASE}/subscriptions`, {
        method: "POST",
        headers: { Authorization: authHeader(params.creds), "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: params.planId,
          total_count: params.totalCount ?? 120,
          quantity: 1,
          customer_notify: 1,
          ...(params.startAt ? { start_at: params.startAt } : {}),
          ...(params.customerId ? { customer_id: params.customerId } : {}),
          ...(params.notes ? { notes: params.notes } : {}),
        }),
      });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        short_url?: string;
        current_end?: number;
        error?: { description?: string };
      };
      if (!res.ok || data.error || !data.id) {
        const err = data.error?.description ?? `Razorpay returned ${res.status}`;
        logger.warn(`razorpay createSubscription: ${err}`);
        return { id: null, status: "failed", shortUrl: null, currentEnd: null, simulated: false, error: err };
      }
      return {
        id: data.id,
        status: data.status ?? "created",
        shortUrl: data.short_url ?? null,
        currentEnd: data.current_end ?? null,
        simulated: false,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "create subscription failed";
      logger.warn(`razorpay createSubscription error: ${msg}`);
      return { id: null, status: "failed", shortUrl: null, currentEnd: null, simulated: false, error: msg };
    }
  }

  async fetchSubscription(creds: RazorpayCreds, subscriptionId: string): Promise<RzpSubscription> {
    if (simulated() || subscriptionId.startsWith("sub_sim_") || !this.keyed(creds)) {
      return { id: subscriptionId, status: "active", shortUrl: null, currentEnd: null, simulated: true, error: null };
    }
    try {
      const res = await fetch(`${BASE}/subscriptions/${subscriptionId}`, {
        headers: { Authorization: authHeader(creds) },
      });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        short_url?: string;
        current_end?: number;
        error?: { description?: string };
      };
      if (!res.ok || data.error) {
        return {
          id: subscriptionId,
          status: "unknown",
          shortUrl: null,
          currentEnd: null,
          simulated: false,
          error: data.error?.description ?? `Razorpay returned ${res.status}`,
        };
      }
      return {
        id: data.id ?? subscriptionId,
        status: data.status ?? "unknown",
        shortUrl: data.short_url ?? null,
        currentEnd: data.current_end ?? null,
        simulated: false,
        error: null,
      };
    } catch (err) {
      logger.warn(`razorpay fetchSubscription ${subscriptionId}: ${String(err)}`);
      return { id: subscriptionId, status: "unknown", shortUrl: null, currentEnd: null, simulated: false, error: String(err) };
    }
  }

  async cancelSubscription(params: {
    creds: RazorpayCreds;
    subscriptionId: string;
    atCycleEnd?: boolean;
  }): Promise<RzpSubscription> {
    if (simulated() || params.subscriptionId.startsWith("sub_sim_") || !this.keyed(params.creds)) {
      return { id: params.subscriptionId, status: "cancelled", shortUrl: null, currentEnd: null, simulated: true, error: null };
    }
    try {
      const res = await fetch(`${BASE}/subscriptions/${params.subscriptionId}/cancel`, {
        method: "POST",
        headers: { Authorization: authHeader(params.creds), "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_at_cycle_end: params.atCycleEnd ? 1 : 0 }),
      });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        current_end?: number;
        error?: { description?: string };
      };
      if (!res.ok || data.error) {
        const err = data.error?.description ?? `Razorpay returned ${res.status}`;
        logger.warn(`razorpay cancelSubscription: ${err}`);
        return { id: params.subscriptionId, status: "failed", shortUrl: null, currentEnd: null, simulated: false, error: err };
      }
      return {
        id: data.id ?? params.subscriptionId,
        status: data.status ?? "cancelled",
        shortUrl: null,
        currentEnd: data.current_end ?? null,
        simulated: false,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "cancel subscription failed";
      logger.warn(`razorpay cancelSubscription error: ${msg}`);
      return { id: params.subscriptionId, status: "failed", shortUrl: null, currentEnd: null, simulated: false, error: msg };
    }
  }

  // Verifies the X-Razorpay-Signature header: HMAC-SHA256(rawBody, webhookSecret)
  // in hex. Pure crypto (no network), runs even in simulate mode so tests can
  // exercise real signature checking. Returns false on any mismatch/parse issue.
  verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
    if (!secret || !signature) return false;
    try {
      const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

export default new RazorpayClientService();
