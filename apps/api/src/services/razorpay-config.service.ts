import { BadRequestError } from "../errors";
import razorpayConfigRepository from "../repositories/razorpay-config.repository";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import engineService from "./engine.service";
import razorpayClient from "./razorpay.client";

const maskKey = (key: string): string =>
  key.length > 8 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "set";

// BYO Razorpay credential management, connect/validate/disconnect. Mirrors
// telephony.service: the key secret is the only true secret (encrypted at rest);
// the key id is returned masked.
class RazorpayConfigService {
  async getConfig(tenantId: string) {
    const cfg = await razorpayConfigRepository.getConfig(tenantId);
    return {
      configured: !!cfg,
      status: cfg?.status ?? "PENDING",
      key_id: cfg?.key_id ? maskKey(cfg.key_id) : null,
      // The key secret is never returned here, just a flag for the UI.
      key_secret_set: !!cfg?.key_secret_encrypted,
      verified_at: cfg?.verified_at ?? null,
      last_error: cfg?.last_error ?? null,
      // The platform default tier, used when the tenant has no active config.
      defaultAvailable: razorpayClient.isDefaultLive() || razorpayClient.isSimulated(),
      simulated: razorpayClient.isSimulated(),
    };
  }

  async saveConfig(
    tenantId: string,
    actorId: string,
    body: { keyId?: string; keySecret?: string }
  ) {
    // Partial updates: a blank secret keeps the stored value, so an admin can
    // change the key id without re-typing the secret (never handed back).
    const existing = await razorpayConfigRepository.getConfig(tenantId);
    const keyId = String(body.keyId ?? "").trim() || (existing?.key_id ?? "");
    const rawSecret = String(body.keySecret ?? "").trim();
    const keySecretEncrypted = rawSecret
      ? encryptSecret(rawSecret)
      : (existing?.key_secret_encrypted ?? "");

    if (!keyId || !keySecretEncrypted) {
      throw new BadRequestError("keyId and keySecret are required");
    }

    const row = await razorpayConfigRepository.upsertConfig({
      tenant_id: tenantId,
      key_id: keyId,
      key_secret_encrypted: keySecretEncrypted,
    });
    engineService.audit(tenantId, actorId, "razorpay.config_saved", "tenant_razorpay", row.id, {});
    return this.getConfig(tenantId);
  }

  // Validates the stored creds against Razorpay.
  async validate(tenantId: string, actorId: string) {
    const cfg = await razorpayConfigRepository.getConfig(tenantId);
    if (!cfg || !cfg.key_id || !cfg.key_secret_encrypted) {
      throw new BadRequestError("Add Razorpay credentials first");
    }
    const secret = decryptSecret(cfg.key_secret_encrypted);

    const result = await razorpayClient.validateCredentials(cfg.key_id, secret);
    if (!result.ok) {
      await razorpayConfigRepository.updateStatus(tenantId, {
        status: "PENDING",
        last_error: result.error ?? "Invalid credentials",
      });
      return this.getConfig(tenantId);
    }

    await razorpayConfigRepository.updateStatus(tenantId, {
      status: "ACTIVE",
      verified_at: new Date(),
      last_error: null,
    });
    engineService.audit(tenantId, actorId, "razorpay.validated", "tenant_razorpay", cfg.id, {});
    return this.getConfig(tenantId);
  }

  async remove(tenantId: string, actorId: string) {
    await razorpayConfigRepository.removeConfig(tenantId);
    engineService.audit(tenantId, actorId, "razorpay.config_removed", "tenant_razorpay", tenantId, {});
    return { ok: true };
  }
}

export default new RazorpayConfigService();
