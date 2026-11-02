import config from "../config";
import whatsappConfigRepository from "../repositories/whatsapp-config.repository";
import whatsappRepository from "../repositories/whatsapp.repository";
import logger from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import whatsappClient, { WaSendResult } from "./whatsapp.client";
import whatsappResolver from "./whatsapp-resolver.service";

// Parsed once: the set of numbers allowed to receive REAL sends during testing.
// Normalized to E.164 so it compares equal regardless of formatting.
const TEST_ALLOWLIST: Set<string> = new Set(
  config.WHATSAPP_TEST_ALLOWLIST.split(",")
    .map((n) => normalizePhone(n.trim()))
    .filter((n) => n.length > 0)
);

export interface WaDeliveryResult {
  // True only when Meta actually accepted the message (not simulated, no error).
  delivered: boolean;
  // The value to store on messages.simulated, true when the send was simulated
  // OR failed (so a non-delivery is never recorded as a real send).
  simulated: boolean;
  messageId: string | null;
  error: string | null;
}

// Leaf delivery helper shared by every WhatsApp send site (whatsapp.service,
// the automation engine, the inbox reply). It resolves the recipient phone +
// the tenant/default credentials, sends via the Meta client, and reports whether
// the message truly went out, callers then record it with the right
// `simulated` flag. Depends only on leaf modules (no engine/service cycles).
class WhatsappDeliveryService {
  async deliver(
    tenantId: string,
    params: {
      leadId?: string | null;
      contactId?: string | null;
      phone?: string | null;
      text?: string;
      templateName?: string;
      lang?: string;
      bodyParams?: string[];
    }
  ): Promise<WaDeliveryResult> {
    let phone = params.phone ?? null;
    if (!phone) {
      const recipient = await whatsappConfigRepository.recipientPhone(tenantId, {
        leadId: params.leadId,
        contactId: params.contactId,
      });
      phone = recipient?.phone ?? null;
    }
    if (!phone) {
      return {
        delivered: false,
        simulated: true,
        messageId: null,
        error: "Recipient has no phone number",
      };
    }

    // Testing guard: if an allow-list is configured and this recipient isn't on
    // it, don't hit Meta, record it as simulated so testing never spends the
    // daily message limit on a real lead. (Skipped entirely when the list is
    // empty, or when everything is already simulated.)
    if (
      TEST_ALLOWLIST.size > 0 &&
      !whatsappClient.isSimulated() &&
      !TEST_ALLOWLIST.has(normalizePhone(phone))
    ) {
      logger.info(
        `whatsapp delivery (tenant ${tenantId}): ${normalizePhone(phone)} not in WHATSAPP_TEST_ALLOWLIST, simulated`
      );
      return { delivered: false, simulated: true, messageId: null, error: null };
    }

    // In simulate mode the client ignores creds, so skip the resolver entirely
    // (this also avoids touching tenant_whatsapp under the test runner).
    const resolved = whatsappClient.isSimulated()
      ? { mode: "default" as const, creds: { phoneNumberId: "", accessToken: "" } }
      : await whatsappResolver.resolve(tenantId);
    if (resolved.mode === "none" && !whatsappClient.isSimulated()) {
      return {
        delivered: false,
        simulated: true,
        messageId: null,
        error: "No WhatsApp account is connected for this workspace",
      };
    }

    let res: WaSendResult;
    if (params.templateName) {
      // Use the synced template's exact language + body-variable count so the
      // Meta payload matches the approved template. When the template hasn't been
      // synced, fall back to the caller's params (backwards compatible).
      const meta = await whatsappRepository.templateMeta(tenantId, params.templateName);
      const provided = params.bodyParams ?? [];
      // Only shape the params from Meta metadata for templates actually synced
      // from Meta; otherwise keep the caller's params (backwards compatible).
      const bodyParams =
        meta?.synced
          ? Array.from({ length: meta.variables }, (_, i) => provided[i] ?? provided[0] ?? "")
          : provided;
      res = await whatsappClient.sendTemplate({
        creds: resolved.creds,
        to: phone,
        name: params.templateName,
        lang: params.lang || (meta?.synced ? meta.language : undefined),
        bodyParams,
      });
    } else {
      res = await whatsappClient.sendText({
        creds: resolved.creds,
        to: phone,
        body: params.text ?? "",
      });
    }

    const delivered = !!res.messageId && !res.simulated;
    if (res.error) logger.warn(`whatsapp delivery (tenant ${tenantId}): ${res.error}`);
    return { delivered, simulated: !delivered, messageId: res.messageId, error: res.error };
  }
}

export default new WhatsappDeliveryService();
