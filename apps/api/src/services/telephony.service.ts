import crypto from "crypto";
import { ulid } from "ulid";
import config from "../config";
import { BadRequestError, NotFoundError } from "../errors";
import telephonyNumbersRepository from "../repositories/telephony-numbers.repository";
import telephonyRepository from "../repositories/telephony.repository";
import { db } from "../db/connection";
import { getRedis } from "../db/redis";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import logger from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import callIntelligenceService from "./call-intelligence.service";
import engineService from "./engine.service";
import exotelClient, { EXOTEL_SUBDOMAINS } from "./exotel.client";
import plivoClient from "./plivo.client";
import storageService from "./storage.service";
import telephonyResolverService from "./telephony-resolver.service";
import telephonyRoutingService from "./telephony-routing.service";
import twilioClient from "./twilio.client";

const E164 = /^\+[1-9]\d{6,14}$/;
const maskSid = (sid: string): string =>
  sid.length > 6 ? `${sid.slice(0, 2)}...${sid.slice(-4)}` : "set";

// Outcomes an agent can pick when logging a call they dialed from their own
// SIM. A whitelist, because this lands verbatim in reporting.
const MANUAL_OUTCOMES = [
  "CONNECTED",
  "NOT_ANSWERED",
  "CALLBACK_REQUESTED",
  "NOT_INTERESTED",
  "QUALIFIED",
] as const;

const NUMBER_KINDS = ["MAIN", "AGENT"] as const;

class TelephonyService {
  async getConfig(tenantId: string) {
    const cfg = await telephonyRepository.getConfig(tenantId);
    return {
      configured: !!cfg,
      status: cfg?.status ?? "PENDING",
      account_sid: cfg?.account_sid ? maskSid(cfg.account_sid) : null,
      from_number: cfg?.from_number ?? null,
      // Whether an auth token is stored, so the UI can show a saved state. The
      // token itself is never returned.
      auth_token_set: !!cfg?.auth_token_encrypted,
      verified_at: cfg?.verified_at ?? null,
      last_error: cfg?.last_error ?? null,
      // Which provider the saved row selects. PLIVO, EXOTEL, or TWILIO.
      provider: (cfg?.provider === "EXOTEL" ? "EXOTEL" : cfg?.provider === "PLIVO" ? "PLIVO" : "TWILIO") as "PLIVO" | "EXOTEL" | "TWILIO",
      subdomain: cfg?.subdomain ?? null,
      api_key_set: !!cfg?.api_key_encrypted,
      // The token is not a secret in the credentials sense: it only appears in
      // webhook URLs the admin must copy into their provider flow.
      webhook_token: cfg?.webhook_token ?? null,
      // The platform default tier, used when the tenant has no active config.
      // Simulated mode also counts as "available" (calls work, none are real).
      defaultAvailable: twilioClient.isDefaultLive() || twilioClient.isSimulated(),
      defaultFrom: config.TWILIO_DEFAULT_FROM_NUMBER || null,
      simulated: twilioClient.isSimulated(),
      exotelSimulated: exotelClient.isSimulated(),
      plivoSimulated: plivoClient.isSimulated(),
    };
  }

  async saveConfig(
    tenantId: string,
    actorId: string,
    body: {
      provider?: string;
      accountSid?: string;
      authId?: string;
      sid?: string;
      authToken?: string;
      apiToken?: string;
      fromNumber?: string;
      apiKey?: string;
      subdomain?: string;
    }
  ) {
    // Partial updates: a blank field keeps the stored value, so an admin can
    // change just the from-number without re-typing their secret auth token
    // (which the API never hands back).
    const existing = await telephonyRepository.getConfig(tenantId);
    const defaultProvider = body.authId ? "PLIVO" : (body.subdomain || body.apiKey) ? "EXOTEL" : "TWILIO";
    const provider =
      String(body.provider ?? "").trim().toUpperCase() ||
      (existing?.provider ?? defaultProvider);
    if (provider !== "TWILIO" && provider !== "EXOTEL" && provider !== "PLIVO") {
      throw new BadRequestError("provider must be PLIVO, EXOTEL, or TWILIO");
    }
    // Switching provider means the stored secrets belong to the OTHER provider;
    // partial-update semantics only apply within the same provider.
    const samProvider = existing?.provider === provider ? existing : undefined;

    const accountSid =
      String(body.accountSid ?? body.authId ?? body.sid ?? "").trim() ||
      (samProvider?.account_sid ?? "");
    const fromNumber = normalizePhone(body.fromNumber) || (samProvider?.from_number ?? "");
    const rawToken = String(body.authToken ?? body.apiToken ?? "").trim();
    const authTokenEncrypted = rawToken
      ? encryptSecret(rawToken)
      : (samProvider?.auth_token_encrypted ?? "");

    if (!accountSid || !authTokenEncrypted || !fromNumber) {
      throw new BadRequestError(
        provider === "EXOTEL"
          ? "sid, apiToken and fromNumber are required"
          : provider === "PLIVO"
          ? "authId, authToken and fromNumber are required"
          : "accountSid, authToken and fromNumber are required"
      );
    }
    if (!E164.test(fromNumber)) {
      throw new BadRequestError("fromNumber must be E.164, for example +919876543210");
    }

    let apiKeyEncrypted: string | null = null;
    let subdomain: string | null = null;
    if (provider === "EXOTEL") {
      const rawKey = String(body.apiKey ?? "").trim();
      apiKeyEncrypted = rawKey ? encryptSecret(rawKey) : (samProvider?.api_key_encrypted ?? null);
      if (!apiKeyEncrypted) throw new BadRequestError("apiKey is required for Exotel");

      subdomain = String(body.subdomain ?? "").trim() || samProvider?.subdomain || "api.in.exotel.com";
      if (!(EXOTEL_SUBDOMAINS as readonly string[]).includes(subdomain)) {
        throw new BadRequestError(
          `subdomain must be one of ${EXOTEL_SUBDOMAINS.join(", ")}`
        );
      }
    }

    const row = await telephonyRepository.upsertConfig({
      tenant_id: tenantId,
      provider,
      account_sid: accountSid,
      auth_token_encrypted: authTokenEncrypted,
      from_number: fromNumber,
      api_key_encrypted: apiKeyEncrypted,
      subdomain,
      // Minted once and preserved forever after: the tenant pastes webhook URLs
      // containing this token into their Exotel/Plivo flow, so it must never churn on
      // an ordinary re-save.
      webhook_token:
        provider === "EXOTEL" || provider === "PLIVO"
          ? existing?.webhook_token ?? crypto.randomBytes(24).toString("hex")
          : existing?.webhook_token ?? null,
    });
    engineService.audit(tenantId, actorId, "telephony.config_saved", "tenant_telephony", row.id, {
      provider,
    });
    return this.getConfig(tenantId);
  }

  // Validates the stored creds against the provider and confirms the from-number.
  async validate(tenantId: string, actorId: string) {
    const cfg = await telephonyRepository.getConfig(tenantId);
    if (!cfg || !cfg.account_sid || !cfg.auth_token_encrypted || !cfg.from_number) {
      throw new BadRequestError(
        cfg?.provider === "EXOTEL"
          ? "Add Exotel credentials first"
          : cfg?.provider === "PLIVO"
          ? "Add Plivo credentials first"
          : "Add Twilio credentials first"
      );
    }

    if (cfg.provider === "PLIVO") {
      return this.validatePlivo(tenantId, actorId, cfg);
    }

    if (cfg.provider === "EXOTEL") {
      return this.validateExotel(tenantId, actorId, cfg);
    }

    const token = decryptSecret(cfg.auth_token_encrypted);

    const creds = await twilioClient.validateCredentials(cfg.account_sid, token);
    if (!creds.ok) {
      await telephonyRepository.updateStatus(tenantId, {
        status: "PENDING",
        last_error: creds.error ?? "Invalid credentials",
      });
      return this.getConfig(tenantId);
    }

    const owns = await twilioClient.ownsNumber(cfg.account_sid, token, cfg.from_number);
    if (!owns) {
      await telephonyRepository.updateStatus(tenantId, {
        status: "PENDING",
        last_error: `Number ${cfg.from_number} is not on this account`,
      });
      return this.getConfig(tenantId);
    }

    await telephonyRepository.updateStatus(tenantId, {
      status: "ACTIVE",
      verified_at: new Date(),
      last_error: null,
    });
    engineService.audit(tenantId, actorId, "telephony.validated", "tenant_telephony", cfg.id, {});
    return this.getConfig(tenantId);
  }

  private async validateExotel(
    tenantId: string,
    actorId: string,
    cfg: NonNullable<Awaited<ReturnType<typeof telephonyRepository.getConfig>>>
  ) {
    let apiKey = "";
    let apiToken = "";
    try {
      apiKey = cfg.api_key_encrypted ? decryptSecret(cfg.api_key_encrypted) : "";
      apiToken = cfg.auth_token_encrypted ? decryptSecret(cfg.auth_token_encrypted) : "";
    } catch {
      // fall through to the failure path below with empty creds
    }

    const result = await exotelClient.validateCredentials({
      sid: cfg.account_sid ?? "",
      apiKey,
      apiToken,
      subdomain: cfg.subdomain ?? "",
    });
    if (!result.ok) {
      await telephonyRepository.updateStatus(tenantId, {
        status: "PENDING",
        last_error: result.error ?? "Invalid credentials",
      });
      return this.getConfig(tenantId);
    }

    // Keep the number pool consistent with the config: the main ExoPhone always
    // has a MAIN pool row (idempotent, the (tenant, phone) unique absorbs
    // re-validation).
    if (cfg.from_number) {
      const existing = await telephonyNumbersRepository.findByPhone(tenantId, cfg.from_number);
      if (!existing) {
        try {
          await telephonyNumbersRepository.create({
            tenant_id: tenantId,
            phone: cfg.from_number,
            label: "Main number",
            kind: "MAIN",
            assigned_user_id: null,
          });
        } catch {
          // Unique race with a concurrent validate: the row exists, which is
          // exactly the state we wanted.
        }
      }
    }

    await telephonyRepository.updateStatus(tenantId, {
      status: "ACTIVE",
      verified_at: new Date(),
      last_error: null,
    });
    engineService.audit(tenantId, actorId, "telephony.validated", "tenant_telephony", cfg.id, {
      provider: "EXOTEL",
    });
    return this.getConfig(tenantId);
  }

  private async validatePlivo(
    tenantId: string,
    actorId: string,
    cfg: NonNullable<Awaited<ReturnType<typeof telephonyRepository.getConfig>>>
  ) {
    let authToken = "";
    try {
      authToken = cfg.auth_token_encrypted ? decryptSecret(cfg.auth_token_encrypted) : "";
    } catch {
      // empty creds
    }

    const result = await plivoClient.validateCredentials({
      authId: cfg.account_sid ?? "",
      authToken,
    });
    if (!result.ok) {
      await telephonyRepository.updateStatus(tenantId, {
        status: "PENDING",
        last_error: result.error ?? "Invalid Plivo credentials",
      });
      return this.getConfig(tenantId);
    }

    if (cfg.from_number) {
      const existing = await telephonyNumbersRepository.findByPhone(tenantId, cfg.from_number);
      if (!existing) {
        try {
          await telephonyNumbersRepository.create({
            tenant_id: tenantId,
            phone: cfg.from_number,
            label: "Plivo Main number",
            kind: "MAIN",
            assigned_user_id: null,
          });
        } catch {
          // Unique race condition
        }
      }
    }

    // Automatically sync Plivo Application webhooks and link number to App
    if (config.APP_PUBLIC_URL) {
      void plivoClient
        .syncApplicationWebhook({
          creds: { authId: cfg.account_sid ?? "", authToken },
          publicUrl: config.APP_PUBLIC_URL,
          webhookToken: cfg.webhook_token || undefined,
        })
        .catch(() => null);

      if (cfg.from_number) {
        void plivoClient
          .linkNumberToApplication({
            creds: { authId: cfg.account_sid ?? "", authToken },
            phoneNumber: cfg.from_number,
          })
          .catch(() => null);
      }
    }

    await telephonyRepository.updateStatus(tenantId, {
      status: "ACTIVE",
      verified_at: new Date(),
      last_error: null,
    });
    engineService.audit(tenantId, actorId, "telephony.validated", "tenant_telephony", cfg.id, {
      provider: "PLIVO",
    });
    return this.getConfig(tenantId);
  }

  async remove(tenantId: string, actorId: string) {
    await telephonyRepository.removeConfig(tenantId);
    engineService.audit(tenantId, actorId, "telephony.config_removed", "tenant_telephony", tenantId, {});
    return { ok: true };
  }

  // Click-to-call: rings the agent, then bridges to the lead/contact/phone.
  async placeCall(
    tenantId: string,
    actorId: string,
    body: {
      leadId?: string;
      contactId?: string;
      agentPhone?: string;
      toPhone?: string;
      phone?: string;
      mode?: string;
    }
  ) {
    let leadId: string | null = null;
    let contactId: string | null = null;
    let leadPhone = "";

    if (body.leadId) {
      const recipient = await telephonyRepository.leadPhone(tenantId, body.leadId);
      if (!recipient) throw new NotFoundError("Lead not found");
      leadId = body.leadId;
      leadPhone = normalizePhone(recipient.phone);
    } else if (body.contactId) {
      const recipient = await telephonyRepository.contactPhone(tenantId, body.contactId);
      if (!recipient) throw new NotFoundError("Contact not found");
      contactId = body.contactId;
      leadPhone = normalizePhone(recipient.phone);
    } else if (body.toPhone || body.phone) {
      leadPhone = normalizePhone(body.toPhone || body.phone);
    } else {
      throw new BadRequestError("leadId, contactId, or toPhone required");
    }

    if (!E164.test(leadPhone)) {
      throw new BadRequestError(
        "Recipient has no valid phone number. Add the country code, e.g. +918012345678."
      );
    }

    const rawAgentPhone =
      String(body.agentPhone ?? "").trim() ||
      (await telephonyRepository.userPhone(tenantId, actorId)) ||
      "";
    const agentPhone = rawAgentPhone ? normalizePhone(rawAgentPhone) : "";

    const provider = await telephonyResolverService.activeProvider(tenantId);
    if (provider === "PLIVO") {
      return this.placePlivoCall({
        tenantId,
        actorId,
        leadId,
        contactId,
        agentPhone: agentPhone || undefined,
        leadPhone,
        mode: body.mode,
      });
    }

    if (!E164.test(agentPhone)) {
      throw new BadRequestError(
        "Your callback number is missing or invalid. Add the country code, e.g. +14155550123."
      );
    }

    if (provider === "EXOTEL") {
      return this.placeExotelCall({ tenantId, actorId, leadId, contactId, agentPhone, leadPhone });
    }

    // If the tenant has a Twilio config that isn't validated, don't silently
    // fall back to the platform default account (which would dial from a different
    // account where these numbers aren't set up). Make them validate first.
    if (!twilioClient.isSimulated()) {
      const cfg = await telephonyRepository.getConfig(tenantId);
      if (cfg && cfg.status !== "ACTIVE") {
        throw new BadRequestError(
          "Your Twilio settings aren't validated yet. Open Telephony settings and click Validate, then try the call again."
        );
      }
    }

    const resolved = await telephonyResolverService.resolve(tenantId);
    // With nothing configured we only block when not simulating; in simulate
    // mode the call is faked so the flow stays testable without an account.
    if (resolved.mode === "none" && !twilioClient.isSimulated()) {
      throw new BadRequestError("No telephony account is configured for this workspace");
    }

    const placed = await twilioClient.placeBridgeCall({
      creds: resolved.creds,
      agentPhone,
      leadPhone,
    });
    const callRow = await telephonyRepository.createCall({
      tenant_id: tenantId,
      lead_id: leadId,
      contact_id: contactId,
      agent_user_id: actorId,
      twilio_call_sid: placed.callSid,
      call_status: placed.status,
      from_number: resolved.creds.fromNumber || "simulated",
      to_number: leadPhone,
    });
    engineService.audit(tenantId, actorId, "telephony.call_placed", "voice_call", callRow.id, {
      mode: resolved.mode,
      simulated: placed.simulated,
    });
    return { ...callRow, mode: resolved.mode, simulated: placed.simulated };
  }

  // Plivo click-to-call: Plivo dials the agent first, then bridges to the lead,
  // recording the call and streaming webhooks.
  private async placePlivoCall(params: {
    tenantId: string;
    actorId: string;
    leadId: string | null;
    contactId: string | null;
    agentPhone?: string;
    leadPhone: string;
    mode?: string;
  }) {
    const { tenantId, actorId, leadId, contactId, agentPhone, leadPhone, mode } = params;

    // Check TRAI window if calling an Indian number (+91)
    if (leadPhone.startsWith("+91") && !telephonyRoutingService.isWithinTraiWindow()) {
      throw new BadRequestError(
        "Calls to Indian numbers can only be placed between 9:00 AM and 9:00 PM IST (TRAI regulation). Try again inside the window."
      );
    }

    const resolved = await telephonyResolverService.resolvePlivo(tenantId);
    if (resolved.mode === "none" && !plivoClient.isSimulated()) {
      throw new BadRequestError(
        "Your Plivo settings aren't validated yet. Open Telephony settings and click Validate, then try the call again."
      );
    }

    const agentNumber = await telephonyNumbersRepository.agentNumber(tenantId, actorId);
    let callerId = agentNumber?.phone ?? resolved.mainPhone ?? "";
    if (!callerId) {
      const numbers = await telephonyNumbersRepository.list(tenantId);
      const activeNum = numbers.find((n) => n.active);
      if (activeNum) callerId = activeNum.phone;
    }
    if (!callerId) {
      callerId = config.PLIVO_DEFAULT_FROM_NUMBER || "";
    }

    const callRow = await telephonyRepository.createCall({
      tenant_id: tenantId,
      lead_id: leadId,
      contact_id: contactId,
      agent_user_id: actorId,
      provider: "plivo",
      direction: "OUTBOUND",
      call_status: "queued",
      from_number: callerId || "simulated",
      to_number: leadPhone,
    });

    if (mode === "WEBRTC") {
      // In Pure In-Browser WebRTC mode, the browser SDK dials the Plivo WebRTC gateway directly.
      // We don't trigger a server-side click-to-call PSTN bridge.
      engineService.audit(tenantId, actorId, "telephony.call_placed", "voice_call", callRow.id, {
        mode: "WEBRTC",
        provider: "plivo",
        simulated: plivoClient.isSimulated(),
      });
      return { ...callRow, mode: "WEBRTC", simulated: plivoClient.isSimulated() };
    }

    const answerUrl = `${config.APP_PUBLIC_URL}/api/v1/telephony/webhooks/plivo/${resolved.webhookToken}/answer?leadPhone=${encodeURIComponent(leadPhone)}&callerId=${encodeURIComponent(callerId)}&callId=${callRow.id}`;
    const hangupUrl = `${config.APP_PUBLIC_URL}/api/v1/telephony/webhooks/plivo/${resolved.webhookToken}/hangup?callId=${callRow.id}`;

    let placed;
    try {
      placed = await plivoClient.placeConnectCall({
        creds: resolved.creds,
        from: callerId || "simulated",
        to: agentPhone || leadPhone,
        leadPhone,
        answerUrl,
        hangupUrl,
      });
    } catch (err) {
      await db
        .updateTable("voice_calls")
        .set({
          call_status: "failed",
          call_error: err instanceof Error ? err.message : "Plivo call failed",
          completed_at: new Date(),
          updated_at: new Date(),
        })
        .where("id", "=", callRow.id)
        .execute();
      const detail = err instanceof Error ? err.message : "Plivo call failed";
      throw new BadRequestError(`Plivo call failed: ${detail}`);
    }

    const updated = await db
      .updateTable("voice_calls")
      .set({
        external_call_id: placed.callUuid,
        call_status: placed.status,
        updated_at: new Date(),
      })
      .where("id", "=", callRow.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    engineService.audit(tenantId, actorId, "telephony.call_placed", "voice_call", callRow.id, {
      mode: resolved.mode,
      provider: "plivo",
      simulated: placed.simulated,
    });
    return { ...updated, mode: resolved.mode, simulated: placed.simulated };
  }

  // Exotel click-to-call: Exotel dials the agent first, then the lead, who
  // sees an ExoPhone as CallerId (the agent's dedicated pool number when they
  // have one, else the tenant's main number).
  private async placeExotelCall(params: {
    tenantId: string;
    actorId: string;
    leadId: string | null;
    contactId: string | null;
    agentPhone: string;
    leadPhone: string;
  }) {
    const { tenantId, actorId, leadId, contactId, agentPhone, leadPhone } = params;

    // TRAI permits commercial calls to Indian numbers 9:00-21:00 IST only.
    // Enforced for real AND simulated calls so dev behaves like prod.
    if (!telephonyRoutingService.isWithinTraiWindow()) {
      throw new BadRequestError(
        "Calls can only be placed between 9:00 AM and 9:00 PM IST (TRAI regulation). Try again inside the window."
      );
    }

    const resolved = await telephonyResolverService.resolveExotel(tenantId);
    if (resolved.mode === "none" && !exotelClient.isSimulated()) {
      throw new BadRequestError(
        "Your Exotel settings aren't validated yet. Open Telephony settings and click Validate, then try the call again."
      );
    }

    const agentNumber = await telephonyNumbersRepository.agentNumber(tenantId, actorId);
    const callerId = agentNumber?.phone ?? resolved.mainExoPhone ?? "";

    // Row first: its id rides in CustomField so callbacks can find the call
    // even if Exotel's Sid never reaches us.
    const callRow = await telephonyRepository.createCall({
      tenant_id: tenantId,
      lead_id: leadId,
      contact_id: contactId,
      agent_user_id: actorId,
      provider: "exotel",
      direction: "OUTBOUND",
      call_status: "queued",
      from_number: callerId || "simulated",
      to_number: leadPhone,
    });

    let placed;
    try {
      placed = await exotelClient.placeConnectCall({
        creds: resolved.creds,
        from: agentPhone,
        to: leadPhone,
        callerId,
        statusCallbackUrl: `${config.APP_PUBLIC_URL}/api/v1/telephony/webhooks/exotel/${resolved.webhookToken}/callback`,
        customField: callRow.id,
      });
    } catch (err) {
      await db
        .updateTable("voice_calls")
        .set({
          call_status: "failed",
          call_error: err instanceof Error ? err.message : "Exotel call failed",
          completed_at: new Date(),
          updated_at: new Date(),
        })
        .where("id", "=", callRow.id)
        .execute();
      throw new BadRequestError(
        "Exotel could not place the call. Check your Exotel account balance and settings."
      );
    }

    const updated = await db
      .updateTable("voice_calls")
      .set({
        external_call_id: placed.callSid,
        call_status: placed.status,
        updated_at: new Date(),
      })
      .where("id", "=", callRow.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    engineService.audit(tenantId, actorId, "telephony.call_placed", "voice_call", callRow.id, {
      mode: resolved.mode,
      provider: "exotel",
      simulated: placed.simulated,
    });
    return { ...updated, mode: resolved.mode, simulated: placed.simulated };
  }

  // An agent logs a call they dialed from their own SIM. No recording or
  // metadata exists (the call never touched a provider), but the outcome and
  // notes still belong on the lead's story.
  async logManualCall(
    tenantId: string,
    actorId: string,
    body: {
      leadId?: string;
      contactId?: string;
      durationSec?: number;
      outcome?: string;
      notes?: string;
    }
  ) {
    let leadId: string | null = null;
    let contactId: string | null = null;
    if (body.leadId) {
      const lead = await telephonyRepository.leadPhone(tenantId, body.leadId);
      if (!lead) throw new NotFoundError("Lead not found");
      leadId = body.leadId;
    } else if (body.contactId) {
      const contact = await telephonyRepository.contactPhone(tenantId, body.contactId);
      if (!contact) throw new NotFoundError("Contact not found");
      contactId = body.contactId;
    } else {
      throw new BadRequestError("leadId or contactId required");
    }

    const outcome = String(body.outcome ?? "CONNECTED").trim().toUpperCase();
    if (!(MANUAL_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new BadRequestError(`outcome must be one of ${MANUAL_OUTCOMES.join(", ")}`);
    }
    const durationSec = Math.max(0, Math.trunc(Number(body.durationSec ?? 0) || 0));
    const notes = String(body.notes ?? "").trim() || null;

    const now = new Date();
    const callRow = await telephonyRepository.createCall({
      tenant_id: tenantId,
      lead_id: leadId,
      contact_id: contactId,
      agent_user_id: actorId,
      provider: "manual",
      direction: "OUTBOUND",
      call_status: "completed",
      from_number: "personal",
      to_number: "",
      summary: notes,
      outcome,
      duration_sec: durationSec,
      completed_at: now,
    });

    await callIntelligenceService.recordSideEffects(
      {
        id: callRow.id,
        tenant_id: tenantId,
        lead_id: leadId,
        contact_id: contactId,
        agent_user_id: actorId,
        direction: "OUTBOUND",
      },
      { summary: notes ?? "Phone call (logged manually)", durationSec, notes }
    );
    engineService.audit(tenantId, actorId, "telephony.manual_call_logged", "voice_call", callRow.id, {
      outcome,
    });
    return callRow;
  }

  // ---- ExoPhone pool ----

  async listNumbers(tenantId: string) {
    const list = await telephonyNumbersRepository.list(tenantId);
    if (list.length === 0 && config.PLIVO_DEFAULT_FROM_NUMBER) {
      return [
        {
          id: "platform-default",
          tenant_id: tenantId,
          phone: config.PLIVO_DEFAULT_FROM_NUMBER,
          label: "Primary Virtual Line (Plivo)",
          kind: "MAIN",
          assigned_user_id: null,
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
    }
    return list;
  }

  async addNumber(
    tenantId: string,
    actorId: string,
    body: { phone?: string; label?: string; kind?: string; assignedUserId?: string }
  ) {
    const phone = normalizePhone(String(body.phone ?? "").trim());
    if (!E164.test(phone)) {
      throw new BadRequestError("phone must be E.164, for example +918047112277");
    }
    const kind = String(body.kind ?? "MAIN").trim().toUpperCase();
    if (!(NUMBER_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestError("kind must be MAIN or AGENT");
    }

    let assignedUserId: string | null = null;
    if (kind === "AGENT") {
      assignedUserId = String(body.assignedUserId ?? "").trim() || null;
      if (!assignedUserId) throw new BadRequestError("AGENT numbers need an assigned agent");
      const user = await db
        .selectFrom("users")
        .select(["id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", assignedUserId)
        .where("status", "=", "ACTIVE")
        .executeTakeFirst();
      if (!user) throw new BadRequestError("Assigned agent must be an active user of this workspace");
    }

    let row;
    try {
      row = await telephonyNumbersRepository.create({
        tenant_id: tenantId,
        phone,
        label: String(body.label ?? "").trim() || null,
        kind,
        assigned_user_id: assignedUserId,
      });
    } catch (err) {
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        throw new BadRequestError("That ExoPhone is already added");
      }
      throw err;
    }
    engineService.audit(tenantId, actorId, "telephony.number_added", "telephony_number", row.id, {
      kind,
    });
    return row;
  }

  async updateNumber(
    tenantId: string,
    actorId: string,
    id: string,
    body: { label?: string; kind?: string; assignedUserId?: string | null; active?: boolean }
  ) {
    const patch: {
      label?: string | null;
      kind?: string;
      assigned_user_id?: string | null;
      active?: boolean;
    } = {};
    if (body.label !== undefined) patch.label = String(body.label).trim() || null;
    if (body.kind !== undefined) {
      const kind = String(body.kind).trim().toUpperCase();
      if (!(NUMBER_KINDS as readonly string[]).includes(kind)) {
        throw new BadRequestError("kind must be MAIN or AGENT");
      }
      patch.kind = kind;
    }
    if (body.assignedUserId !== undefined) {
      patch.assigned_user_id = body.assignedUserId ? String(body.assignedUserId).trim() : null;
    }
    if (body.active !== undefined) patch.active = !!body.active;

    const row = await telephonyNumbersRepository.update(tenantId, id, patch);
    if (!row) throw new NotFoundError("Number not found");
    engineService.audit(tenantId, actorId, "telephony.number_updated", "telephony_number", id, {});
    return row;
  }

  async removeNumber(tenantId: string, actorId: string, id: string) {
    const removed = await telephonyNumbersRepository.remove(tenantId, id);
    if (!removed) throw new NotFoundError("Number not found");
    engineService.audit(tenantId, actorId, "telephony.number_removed", "telephony_number", id, {});
    return { ok: true };
  }

  // ---- Agent availability (self-service) ----

  async setAvailability(tenantId: string, userId: string, available: boolean) {
    const row = await db
      .updateTable("users")
      .set({ available_for_calls: available, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", userId)
      .returning(["available_for_calls"])
      .executeTakeFirst();
    if (!row) throw new NotFoundError("User not found");
    return { available_for_calls: row.available_for_calls };
  }

  // ---- Recording access ----

  // Returns a short-lived playable URL. An <audio> tag cannot carry a JWT
  // header, so this JWT-guarded endpoint hands back a presigned URL instead of
  // streaming bytes itself.
  async recordingUrl(tenantId: string, callId: string) {
    const call = await telephonyRepository.getCallById(tenantId, callId);
    if (!call) throw new NotFoundError("Call not found");
    if (!call.recording_url) return { url: null, pending: false };

    if (call.recording_url.startsWith("http")) {
      // If it's an external provider URL (e.g. Plivo/Exotel), mirror and cache it in storageService
      // so web browsers can play/stream it without basic auth or CORS barriers.
      try {
        let audio: Buffer | null = null;
        if (call.provider === "plivo" || call.recording_url.includes("plivo.com")) {
          const resolved = await telephonyResolverService.resolvePlivo(tenantId);
          audio = await plivoClient.downloadRecording(resolved.creds, call.recording_url);
        } else if (call.provider === "exotel" || call.recording_url.includes("exotel.com")) {
          const resolved = await telephonyResolverService.resolveExotel(tenantId);
          if (resolved.mode === "tenant") {
            audio = await exotelClient.downloadRecording(resolved.creds, call.recording_url);
          }
        }

        if (audio && audio.length > 0) {
          const key = `telephony/${tenantId}/${call.id}.mp3`;
          await storageService.upload({ key, body: audio, contentType: "audio/mpeg" });
          await telephonyRepository.updateCall(tenantId, callId, { recording_url: key });
          const url = await storageService.getDownloadUrl(key, 3600);
          return { url, pending: false };
        }
      } catch (err) {
        logger.warn(`Failed to mirror provider audio on the fly for call ${callId}: ${String(err)}`);
      }

      // Exotel recording URLs require Basic Auth and must never be handed directly to browsers.
      // Only return unmirrored provider URLs for non-Exotel providers outside simulation.
      if (
        call.provider === "exotel" ||
        call.recording_url.includes("exotel.com") ||
        plivoClient.isSimulated()
      ) {
        return { url: null, pending: true };
      }

      // Direct provider playable URL (Plivo / S3 public audio) fallback
      return { url: call.recording_url, pending: false };
    }

    const url = await storageService.getDownloadUrl(call.recording_url, 3600);
    return { url, pending: false };
  }

  async listCalls(tenantId: string) {
    return telephonyRepository.listCalls(tenantId);
  }

  // In-Browser WebRTC Session: provides dynamically generated credentials for browser calling
  async getWebRTCSession(tenantId: string, actorId: string) {
    const provider = await telephonyResolverService.activeProvider(tenantId);
    if (provider !== "PLIVO") {
      return {
        enabled: false,
        provider,
        reason: "In-browser WebRTC softphone is only enabled for Plivo provider",
      };
    }

    const resolved = await telephonyResolverService.resolvePlivo(tenantId);
    if (resolved.mode === "none" && !plivoClient.isSimulated()) {
      return {
        enabled: false,
        provider: "PLIVO",
        reason: "Plivo is not configured or validated",
      };
    }

    const agentNumber = await telephonyNumbersRepository.agentNumber(tenantId, actorId);
    let callerId = agentNumber?.phone ?? resolved.mainPhone ?? "";
    if (!callerId) {
      const numbers = await telephonyNumbersRepository.list(tenantId);
      const activeNum = numbers.find((n) => n.active);
      if (activeNum) callerId = activeNum.phone;
    }
    if (!callerId) {
      callerId = config.PLIVO_DEFAULT_FROM_NUMBER || "";
    }

    const user = await db
      .selectFrom("users")
      .select(["id", "name", "email"])
      .where("id", "=", actorId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();

    // Endpoint username must start with letter and be alphanumeric (1-25 chars)
    const safePrefix = (user?.name || "agent").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase() || "agent";
    const randomSuffix = crypto.randomBytes(3).toString("hex");
    const usernameBase = `${safePrefix}${actorId.slice(-4).replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}${randomSuffix}`;
    // Plivo Endpoint Alias strictly allows ONLY: Letters, Numbers, ., +, @, -, _ (NO SPACES OR PARENTHESES!)
    const alias = `${safePrefix}_${actorId.slice(-6)}`.replace(/[^a-zA-Z0-9._+@-]/g, "_");

    // Check if we have a cached endpoint for this user or create dynamically
    let endpoint = endpointCache.get(actorId);

    // Check Redis persistent cache
    if (!endpoint) {
      try {
        const redis = getRedis();
        if (redis) {
          const cachedJson = await redis.get(`plivo:endpoint:${actorId}`);
          if (cachedJson) {
            const parsed = JSON.parse(cachedJson);
            if (parsed?.username && parsed?.password) {
              endpoint = parsed;
              endpointCache.set(actorId, endpoint!);
            }
          }
        }
      } catch (err) {
        logger.warn(`Redis lookup failed for plivo endpoint ${actorId}: ${String(err)}`);
      }
    }

    if (!endpoint) {
      const password = `PlvPass_${crypto.randomBytes(6).toString("hex")}A1!`;
      try {
        const created = await plivoClient.createEndpoint({
          creds: resolved.creds,
          username: usernameBase,
          password,
          alias,
          appId: config.PLIVO_APPLICATION_ID || undefined,
        });
        endpoint = {
          endpointId: created.endpointId,
          username: created.username,
          password,
          sipUri: created.sipUri,
        };
        endpointCache.set(actorId, endpoint);

        const redis = getRedis();
        if (redis) {
          await redis.set(`plivo:endpoint:${actorId}`, JSON.stringify(endpoint), "EX", 365 * 86400).catch(() => null);
        }
      } catch (err) {
        logger.warn(`Failed to auto-create Plivo endpoint for user ${actorId}: ${String(err)}`);

        if (plivoClient.isSimulated()) {
          const simUser = `${usernameBase}${crypto.randomBytes(3).toString("hex")}`;
          const sipHost = ["phone", "plivo", "com"].join(".");
          endpoint = {
            endpointId: `sim_ep_${ulid()}`,
            username: simUser,
            password,
            sipUri: `sip:${simUser}@${sipHost}`,
          };
          endpointCache.set(actorId, endpoint);
        } else {
          throw err;
        }
      }
    }

    const isPublicWebhook = Boolean(
      config.APP_PUBLIC_URL &&
        !config.APP_PUBLIC_URL.includes("localhost") &&
        !config.APP_PUBLIC_URL.includes("127.0.0.1")
    );

    return {
      enabled: true,
      provider: "PLIVO",
      endpointId: endpoint.endpointId,
      username: endpoint.username,
      password: endpoint.password,
      callerId,
      simulated: plivoClient.isSimulated(),
      webhookUrl: config.APP_PUBLIC_URL || null,
      webhookLive: isPublicWebhook,
    };
  }
}

const endpointCache = new Map<string, { endpointId: string; username: string; password: string; sipUri: string }>();

export default new TelephonyService();
