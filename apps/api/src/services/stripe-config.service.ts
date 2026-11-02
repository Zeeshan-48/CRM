import { BadRequestError } from "../errors";
import stripeConfigRepository from "../repositories/stripe-config.repository";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import engineService from "./engine.service";
import stripeClient from "./stripe.client";

const maskKey = (key: string): string =>
  key.length > 10 ? `${key.slice(0, 7)}…${key.slice(-4)}` : "set";

// BYO Stripe credential management. Only a secret key is needed; it's the true
// secret (encrypted at rest) and never returned except via the audited reveal.
class StripeConfigService {
  async getConfig(tenantId: string) {
    const cfg = await stripeConfigRepository.getConfig(tenantId);
    // Show the key prefix (sk_test_ / sk_live_) so the UI hints at the mode.
    let hint: string | null = null;
    if (cfg?.secret_key_encrypted) {
      try {
        hint = maskKey(decryptSecret(cfg.secret_key_encrypted));
      } catch {
        hint = "set";
      }
    }
    return {
      configured: !!cfg,
      status: cfg?.status ?? "PENDING",
      secret_key_hint: hint,
      secret_key_set: !!cfg?.secret_key_encrypted,
      verified_at: cfg?.verified_at ?? null,
      last_error: cfg?.last_error ?? null,
      defaultAvailable: stripeClient.isDefaultLive() || stripeClient.isSimulated(),
      simulated: stripeClient.isSimulated(),
    };
  }

  async saveConfig(tenantId: string, actorId: string, body: { secretKey?: string }) {
    const existing = await stripeConfigRepository.getConfig(tenantId);
    const rawKey = String(body.secretKey ?? "").trim();
    const secretKeyEncrypted = rawKey
      ? encryptSecret(rawKey)
      : (existing?.secret_key_encrypted ?? "");

    if (!secretKeyEncrypted) {
      throw new BadRequestError("secretKey is required");
    }

    const row = await stripeConfigRepository.upsertConfig({
      tenant_id: tenantId,
      secret_key_encrypted: secretKeyEncrypted,
    });
    engineService.audit(tenantId, actorId, "stripe.config_saved", "tenant_stripe", row.id, {});
    return this.getConfig(tenantId);
  }

  async validate(tenantId: string, actorId: string) {
    const cfg = await stripeConfigRepository.getConfig(tenantId);
    if (!cfg || !cfg.secret_key_encrypted) {
      throw new BadRequestError("Add a Stripe secret key first");
    }
    const secret = decryptSecret(cfg.secret_key_encrypted);

    const result = await stripeClient.validateCredentials(secret);
    if (!result.ok) {
      await stripeConfigRepository.updateStatus(tenantId, {
        status: "PENDING",
        last_error: result.error ?? "Invalid credentials",
      });
      return this.getConfig(tenantId);
    }

    await stripeConfigRepository.updateStatus(tenantId, {
      status: "ACTIVE",
      verified_at: new Date(),
      last_error: null,
    });
    engineService.audit(tenantId, actorId, "stripe.validated", "tenant_stripe", cfg.id, {});
    return this.getConfig(tenantId);
  }

  async remove(tenantId: string, actorId: string) {
    await stripeConfigRepository.removeConfig(tenantId);
    engineService.audit(tenantId, actorId, "stripe.config_removed", "tenant_stripe", tenantId, {});
    return { ok: true };
  }
}

export default new StripeConfigService();
