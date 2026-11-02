import { sealSecret } from "../utils/crypto";
import crypto from "crypto";
import { ulid } from "ulid";
import { BadRequestError, NotFoundError } from "../errors";
import integrationsRepository, {
  IntegrationRow,
  WebhookRow,
} from "../repositories/integrations.repository";
import webhookDeliveriesRepository from "../repositories/webhook-deliveries.repository";
import tenantsRepository from "../repositories/tenants.repository";
import engineService from "./engine.service";
import { aiProvider } from "./ai/provider";
import emailResolverService from "./email-resolver.service";
import googleCalendarService from "./google-calendar.service";
import razorpayConfigService from "./razorpay-config.service";
import stripeConfigService from "./stripe-config.service";
import telephonyService from "./telephony.service";
import webhookDispatchService from "./webhook-dispatch.service";
import whatsappConfigService from "./whatsapp-config.service";

interface CatalogueItem {
  key: string;
  name: string;
}

export const CATALOGUE: Record<string, CatalogueItem[]> = {
  erp: [
    { key: "sap", name: "SAP" },
    { key: "oracle", name: "Oracle" },
    { key: "zoho", name: "Zoho" },
    { key: "tally", name: "Tally" },
  ],
  ecommerce: [
    { key: "shopify", name: "Shopify" },
    { key: "woocommerce", name: "WooCommerce" },
    { key: "magento", name: "Magento" },
  ],
  calendar: [
    { key: "google", name: "Google Calendar" },
    { key: "outlook", name: "Microsoft Outlook" },
  ],
  payments: [
    { key: "razorpay", name: "Razorpay" },
    { key: "stripe", name: "Stripe" },
    { key: "cashfree", name: "Cashfree" },
  ],
  communication: [
    { key: "whatsapp", name: "WhatsApp Business API" },
    { key: "telegram", name: "Telegram" },
    { key: "gmail", name: "Gmail" },
  ],
};

// Events an external product can subscribe to. These are the same names the
// automation engine emits, so a workflow trigger and a webhook subscription
// always mean the same thing.
export const WEBHOOK_EVENTS = [
  "lead.created",
  "lead.converted",
  "lead.stage_changed",
  "deal.stage_changed",
  "deal.won",
  "ticket.created",
  "payment.success",
  "meeting.scheduled",
  // Product-integration events: let the product react to what sales learns.
  "product.high_intent",
  "product.checkout_abandoned",
] as const;

export const SECURITY_DEFAULTS = {
  mfa: false,
  ssoGoogle: false,
  ssoMicrosoft: false,
  saml: false,
  deviceControl: false,
  ipRestrictions: [] as string[],
};

export type SecuritySettings = typeof SECURITY_DEFAULTS;

// ---- Connection status dashboard ----
// A read-only, aggregated view of which EXTERNAL services this workspace has
// wired up. Each real integration is configured on its own page (WhatsApp,
// Email, Finance, Telephony, etc.); this pulls each one's live status so an
// admin can see everything connected in one place. Nothing is written here.
export type ConnectionState =
  | "connected" // tenant brought their own credentials, verified/active
  | "pending" // configured but not yet verified/active
  | "default" // running on the shared platform account (no BYO needed)
  | "simulated" // dev/simulate mode, no real external link
  | "not_connected" // nothing configured
  | "unavailable"; // feature not enabled on this platform

export interface ConnectionStatus {
  key: string;
  name: string;
  category: string;
  scope: "tenant" | "user" | "platform";
  state: ConnectionState;
  detail: string | null;
  managePath: string | null;
}

// The common BYO-or-platform-default tier used by most config services. Note the
// service `defaultAvailable` flags are `isDefaultLive() || isSimulated()`, so
// `simulated` is checked before `default` to label dev mode honestly.
const tierState = (o: {
  configured: boolean;
  active: boolean;
  defaultAvailable?: boolean;
  simulated?: boolean;
}): ConnectionState => {
  if (o.active) return "connected";
  if (o.configured) return "pending";
  if (o.simulated) return "simulated";
  if (o.defaultAvailable) return "default";
  return "not_connected";
};

const stateDetail = (state: ConnectionState, lastError?: string | null): string | null => {
  switch (state) {
    case "pending":
      return lastError || "Configured, awaiting verification";
    case "default":
      return "Using the platform's shared account";
    case "simulated":
      return "Simulated (dev mode), no live external link";
    default:
      return null;
  }
};

const catalogueEntry = (key: string): (CatalogueItem & { category: string }) | undefined => {
  for (const [category, items] of Object.entries(CATALOGUE)) {
    const item = items.find((i) => i.key === key);
    if (item) return { ...item, category };
  }
  return undefined;
};

// Credentials are write-only: stored on connect, never sent back to clients.
const withoutCredentials = (row: IntegrationRow): Omit<IntegrationRow, "credentials"> => {
  const { credentials: _credentials, ...rest } = row;
  return rest;
};

const withoutSecret = (row: WebhookRow): Omit<WebhookRow, "secret"> => {
  const { secret: _secret, ...rest } = row;
  return rest;
};

const parseSecurity = (config: unknown): SecuritySettings => {
  const conf =
    config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const sec =
    conf.security && typeof conf.security === "object"
      ? (conf.security as Record<string, unknown>)
      : {};
  return {
    mfa: typeof sec.mfa === "boolean" ? sec.mfa : SECURITY_DEFAULTS.mfa,
    ssoGoogle: typeof sec.ssoGoogle === "boolean" ? sec.ssoGoogle : SECURITY_DEFAULTS.ssoGoogle,
    ssoMicrosoft:
      typeof sec.ssoMicrosoft === "boolean" ? sec.ssoMicrosoft : SECURITY_DEFAULTS.ssoMicrosoft,
    saml: typeof sec.saml === "boolean" ? sec.saml : SECURITY_DEFAULTS.saml,
    deviceControl:
      typeof sec.deviceControl === "boolean" ? sec.deviceControl : SECURITY_DEFAULTS.deviceControl,
    ipRestrictions: Array.isArray(sec.ipRestrictions)
      ? sec.ipRestrictions.filter((v): v is string => typeof v === "string")
      : SECURITY_DEFAULTS.ipRestrictions,
  };
};

class IntegrationsService {
  // ---- Connectors ----

  async catalogue(tenantId: string) {
    const connected = await integrationsRepository.listByTenant(tenantId);
    const out: Record<string, Array<CatalogueItem & { category: string; connected: boolean }>> =
      {};
    for (const [category, items] of Object.entries(CATALOGUE)) {
      out[category] = items.map((item) => ({
        ...item,
        category,
        connected: connected.some((c) => c.key === item.key && c.connected),
      }));
    }
    return out;
  }

  async connect(
    tenantId: string,
    actorId: string,
    key: string,
    body: Record<string, unknown>
  ) {
    const def = catalogueEntry(key);
    if (!def) throw new BadRequestError("Unknown integration");

    // Stored sealed (AES-256-GCM) and never returned by any endpoint.
    const credentials =
      body && typeof body === "object" && Object.keys(body).length > 0
        ? { sealed: sealSecret(JSON.stringify(body)) }
        : null;
    const row = await integrationsRepository.upsertConnected({
      tenant_id: tenantId,
      key: def.key,
      name: def.name,
      category: def.category,
      credentials,
    });
    engineService.audit(tenantId, actorId, "integration.connected", "integration", def.key);
    return withoutCredentials(row);
  }

  async disconnect(tenantId: string, actorId: string, key: string) {
    const row = await integrationsRepository.setDisconnected(tenantId, key);
    if (!row) throw new NotFoundError("Integration not found");
    engineService.audit(tenantId, actorId, "integration.disconnected", "integration", key);
    return withoutCredentials(row);
  }

  // ---- Webhooks ----

  async listWebhooks(tenantId: string) {
    const webhooks = await integrationsRepository.listWebhooks(tenantId);
    return { events: [...WEBHOOK_EVENTS], webhooks: webhooks.map(withoutSecret) };
  }

  async createWebhook(tenantId: string, actorId: string, body: { url?: string; event?: string }) {
    if (!body.url || !body.event) throw new BadRequestError("url and event required");
    const secret = `whsec_${ulid()}`;
    const webhook = await integrationsRepository.createWebhook({
      tenant_id: tenantId,
      url: String(body.url),
      event: String(body.event),
      secret: sealSecret(secret),
    });
    engineService.audit(tenantId, actorId, "webhook.created", "webhook", webhook.id, {
      event: webhook.event,
    });
    // The signing secret is shown exactly once, on creation; it is stored sealed.
    return { ...webhook, secret };
  }

  /**
   * Sends a REAL, signed test delivery and reports what actually happened.
   *
   * This previously incremented the delivery counter and returned a hardcoded
   * `{ id: "demo" }` without making a request, so "Test" always appeared to
   * succeed even against an endpoint that did not exist.
   */
  async testWebhook(tenantId: string, _tenantSlug: string, webhookId: string) {
    const webhook = await integrationsRepository.findWebhookById(webhookId, tenantId);
    if (!webhook) throw new NotFoundError("Webhook not found");

    const result = await webhookDispatchService.test(tenantId, webhookId);
    const delivery = await webhookDeliveriesRepository.findById(result.deliveryId, tenantId);

    return {
      ok: result.ok,
      delivery: {
        id: result.deliveryId,
        event: webhook.event,
        url: webhook.url,
        status: delivery?.status ?? "PENDING",
        response_code: delivery?.response_code ?? null,
        error: delivery?.error ?? null,
        at: new Date().toISOString(),
      },
    };
  }

  /** The outbound delivery log, with payloads, for the integration console. */
  async listDeliveries(
    tenantId: string,
    filters: { webhookId?: string; status?: string; limit?: number } = {}
  ) {
    return webhookDeliveriesRepository.list(tenantId, {
      webhookId: filters.webhookId ?? null,
      status: filters.status ?? null,
      limit: filters.limit,
    });
  }

  /** Requeues a failed delivery from the UI, resetting the attempt ladder. */
  async replayDelivery(tenantId: string, actorId: string, deliveryId: string) {
    const requeued = await webhookDeliveriesRepository.requeue(deliveryId, tenantId);
    if (!requeued) throw new NotFoundError("Delivery not found or already queued");
    engineService.audit(tenantId, actorId, "webhook.replayed", "webhook_delivery", deliveryId);
    return { ok: true };
  }

  async deleteWebhook(tenantId: string, webhookId: string) {
    const deleted = await integrationsRepository.deleteWebhook(webhookId, tenantId);
    if (!deleted) throw new NotFoundError("Webhook not found");
    return { ok: true };
  }

  // ---- API keys ----

  async listApiKeys(tenantId: string) {
    return integrationsRepository.listActiveApiKeys(tenantId);
  }

  async createApiKey(tenantId: string, actorId: string, body: { name?: string }) {
    const rawKey = `crm_sk_${crypto.randomBytes(16).toString("hex")}`;
    const row = await integrationsRepository.createApiKey({
      tenant_id: tenantId,
      name: body.name && String(body.name).trim() ? String(body.name).trim() : "Default key",
      key_hash: crypto.createHash("sha256").update(rawKey).digest("hex"),
      key_prefix: rawKey.slice(0, 14),
      created_by: actorId,
    });
    engineService.audit(tenantId, actorId, "apikey.created", "apiKey", row.id);
    return {
      id: row.id,
      name: row.name,
      key: rawKey,
      key_prefix: row.key_prefix,
      created_at: row.created_at,
      note: "Save this key now. It will not be shown again.",
    };
  }

  async revokeApiKey(tenantId: string, actorId: string, keyId: string) {
    const revoked = await integrationsRepository.revokeApiKey(keyId, tenantId);
    if (!revoked) throw new NotFoundError("API key not found");
    engineService.audit(tenantId, actorId, "apikey.revoked", "apiKey", keyId);
    return { ok: true };
  }

  // ---- Security settings (stored under tenants.config.security) ----

  async security(tenantId: string): Promise<SecuritySettings> {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Workspace not found");
    return parseSecurity(tenant.config);
  }

  async updateSecurity(
    tenantId: string,
    actorId: string,
    body: Partial<SecuritySettings>
  ): Promise<SecuritySettings> {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Workspace not found");

    const current = parseSecurity(tenant.config);
    const next: SecuritySettings = { ...current };
    if (typeof body.mfa === "boolean") next.mfa = body.mfa;
    if (typeof body.ssoGoogle === "boolean") next.ssoGoogle = body.ssoGoogle;
    if (typeof body.ssoMicrosoft === "boolean") next.ssoMicrosoft = body.ssoMicrosoft;
    if (typeof body.saml === "boolean") next.saml = body.saml;
    if (typeof body.deviceControl === "boolean") next.deviceControl = body.deviceControl;
    if (Array.isArray(body.ipRestrictions)) {
      next.ipRestrictions = body.ipRestrictions.filter(
        (v): v is string => typeof v === "string"
      );
    }

    const config =
      tenant.config && typeof tenant.config === "object"
        ? (tenant.config as Record<string, unknown>)
        : {};
    await tenantsRepository.update(tenantId, { config: { ...config, security: next } });
    engineService.audit(tenantId, actorId, "security.updated", "tenant", tenantId);
    return next;
  }

  // ---- Connection status (read-only aggregator) ----

  async connections(tenantId: string, userId: string): Promise<ConnectionStatus[]> {
    // Fail-open: a single service hiccup should never blank the whole dashboard.
    const safe = <T>(p: Promise<T>): Promise<T | null> => p.then((v) => v).catch(() => null);
    const gcalEnabled = googleCalendarService.isEnabled();

    const [wa, rp, sp, tp, sender, gcal] = await Promise.all([
      safe(whatsappConfigService.getConfig(tenantId)),
      safe(razorpayConfigService.getConfig(tenantId)),
      safe(stripeConfigService.getConfig(tenantId)),
      safe(telephonyService.getConfig(tenantId)),
      safe(emailResolverService.resolveSender(tenantId, "MARKETING")),
      gcalEnabled ? safe(googleCalendarService.status(tenantId, userId)) : Promise.resolve(null),
    ]);

    const out: ConnectionStatus[] = [];
    const unavailable = "Status unavailable";

    // WhatsApp Business (Meta Cloud API), BYO or platform default.
    {
      const state: ConnectionState = wa
        ? tierState({
            configured: wa.configured,
            active: wa.status === "ACTIVE",
            defaultAvailable: wa.defaultAvailable,
            simulated: wa.simulated,
          })
        : "unavailable";
      out.push({
        key: "whatsapp",
        name: "WhatsApp Business",
        category: "Messaging",
        scope: "tenant",
        managePath: "/whatsapp",
        state,
        detail:
          state === "connected" && wa
            ? [wa.display_phone_number, wa.verified_name].filter(Boolean).join(" · ") || "Connected"
            : wa
              ? stateDetail(state, wa.last_error)
              : unavailable,
      });
    }

    // Email sending (Amazon SES), verified custom domain vs shared platform sender.
    {
      const custom = sender?.mode === "custom";
      out.push({
        key: "email",
        name: "Email sending (SES)",
        category: "Email",
        scope: "tenant",
        managePath: "/email-sending",
        state: !sender ? "unavailable" : custom ? "connected" : "default",
        detail: !sender
          ? unavailable
          : custom
            ? sender.fromAddress
            : "Using the platform's shared sender",
      });
    }

    // Razorpay (collect payments from the tenant's own customers), BYO or default.
    {
      const state: ConnectionState = rp
        ? tierState({
            configured: rp.configured,
            active: rp.status === "ACTIVE",
            defaultAvailable: rp.defaultAvailable,
            simulated: rp.simulated,
          })
        : "unavailable";
      out.push({
        key: "razorpay",
        name: "Razorpay",
        category: "Payments",
        scope: "tenant",
        managePath: "/finance",
        state,
        detail:
          state === "connected" && rp
            ? rp.key_id ?? "Connected"
            : rp
              ? stateDetail(state, rp.last_error)
              : unavailable,
      });
    }

    // Stripe, BYO or default.
    {
      const state: ConnectionState = sp
        ? tierState({
            configured: sp.configured,
            active: sp.status === "ACTIVE",
            defaultAvailable: sp.defaultAvailable,
            simulated: sp.simulated,
          })
        : "unavailable";
      out.push({
        key: "stripe",
        name: "Stripe",
        category: "Payments",
        scope: "tenant",
        managePath: "/finance",
        state,
        detail:
          state === "connected" && sp
            ? sp.secret_key_hint ?? "Connected"
            : sp
              ? stateDetail(state, sp.last_error)
              : unavailable,
      });
    }

    // Google Calendar, per-USER OAuth (this reflects the signed-in admin).
    {
      let state: ConnectionState;
      let detail: string | null;
      if (!gcalEnabled) {
        state = "unavailable";
        detail = "Not enabled on this platform";
      } else if (gcal?.connected) {
        state = "connected";
        detail = gcal.email;
      } else {
        state = "not_connected";
        detail = null;
      }
      out.push({
        key: "google_calendar",
        name: "Google Calendar",
        category: "Calendar",
        scope: "user",
        managePath: "/calendar",
        state,
        detail,
      });
    }

    // Telephony click-to-call, Twilio (BYO or platform default) or
    // Exotel (BYO only, so no default tier to fall back on).
    {
      const exotel = tp?.provider === "EXOTEL";
      const state: ConnectionState = tp
        ? tierState({
            configured: tp.configured,
            active: tp.status === "ACTIVE",
            defaultAvailable: exotel ? false : tp.defaultAvailable,
            simulated: exotel ? tp.exotelSimulated : tp.simulated,
          })
        : "unavailable";
      out.push({
        key: "telephony",
        name: exotel ? "Telephony (Exotel)" : "Telephony (Twilio)",
        category: "Voice & calls",
        scope: "tenant",
        managePath: "/telephony",
        state,
        detail:
          state === "connected" && tp
            ? tp.from_number ?? tp.account_sid ?? "Connected"
            : tp
              ? stateDetail(state, tp.last_error)
              : unavailable,
      });
    }

    // Platform LLM (Copilot + AI email writer), platform-wide env key, not per-tenant.
    {
      const name = aiProvider.name;
      const live = name !== "simulated";
      out.push({
        key: "platform_llm",
        name: "AI Copilot & writing",
        category: "Artificial intelligence",
        scope: "platform",
        managePath: null,
        state: live ? "connected" : "simulated",
        detail: live
          ? `${name} (platform key)`
          : "Heuristic simulator, no platform LLM key set",
      });
    }

    return out;
  }
}

export default new IntegrationsService();
