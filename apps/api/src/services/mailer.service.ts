import config from "../config";
import { db } from "../db/connection";
import type { email_category } from "../db/enums";
import emailMessagesRepository from "../repositories/email-messages.repository";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import logger from "../utils/logger";
import emailResolverService, { ResolvedSender } from "./email-resolver.service";
import emailSesClient from "./email-ses.client";
import rateLimitService from "./rate-limit.service";
import reputationService from "./reputation.service";
import { renderBrandedEmail } from "../utils/email-html";
import { signUnsubToken } from "../utils/unsubscribe";

export interface SendMailParams {
  tenantId: string;
  category?: email_category;
  to: string;
  subject: string;
  text: string;
  // Optional HTML alternative; `text` stays the plain-text fallback.
  html?: string | null;
  replyTo?: string | null;
  idempotencyKey?: string | null;
}

export interface SentMail {
  messageId: string;
  provider: "SES" | "SIMULATED";
  mode: "custom" | "legacy";
  // True when the recipient was suppressed and nothing was sent.
  suppressed?: boolean;
  // True when the tenant's send rate cap was hit and nothing was sent.
  rateLimited?: boolean;
}

const legacySource = (): string =>
  config.AWS_SES_FROM_NAME
    ? `${config.AWS_SES_FROM_NAME} <${config.AWS_SES_FROM_EMAIL}>`
    : config.AWS_SES_FROM_EMAIL;

// Per-status, per-category send-rate multiplier applied to the tenant's base
// TPS. 1 = full rate, fractions = throttled, 0 = fully blocked. TRANSACTIONAL
// (OTPs, password resets) is NEVER throttled or blocked. Only MARKETING is fully
// blocked, and only at PAUSED. Mirrors the reference reputation gate.
export const categoryMultiplier = (status: string, category: email_category): number => {
  if (category === "TRANSACTIONAL") return 1;
  switch (status) {
    case "PAUSED":
      return category === "MARKETING" ? 0 : 0.5;
    case "THROTTLED":
      return category === "MARKETING" ? 0.1 : 0.5;
    case "WARNING":
      return category === "MARKETING" ? 0.5 : 1;
    default: // ACTIVE
      return 1;
  }
};

// Per-tenant base TPS from tenants.config.emailTps (no schema change), else the
// configured default. Handles config stored as a JSON object or a JSON string.
export const readEmailTps = (raw: unknown): number => {
  let cfg: Record<string, unknown> | null = null;
  if (raw && typeof raw === "object") cfg = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    try {
      cfg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      cfg = null;
    }
  }
  const v = Number(cfg?.emailTps);
  return Number.isFinite(v) && v > 0 ? v : config.EMAIL_DEFAULT_TENANT_TPS;
};

// Email transport. Resolves the tenant's verified custom sending domain for the
// category and sends from it (tracked in email_messages, events via the config
// set); otherwise falls back to the legacy platform-default sender. Never
// hard-fails a send. Simulated when SES is not keyed / under test.
class MailerService {
  // Per-tenant SES configuration sets already ensured this process. Creating one
  // is idempotent but costs three AWS calls, so we never repeat it per send. A
  // failure is not cached, the next send retries.
  private readonly ensuredConfigSets = new Map<string, Promise<string | null>>();

  isLive(): boolean {
    return emailSesClient.isLive();
  }

  async send(params: SendMailParams): Promise<SentMail> {
    const category: email_category = params.category ?? "NOTIFICATION";
    const to = params.to.trim().toLowerCase();
    const withHtml = { ...params, html: await this.ensureHtml(params) };
    const resolved = await emailResolverService.resolveSender(params.tenantId, category);

    if (resolved.mode === "legacy") return this.sendLegacy(to, category, withHtml);
    return this.sendCustom(to, category, resolved, withHtml);
  }

  // SES injects its open-tracking pixel into the HTML part only. A text-only
  // send is therefore untrackable, so wrap the plain text in the tenant's
  // branded shell (which also linkifies URLs, enabling click tracking). Callers
  // that already build their own HTML (auth, users) are left untouched.
  private async ensureHtml(params: SendMailParams): Promise<string | null> {
    if (params.html) return params.html;
    if (!params.text.trim()) return null;
    const tenant = await db
      .selectFrom("tenants")
      .select(["name", "brand_color"])
      .where("id", "=", params.tenantId)
      .executeTakeFirst();
    return renderBrandedEmail({
      brandName: tenant?.name ?? "",
      brandColor: tenant?.brand_color,
      bodyText: params.text,
    });
  }

  // The tenant's configuration set, so platform-default sends publish SES events
  // (delivery/open/click/bounce) exactly like custom-domain sends do. Returns
  // null when SES rejects the call, in which case we send without one rather
  // than fail the email.
  private async legacyConfigSet(tenantId: string): Promise<string | null> {
    const cached = this.ensuredConfigSets.get(tenantId);
    if (cached) return cached;

    const pending = emailSesClient.ensureConfigurationSet(tenantId).catch((err) => {
      logger.warn(`config set unavailable for tenant ${tenantId}: ${String(err)}`);
      this.ensuredConfigSets.delete(tenantId);
      return null;
    });
    this.ensuredConfigSets.set(tenantId, pending);
    return pending;
  }

  // RFC 8058 List-Unsubscribe headers for MARKETING email (one-click). Other
  // categories get no unsubscribe header.
  private unsubscribeHeaders(
    category: email_category,
    tenantId: string,
    to: string
  ): Array<{ name: string; value: string }> | undefined {
    if (category !== "MARKETING") return undefined;
    const token = signUnsubToken({ tenantId, email: to });
    const url = `${config.APP_PUBLIC_URL}/api/v1/unsubscribe?token=${token}`;
    return [
      { name: "List-Unsubscribe", value: `<${url}>` },
      { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    ];
  }

  // Platform-default sender. Tracked in email_messages and wired to the tenant's
  // configuration set, so SES publishes delivery/open/click/bounce events for it
  // just like the custom-domain path. (Without the config set and the messageId
  // tag, SES publishes nothing and email-events.service cannot correlate.)
  private async sendLegacy(
    to: string,
    category: email_category,
    params: SendMailParams
  ): Promise<SentMail> {
    if (!config.AWS_SES_FROM_EMAIL) {
      return { messageId: `sim_${Date.now()}_${to}`, provider: "SIMULATED", mode: "legacy" };
    }

    const configurationSetName = await this.legacyConfigSet(params.tenantId);

    const msg = await emailMessagesRepository.create({
      tenant_id: params.tenantId,
      category,
      sending_domain_id: null,
      sender_identity_id: null,
      from_address: config.AWS_SES_FROM_EMAIL,
      to_address: to,
      subject: params.subject,
      idempotency_key: params.idempotencyKey ?? null,
      status: "QUEUED",
    });

    try {
      const r = await emailSesClient.sendEmail({
        from: legacySource(),
        to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        replyTo: params.replyTo,
        configurationSetName,
        // Only meaningful alongside a config set, these tags are how
        // email-events.service maps an SES event back to the row above.
        tags: configurationSetName
          ? [
              { name: "tenantId", value: params.tenantId },
              { name: "messageId", value: msg.id },
              { name: "category", value: category },
            ]
          : undefined,
        headers: this.unsubscribeHeaders(category, params.tenantId, to),
      });
      await emailMessagesRepository.markSent(msg.id, r.messageId);
      // Bounces/complaints on this message now feed reputation (they carry the
      // tenantId tag), so the send must count too or the ratio is meaningless.
      void reputationService.recordSend(params.tenantId, msg.id);
      return { ...r, mode: "legacy" };
    } catch (err) {
      await emailMessagesRepository.markFailed(msg.id, String(err));
      throw err;
    }
  }

  private async sendCustom(
    to: string,
    category: email_category,
    resolved: Extract<ResolvedSender, { mode: "custom" }>,
    params: SendMailParams
  ): Promise<SentMail> {
    const tenant = await db
      .selectFrom("tenants")
      .select(["email_sending_status", "config"])
      .where("id", "=", params.tenantId)
      .executeTakeFirst();
    const status = tenant?.email_sending_status ?? "ACTIVE";

    const multiplier = categoryMultiplier(status, category);
    if (multiplier <= 0) {
      logger.warn(`email gated: tenant ${params.tenantId} status ${status} category ${category}`);
      return { messageId: "", provider: "SIMULATED", mode: "custom" };
    }
    const capacity = Math.max(1, Math.ceil(readEmailTps(tenant?.config) * multiplier));

    if (await emailSuppressionsRepository.isSuppressed(params.tenantId, to, category)) {
      await emailMessagesRepository.create({
        tenant_id: params.tenantId,
        category,
        sending_domain_id: resolved.sendingDomainId,
        sender_identity_id: resolved.senderIdentityId,
        from_address: resolved.fromAddress,
        to_address: to,
        subject: params.subject,
        idempotency_key: params.idempotencyKey ?? null,
        status: "SUPPRESSED",
      });
      return { messageId: "", provider: "SIMULATED", mode: "custom", suppressed: true };
    }

    if (!(await rateLimitService.allowEmailSend(params.tenantId, capacity))) {
      logger.warn(`email rate-limited: tenant ${params.tenantId} (capacity ${capacity})`);
      await emailMessagesRepository.create({
        tenant_id: params.tenantId,
        category,
        sending_domain_id: resolved.sendingDomainId,
        sender_identity_id: resolved.senderIdentityId,
        from_address: resolved.fromAddress,
        to_address: to,
        subject: params.subject,
        idempotency_key: params.idempotencyKey ?? null,
        status: "FAILED",
      });
      return { messageId: "", provider: "SIMULATED", mode: "custom", rateLimited: true };
    }

    const from = resolved.displayName
      ? `${resolved.displayName} <${resolved.fromAddress}>`
      : resolved.fromAddress;

    const msg = await emailMessagesRepository.create({
      tenant_id: params.tenantId,
      category,
      sending_domain_id: resolved.sendingDomainId,
      sender_identity_id: resolved.senderIdentityId,
      from_address: resolved.fromAddress,
      to_address: to,
      subject: params.subject,
      idempotency_key: params.idempotencyKey ?? null,
      status: "QUEUED",
    });

    try {
      const r = await emailSesClient.sendEmail({
        from,
        to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        replyTo: resolved.replyTo ?? params.replyTo,
        configurationSetName: resolved.configurationSetName,
        tags: [
          { name: "tenantId", value: params.tenantId },
          { name: "messageId", value: msg.id },
          { name: "category", value: category },
        ],
        headers: this.unsubscribeHeaders(category, params.tenantId, to),
      });
      await emailMessagesRepository.markSent(msg.id, r.messageId);
      void reputationService.recordSend(params.tenantId, msg.id);
      return { messageId: r.messageId, provider: r.provider, mode: "custom" };
    } catch (err) {
      await emailMessagesRepository.markFailed(msg.id, String(err));
      logger.warn(`custom send failed, falling back to legacy: ${String(err)}`);
      return this.sendLegacy(to, category, params);
    }
  }
}

export default new MailerService();
