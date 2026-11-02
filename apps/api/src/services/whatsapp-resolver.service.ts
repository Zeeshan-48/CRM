import config from "../config";
import whatsappConfigRepository from "../repositories/whatsapp-config.repository";
import { decryptSecret } from "../utils/crypto";
import type { WhatsappCreds } from "./whatsapp.client";

export interface ResolvedWhatsapp {
  mode: "tenant" | "default" | "none";
  creds: WhatsappCreds;
}

// Picks the tenant's own (ACTIVE) WhatsApp credentials, else the platform default
// from env, else none. Never throws; mirrors the telephony + email sender
// resolvers.
class WhatsappResolverService {
  async resolve(tenantId: string): Promise<ResolvedWhatsapp> {
    const cfg = await whatsappConfigRepository.getConfig(tenantId);
    if (
      cfg &&
      cfg.status === "ACTIVE" &&
      cfg.phone_number_id &&
      cfg.access_token_encrypted
    ) {
      try {
        return {
          mode: "tenant",
          creds: {
            phoneNumberId: cfg.phone_number_id,
            accessToken: decryptSecret(cfg.access_token_encrypted),
          },
        };
      } catch {
        // Corrupt token: fall back to the default tier.
      }
    }

    if (config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_API_KEY) {
      return {
        mode: "default",
        creds: {
          phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
          accessToken: config.WHATSAPP_API_KEY,
        },
      };
    }

    return { mode: "none", creds: { phoneNumberId: "", accessToken: "" } };
  }
}

export default new WhatsappResolverService();
