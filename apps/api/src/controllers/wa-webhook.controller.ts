import crypto from "crypto";
import { Request, Response } from "express";
import config from "../config";
import whatsappConfigRepository from "../repositories/whatsapp-config.repository";
import inboundService from "../services/inbound.service";
import { decryptSecret } from "../utils/crypto";
import logger from "../utils/logger";

// Shape of a Meta webhook entry (one per WABA). `id` is the WABA id.
interface WaEntry {
  id?: string;
  changes?: Array<{
    value?: {
      contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
      messages?: Array<Record<string, unknown>>;
      statuses?: Array<{
        id?: string;
        status?: string;
        recipient_id?: string;
        // Present on status === "failed": why Meta couldn't deliver (e.g. a
        // marketing-limit block, an invalid template, or the recipient not on
        // the number's allowed list in test mode).
        errors?: Array<{
          code?: number;
          title?: string;
          message?: string;
          error_data?: { details?: string };
        }>;
      }>;
    };
  }>;
}

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const verifySignature = (raw: Buffer, appSecret: string, header: string): boolean => {
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  return header.length === expected.length && safeEqual(header, expected);
};

// Extract a human-readable body from a Meta inbound message of any type.
const messageBody = (m: Record<string, unknown>): string => {
  const type = String(m.type ?? "text");
  const get = (k: string) => (m[k] as Record<string, unknown> | undefined) ?? {};
  switch (type) {
    case "text":
      return String(get("text").body ?? "");
    case "button":
      return String(get("button").text ?? "");
    case "interactive": {
      const i = get("interactive");
      const br = (i.button_reply as Record<string, unknown>) ?? {};
      const lr = (i.list_reply as Record<string, unknown>) ?? {};
      return String(br.title ?? lr.title ?? "[interactive reply]");
    }
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return `[${type}]`;
    default:
      return `[${type}]`;
  }
};

// Meta webhook GET handshake: echo the challenge when the verify token matches.
export const verifyWaWebhook = async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  const mode = String(req.query["hub.mode"] ?? "");
  const verifyToken = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  const cfg = await whatsappConfigRepository.findByVerifyToken(token);
  if (mode === "subscribe" && cfg?.webhook_verify_token && safeEqual(verifyToken, cfg.webhook_verify_token)) {
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  res.status(403).send("Forbidden");
};

// Meta webhook POST: verify the HMAC signature, ack fast, then ingest inbound
// messages + apply delivery/read statuses (best-effort, dedup-safe).
export const receiveWaWebhook = async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  const cfg = await whatsappConfigRepository.findByVerifyToken(token);
  if (!cfg) {
    res.status(404).send("Not found");
    return;
  }

  const raw: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body ?? {}), "utf8");

  // Verify the X-Hub-Signature-256 HMAC when the app secret is configured.
  if (cfg.app_secret_encrypted) {
    let appSecret = "";
    try {
      appSecret = decryptSecret(cfg.app_secret_encrypted);
    } catch {
      appSecret = "";
    }
    const header = String(req.header("x-hub-signature-256") ?? "");
    if (!appSecret || !verifySignature(raw, appSecret, header)) {
      res.status(401).send("Invalid signature");
      return;
    }
  } else if (config.isProduction) {
    // Without the app secret nothing proves the payload came from Meta.
    res.status(401).send("Webhook signing secret not configured");
    return;
  } else {
    logger.warn(`WA webhook (tenant ${cfg.tenant_id}): no app secret set, processing unverified (development only)`);
  }

  // Ack immediately so Meta doesn't retry; process in the background.
  res.status(200).send("EVENT_RECEIVED");
  void processPayload(cfg.tenant_id, raw).catch((err) =>
    logger.warn(`WA webhook process (tenant ${cfg.tenant_id}): ${String(err)}`)
  );
};

// ---- Shared Embedded-Signup webhook (one app callback for every connected
// WABA). Tenant is resolved per entry from the WABA id; GET verify token +
// POST HMAC are platform-level (META_WEBHOOK_VERIFY_TOKEN / META_APP_SECRET). ----

export const verifyWaWebhookShared = async (req: Request, res: Response): Promise<void> => {
  const mode = String(req.query["hub.mode"] ?? "");
  const verifyToken = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  const expected = config.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && safeEqual(verifyToken, expected)) {
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  res.status(403).send("Forbidden");
};

export const receiveWaWebhookShared = async (req: Request, res: Response): Promise<void> => {
  const raw: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body ?? {}), "utf8");

  // Verify the X-Hub-Signature-256 HMAC with our platform app secret when set.
  if (config.META_APP_SECRET) {
    const header = String(req.header("x-hub-signature-256") ?? "");
    if (!verifySignature(raw, config.META_APP_SECRET, header)) {
      res.status(401).send("Invalid signature");
      return;
    }
  } else {
    if (config.isProduction) {
      res.status(401).send("Webhook signing secret not configured");
      return;
    }
    logger.warn("WA shared webhook: META_APP_SECRET unset, processing unverified (development only)");
  }

  // Ack immediately; resolve tenant per entry and process in the background.
  res.status(200).send("EVENT_RECEIVED");
  void processSharedPayload(raw).catch((err) =>
    logger.warn(`WA shared webhook process: ${String(err)}`)
  );
};

// Process every change in one entry against a resolved tenant.
async function processEntry(tenantId: string, entry: WaEntry): Promise<void> {
  for (const change of entry.changes ?? []) {
    const value = change.value;
    if (!value) continue;
    const profileName = value.contacts?.[0]?.profile?.name;

    for (const m of value.messages ?? []) {
      try {
        await inboundService.ingest({
          tenantId,
          channel: "WHATSAPP",
          from: String(m.from ?? ""),
          name: profileName,
          body: messageBody(m),
          subject: "WhatsApp",
          externalId: typeof m.id === "string" ? m.id : null,
        });
      } catch (err) {
        logger.warn(`WA inbound ingest (tenant ${tenantId}): ${String(err)}`);
      }
    }

    for (const s of value.statuses ?? []) {
      if (s.id && s.status) {
        // On a failed status, capture Meta's reason so a silently-dropped send
        // (e.g. an accepted-but-undelivered marketing template) is diagnosable.
        const err = s.errors?.[0];
        const detail = err
          ? `[${err.code ?? "?"}] ${err.title ?? err.message ?? ""}${
              err.error_data?.details ? `, ${err.error_data.details}` : ""
            }`.trim()
          : undefined;
        try {
          await inboundService.applyStatus(tenantId, s.id, s.status, detail);
        } catch (e) {
          logger.warn(`WA status update (tenant ${tenantId}): ${String(e)}`);
        }
      }
    }
  }
}

// Legacy per-tenant path: every entry belongs to the resolved tenant.
async function processPayload(tenantId: string, raw: Buffer): Promise<void> {
  const payload = JSON.parse(raw.toString("utf8")) as { entry?: WaEntry[] };
  for (const entry of payload.entry ?? []) {
    await processEntry(tenantId, entry);
  }
}

// Shared path: resolve the tenant per entry from its WABA id (entry.id).
async function processSharedPayload(raw: Buffer): Promise<void> {
  const payload = JSON.parse(raw.toString("utf8")) as { entry?: WaEntry[] };
  for (const entry of payload.entry ?? []) {
    const wabaId = String(entry.id ?? "");
    const cfg = await whatsappConfigRepository.findByWabaId(wabaId);
    if (!cfg) {
      logger.warn(`WA shared webhook: no tenant for WABA ${wabaId}`);
      continue;
    }
    await processEntry(cfg.tenant_id, entry);
  }
}
