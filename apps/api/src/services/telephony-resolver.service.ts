import config from "../config";
import telephonyRepository from "../repositories/telephony.repository";
import { decryptSecret } from "../utils/crypto";
import type { ExotelCreds } from "./exotel.client";
import type { TwilioCreds } from "./twilio.client";

export interface ResolvedTelephony {
  mode: "tenant" | "default" | "none";
  creds: TwilioCreds;
}

export interface ResolvedExotel {
  mode: "tenant" | "none";
  creds: ExotelCreds;
  // The tenant's main marketing ExoPhone: default outbound CallerId and the
  // number the published inbound flow lives on.
  mainExoPhone: string;
  // Authenticates unsigned Exotel callbacks via the URL path.
  webhookToken: string;
}

const EMPTY_EXOTEL: ResolvedExotel = {
  mode: "none",
  creds: { sid: "", apiKey: "", apiToken: "", subdomain: "" },
  mainExoPhone: "",
  webhookToken: "",
};

// Picks the tenant's own (ACTIVE) Twilio credentials, else the platform default
// from env, else none. Never throws; mirrors the email sender resolver.
class TelephonyResolverService {
  async resolve(tenantId: string): Promise<ResolvedTelephony> {
    const cfg = await telephonyRepository.getConfig(tenantId);
    if (
      cfg &&
      // The row stores whichever provider the tenant is on. Without this gate,
      // a tenant that switched to Exotel would have its Exotel SID/token handed
      // to the Twilio SDK by every caller of resolve() (click-to-call, the
      // calls poller, the voice AI engine).
      cfg.provider === "TWILIO" &&
      cfg.status === "ACTIVE" &&
      cfg.account_sid &&
      cfg.auth_token_encrypted &&
      cfg.from_number
    ) {
      try {
        return {
          mode: "tenant",
          creds: {
            accountSid: cfg.account_sid,
            authToken: decryptSecret(cfg.auth_token_encrypted),
            fromNumber: cfg.from_number,
          },
        };
      } catch {
        // Corrupt token: fall back to the default tier.
      }
    }

    if (
      config.TWILIO_ACCOUNT_SID &&
      config.TWILIO_AUTH_TOKEN &&
      config.TWILIO_DEFAULT_FROM_NUMBER
    ) {
      return {
        mode: "default",
        creds: {
          accountSid: config.TWILIO_ACCOUNT_SID,
          authToken: config.TWILIO_AUTH_TOKEN,
          fromNumber: config.TWILIO_DEFAULT_FROM_NUMBER,
        },
      };
    }

    return { mode: "none", creds: { accountSid: "", authToken: "", fromNumber: "" } };
  }

  // Which provider the tenant's saved config selects. Twilio is the default so
  // existing behavior (including the platform default Twilio tier for
  // unconfigured tenants) is unchanged.
  async activeProvider(tenantId: string): Promise<"EXOTEL" | "TWILIO"> {
    const cfg = await telephonyRepository.getConfig(tenantId);
    return cfg?.provider === "EXOTEL" ? "EXOTEL" : "TWILIO";
  }

  // Exotel is BYO-only: there is no platform default account, so the tiers are
  // just tenant | none. Never throws.
  async resolveExotel(tenantId: string): Promise<ResolvedExotel> {
    const cfg = await telephonyRepository.getConfig(tenantId);
    if (
      !cfg ||
      cfg.provider !== "EXOTEL" ||
      cfg.status !== "ACTIVE" ||
      !cfg.account_sid ||
      !cfg.api_key_encrypted ||
      !cfg.auth_token_encrypted ||
      !cfg.subdomain ||
      !cfg.from_number ||
      !cfg.webhook_token
    ) {
      return EMPTY_EXOTEL;
    }
    try {
      return {
        mode: "tenant",
        creds: {
          sid: cfg.account_sid,
          apiKey: decryptSecret(cfg.api_key_encrypted),
          apiToken: decryptSecret(cfg.auth_token_encrypted),
          subdomain: cfg.subdomain,
        },
        mainExoPhone: cfg.from_number,
        webhookToken: cfg.webhook_token,
      };
    } catch {
      // Corrupt ciphertext: behave as unconfigured rather than throwing.
      return EMPTY_EXOTEL;
    }
  }
}

export default new TelephonyResolverService();
