import { randomInt } from "crypto";
import { BadRequestError, ConflictError } from "../errors";
import whatsappConfigRepository from "../repositories/whatsapp-config.repository";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import engineService from "./engine.service";
import whatsappClient from "./whatsapp.client";

// BYO WhatsApp (Meta Cloud API) connection via Meta Embedded Signup only. The
// tenant connects THEIR OWN WABA + number through the Facebook popup; the operator is
// the Tech Provider that brokers the OAuth code exchange. The access token +
// 2FA registration PIN are the only secrets and are encrypted at rest. There is
// no manual credential entry.
class WhatsappConfigService {
  async getConfig(tenantId: string) {
    const cfg = await whatsappConfigRepository.getConfig(tenantId);
    return {
      configured: !!cfg,
      status: cfg?.status ?? "PENDING",
      connect_method: cfg?.connect_method ?? "EMBEDDED",
      phone_number_id: cfg?.phone_number_id ?? null,
      waba_id: cfg?.waba_id ?? null,
      business_id: cfg?.business_id ?? null,
      display_phone_number: cfg?.display_phone_number ?? null,
      verified_name: cfg?.verified_name ?? null,
      // The access token is never returned, just a flag for the UI.
      access_token_set: !!cfg?.access_token_encrypted,
      verified_at: cfg?.verified_at ?? null,
      last_error: cfg?.last_error ?? null,
      // Whether the platform is wired for Embedded Signup (drives the Connect
      // button). The platform default tier is used when no tenant config exists.
      embeddedAvailable: whatsappClient.isEmbeddedConfigured(),
      defaultAvailable: whatsappClient.isDefaultLive() || whatsappClient.isSimulated(),
      simulated: whatsappClient.isSimulated(),
    };
  }

  // Embedded Signup onboarding. Receives the popup's { code, wabaId,
  // phoneNumberId, businessId }; exchanges the code for the tenant's token,
  // fetches phone metadata, registers the phone (reusing the stored PIN on
  // reconnect), subscribes our app to the WABA, and stores everything encrypted.
  async onboardEmbedded(
    tenantId: string,
    actorId: string,
    body: { code?: string; wabaId?: string; phoneNumberId?: string; businessId?: string }
  ) {
    const code = String(body.code ?? "").trim();
    const wabaId = String(body.wabaId ?? "").trim();
    const phoneNumberId = String(body.phoneNumberId ?? "").trim();
    const businessId = String(body.businessId ?? "").trim() || null;
    if (!code || !wabaId || !phoneNumberId) {
      throw new BadRequestError("code, wabaId and phoneNumberId are required");
    }

    // Conflict: this WABA is already connected to a different workspace.
    const byWaba = await whatsappConfigRepository.findByWabaId(wabaId);
    if (byWaba && byWaba.tenant_id !== tenantId) {
      throw new ConflictError(
        "This WhatsApp Business Account is already connected to another workspace"
      );
    }

    // 1. Exchange the OAuth code for the tenant's long-lived token.
    const exchange = await whatsappClient.exchangeCode(code);
    if (!exchange.accessToken) {
      throw new BadRequestError(exchange.error ?? "Could not exchange the authorization code");
    }
    const token = exchange.accessToken;

    // 2. Fetch phone metadata (display number + verified name) with the raw token.
    const phone = await whatsappClient.validateCredentials(phoneNumberId, token);

    // 3. Registration PIN, reuse the tenant's stored PIN on reconnect (Meta
    //    locks the number for 7 days if a different PIN is submitted).
    const existing = await whatsappConfigRepository.getConfig(tenantId);
    let pin = "";
    if (existing?.registration_pin_encrypted) {
      try {
        pin = decryptSecret(existing.registration_pin_encrypted);
      } catch {
        pin = "";
      }
    }
    if (!pin) pin = String(randomInt(100000, 1000000));

    // 4. Register the phone for Cloud API (already-registered is non-fatal).
    const reg = await whatsappClient.registerPhone(phoneNumberId, pin, token);

    // 5. Subscribe our app to the WABA so webhooks flow (best-effort).
    await whatsappClient.subscribeApp(wabaId, token);

    // 6. Persist. ACTIVE only when phone metadata + registration both succeeded.
    const status = phone.ok && reg.ok ? "ACTIVE" : "PENDING";
    const row = await whatsappConfigRepository.upsertEmbedded({
      tenant_id: tenantId,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      business_id: businessId,
      access_token_encrypted: encryptSecret(token),
      registration_pin_encrypted: encryptSecret(pin),
      display_phone_number: phone.displayPhoneNumber ?? null,
      verified_name: phone.verifiedName ?? null,
      status,
    });
    if (status !== "ACTIVE") {
      await whatsappConfigRepository.updateStatus(tenantId, {
        last_error: reg.error ?? phone.error ?? "Onboarding incomplete",
      });
    }
    engineService.audit(tenantId, actorId, "whatsapp.embedded_onboarded", "tenant_whatsapp", row.id, {
      wabaId,
      phoneNumberId,
    });
    return this.getConfig(tenantId);
  }

  // Re-sync the connection against Meta (the "Refresh from Meta" action): checks
  // the stored token and refreshes the display number + verified name.
  async validate(tenantId: string, actorId: string) {
    const cfg = await whatsappConfigRepository.getConfig(tenantId);
    if (!cfg || !cfg.phone_number_id || !cfg.access_token_encrypted) {
      throw new BadRequestError("Connect WhatsApp first");
    }
    const token = decryptSecret(cfg.access_token_encrypted);

    const result = await whatsappClient.validateCredentials(cfg.phone_number_id, token);
    if (!result.ok) {
      await whatsappConfigRepository.updateStatus(tenantId, {
        status: "PENDING",
        last_error: result.error ?? "Connection check failed",
      });
      return this.getConfig(tenantId);
    }

    await whatsappConfigRepository.updateStatus(tenantId, {
      status: "ACTIVE",
      verified_at: new Date(),
      last_error: null,
      display_phone_number: result.displayPhoneNumber ?? null,
      verified_name: result.verifiedName ?? null,
    });
    engineService.audit(tenantId, actorId, "whatsapp.validated", "tenant_whatsapp", cfg.id, {});
    return this.getConfig(tenantId);
  }

  // Disconnect: unsubscribe our app from the WABA (best-effort) then delete.
  async remove(tenantId: string, actorId: string) {
    const cfg = await whatsappConfigRepository.getConfig(tenantId);
    if (cfg?.waba_id && cfg.access_token_encrypted) {
      try {
        const token = decryptSecret(cfg.access_token_encrypted);
        await whatsappClient.unsubscribeApp(cfg.waba_id, token);
      } catch {
        // best-effort, never block disconnect
      }
    }
    await whatsappConfigRepository.removeConfig(tenantId);
    engineService.audit(tenantId, actorId, "whatsapp.config_removed", "tenant_whatsapp", tenantId, {});
    return { ok: true };
  }
}

export default new WhatsappConfigService();
