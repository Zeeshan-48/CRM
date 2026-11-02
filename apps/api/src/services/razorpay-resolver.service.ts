import config from "../config";
import razorpayConfigRepository from "../repositories/razorpay-config.repository";
import { decryptSecret } from "../utils/crypto";
import type { RazorpayCreds } from "./razorpay.client";

export interface ResolvedRazorpay {
  mode: "tenant" | "default" | "none";
  creds: RazorpayCreds;
}

// Picks the tenant's own (ACTIVE) Razorpay credentials, else the platform default
// from env, else none. Never throws; mirrors the telephony/whatsapp resolvers.
class RazorpayResolverService {
  async resolve(tenantId: string): Promise<ResolvedRazorpay> {
    const cfg = await razorpayConfigRepository.getConfig(tenantId);
    if (cfg && cfg.status === "ACTIVE" && cfg.key_id && cfg.key_secret_encrypted) {
      try {
        return {
          mode: "tenant",
          creds: { keyId: cfg.key_id, keySecret: decryptSecret(cfg.key_secret_encrypted) },
        };
      } catch {
        // Corrupt secret: fall back to the default tier.
      }
    }

    if (config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET) {
      return {
        mode: "default",
        creds: { keyId: config.RAZORPAY_KEY_ID, keySecret: config.RAZORPAY_KEY_SECRET },
      };
    }

    return { mode: "none", creds: { keyId: "", keySecret: "" } };
  }
}

export default new RazorpayResolverService();
