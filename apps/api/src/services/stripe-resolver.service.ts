import config from "../config";
import stripeConfigRepository from "../repositories/stripe-config.repository";
import { decryptSecret } from "../utils/crypto";
import type { StripeCreds } from "./stripe.client";

export interface ResolvedStripe {
  mode: "tenant" | "default" | "none";
  creds: StripeCreds;
}

// Picks the tenant's own (ACTIVE) Stripe secret key, else the platform default from
// env, else none. Never throws; mirrors the razorpay resolver.
class StripeResolverService {
  async resolve(tenantId: string): Promise<ResolvedStripe> {
    const cfg = await stripeConfigRepository.getConfig(tenantId);
    if (cfg && cfg.status === "ACTIVE" && cfg.secret_key_encrypted) {
      try {
        return { mode: "tenant", creds: { secretKey: decryptSecret(cfg.secret_key_encrypted) } };
      } catch {
        // Corrupt secret: fall back to the default tier.
      }
    }

    if (config.STRIPE_SECRET_KEY) {
      return { mode: "default", creds: { secretKey: config.STRIPE_SECRET_KEY } };
    }

    return { mode: "none", creds: { secretKey: "" } };
  }
}

export default new StripeResolverService();
