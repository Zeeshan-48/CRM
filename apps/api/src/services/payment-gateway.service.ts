import { db } from "../db/connection";
import razorpayClient, { RazorpayCreds } from "./razorpay.client";
import razorpayResolver from "./razorpay-resolver.service";
import stripeClient, { StripeCreds } from "./stripe.client";
import stripeResolver from "./stripe-resolver.service";

export type GatewayName = "Razorpay" | "Stripe";
export const GATEWAY_NAMES: GatewayName[] = ["Razorpay", "Stripe"];

type AnyCreds = RazorpayCreds | StripeCreds;

export interface ResolvedGateway {
  mode: "tenant" | "default" | "none";
  name: GatewayName;
  creds: AnyCreds;
}

export interface GatewayLink {
  id: string;
  shortUrl: string;
  status: string;
  simulated: boolean;
  error: string | null;
}

export interface GatewayStatus {
  // Normalised across providers: paid | pending | failed.
  status: string;
  paymentId: string | null;
  error: string | null;
}

export interface GatewayRefund {
  id: string | null;
  status: string;
  simulated: boolean;
  error: string | null;
}

const parseConfig = (raw: unknown): Record<string, unknown> => {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
};

// Dispatches payment operations to the right provider (Razorpay or Stripe) and
// resolves which gateway a tenant collects with. Each payment row records its
// own gateway, so confirm/refund always follow the gateway that created it; only
// NEW links use the tenant's default gateway.
class PaymentGatewayService {
  isName(n: string): n is GatewayName {
    return (GATEWAY_NAMES as string[]).includes(n);
  }

  isSimulated(name: GatewayName): boolean {
    return name === "Stripe" ? stripeClient.isSimulated() : razorpayClient.isSimulated();
  }

  async resolveByName(tenantId: string, name: GatewayName): Promise<{ mode: string; creds: AnyCreds }> {
    return name === "Stripe"
      ? stripeResolver.resolve(tenantId)
      : razorpayResolver.resolve(tenantId);
  }

  // The tenant's chosen default gateway (tenants.config.paymentGateway); Razorpay
  // unless explicitly set to Stripe.
  async defaultGateway(tenantId: string): Promise<GatewayName> {
    const t = await db
      .selectFrom("tenants")
      .select(["config"])
      .where("id", "=", tenantId)
      .executeTakeFirst();
    return parseConfig(t?.config).paymentGateway === "Stripe" ? "Stripe" : "Razorpay";
  }

  async setDefaultGateway(tenantId: string, name: GatewayName): Promise<void> {
    const t = await db
      .selectFrom("tenants")
      .select(["config"])
      .where("id", "=", tenantId)
      .executeTakeFirst();
    const merged = { ...parseConfig(t?.config), paymentGateway: name };
    await db
      .updateTable("tenants")
      .set({ config: JSON.stringify(merged), updated_at: new Date() })
      .where("id", "=", tenantId)
      .execute();
  }

  // The gateway to use for a NEW payment link: the tenant default if usable, else
  // the other if usable, else none.
  async resolveForNewLink(tenantId: string): Promise<ResolvedGateway> {
    const preferred = await this.defaultGateway(tenantId);
    const order: GatewayName[] =
      preferred === "Stripe" ? ["Stripe", "Razorpay"] : ["Razorpay", "Stripe"];
    for (const name of order) {
      const r = await this.resolveByName(tenantId, name);
      if (r.mode !== "none") return { mode: r.mode as ResolvedGateway["mode"], name, creds: r.creds };
      if (this.isSimulated(name)) return { mode: "default", name, creds: r.creds };
    }
    return { mode: "none", name: preferred, creds: { keyId: "", keySecret: "" } };
  }

  async createLink(
    name: GatewayName,
    creds: AnyCreds,
    params: {
      amountPaise: number;
      description: string;
      referenceId: string;
      customer?: { name?: string | null; email?: string | null; contact?: string | null };
    }
  ): Promise<GatewayLink> {
    if (name === "Stripe") {
      const s = await stripeClient.createCheckoutSession({ creds: creds as StripeCreds, ...params });
      return { id: s.id, shortUrl: s.url, status: s.status, simulated: s.simulated, error: s.error };
    }
    const r = await razorpayClient.createPaymentLink({ creds: creds as RazorpayCreds, ...params });
    return { id: r.id, shortUrl: r.shortUrl, status: r.status, simulated: r.simulated, error: r.error };
  }

  async fetchStatus(name: GatewayName, creds: AnyCreds, id: string): Promise<GatewayStatus | null> {
    if (name === "Stripe") return stripeClient.fetchSession(creds as StripeCreds, id);
    const r = await razorpayClient.fetchPaymentLink(creds as RazorpayCreds, id);
    if (!r) return null;
    let status = "pending";
    if (r.status === "paid") status = "paid";
    else if (r.status === "cancelled" || r.status === "expired") status = "failed";
    return { status, paymentId: r.paymentId, error: r.error };
  }

  async refund(
    name: GatewayName,
    creds: AnyCreds,
    paymentId: string,
    amountPaise: number
  ): Promise<GatewayRefund> {
    if (name === "Stripe") {
      return stripeClient.createRefund({ creds: creds as StripeCreds, paymentId, amountPaise });
    }
    return razorpayClient.createRefund({ creds: creds as RazorpayCreds, paymentId, amountPaise });
  }
}

export default new PaymentGatewayService();
