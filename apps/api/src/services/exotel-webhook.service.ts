import { db } from "../db/connection";
import inboundRepository from "../repositories/inbound.repository";
import telephonyRepository, {
  TERMINAL_CALL_STATUSES,
  TenantTelephonyRow,
} from "../repositories/telephony.repository";
import { ulid } from "ulid";
import logger from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import callIntelligenceService from "./call-intelligence.service";
import schedulingService from "./scheduling.service";
import telephonyRoutingService from "./telephony-routing.service";

// Exotel webhook brains. Three entry points, one per applet/callback:
//
//   routeCall          Connect applet's Dynamic URL. Exotel is holding a live
//                      caller and gives us FIVE SECONDS, so this path is
//                      indexed lookups only, no LLM, no external HTTP, ever.
//   finalizeInbound    Passthru applet at the end of the flow (async).
//   applyOutboundStatus StatusCallback for API-placed outbound calls.
//
// None of Exotel's callbacks are signed; the unguessable per-tenant token in
// the URL path (looked up against tenant_telephony.webhook_token) is the
// entire authentication, exactly like the WhatsApp webhook's URL token.

interface RoutingState {
  attempted_user_ids?: string[];
  out_of_hours?: boolean;
  callbacks?: unknown[];
  [key: string]: unknown;
}

const parseState = (raw: unknown): RoutingState => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as RoutingState;
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as RoutingState) : {};
};

// The JSON shapes Exotel expects back from a Connect dynamic URL.
const dialResponse = (phone: string) => ({
  fetch_after_attempt: true,
  destination: { numbers: [phone] },
  record: true,
  recording_channels: "dual",
  max_ringing_duration: 25,
  max_conversation_duration: 3600,
});

// An empty destination triggers the flow's "we didn't dial anyone" branch,
// where the tenant parks their voicemail / out-of-hours announcement.
const emptyResponse = () => ({ fetch_after_attempt: false, destination: { numbers: [] } });

class ExotelWebhookService {
  async configForToken(token: string): Promise<TenantTelephonyRow | undefined> {
    const cfg = await telephonyRepository.getConfigByWebhookToken(token);
    return cfg?.provider === "EXOTEL" ? cfg : undefined;
  }

  /** Connect applet dynamic URL: decide who to ring for this attempt. */
  async routeCall(cfg: TenantTelephonyRow, q: Record<string, string>): Promise<object> {
    const callSid = q.CallSid?.trim();
    if (!callSid) return emptyResponse();

    const callerPhone = normalizePhone(q.CallFrom || q.From || "");
    const dialedNumber = normalizePhone(q.CallTo || q.To || "");

    let call = await telephonyRepository.findCallByExternalId(callSid);
    if (call && call.tenant_id !== cfg.tenant_id) return emptyResponse();

    if (!call) {
      // First fetch for this call: attach the caller to a person (auto-create
      // a lead for an unknown number, a ringing phone IS a lead) and open the
      // call row that every later webhook keys on.
      let leadId: string | null = null;
      let contactId: string | null = null;
      if (callerPhone) {
        const lead = await inboundRepository.leadByPhone(cfg.tenant_id, callerPhone);
        if (lead) {
          leadId = lead.id;
        } else {
          const contact = await inboundRepository.contactByPhone(cfg.tenant_id, callerPhone);
          if (contact) {
            contactId = contact.id;
          } else {
            const created = await inboundRepository.createLead({
              tenant_id: cfg.tenant_id,
              name: callerPhone,
              email: null,
              phone: callerPhone,
              source: "Phone call",
            });
            leadId = created.id;
          }
        }
      }

      call = await telephonyRepository.createCall({
        tenant_id: cfg.tenant_id,
        lead_id: leadId,
        contact_id: contactId,
        agent_user_id: null,
        provider: "exotel",
        direction: "INBOUND",
        external_call_id: callSid,
        call_status: "in-progress",
        from_number: callerPhone || (q.CallFrom ?? ""),
        to_number: dialedNumber || (q.CallTo ?? ""),
        structured_data: { attempted_user_ids: [] },
      });
    }

    const state = parseState(call.structured_data);
    const attempted = Array.isArray(state.attempted_user_ids)
      ? [...new Set(state.attempted_user_ids)]
      : [];

    // Out of working hours: don't ring anyone; the flow's failure branch plays
    // the tenant's voicemail. Checked per fetch so a call that starts at 18:59
    // still cascades normally.
    const open = await schedulingService.isTenantOpen(cfg.tenant_id, new Date());
    if (!open) {
      state.out_of_hours = true;
      await telephonyRepository.updateCallByExternalId(callSid, { structured_data: state });
      return emptyResponse();
    }

    const decision = await telephonyRoutingService.pickNextAgent(cfg.tenant_id, {
      leadId: call.lead_id,
      calledNumber: dialedNumber || call.to_number || "",
      excludeUserIds: attempted,
    });

    if (decision.exhausted || !decision.phone || !decision.userId) {
      return emptyResponse();
    }

    state.attempted_user_ids = [...attempted, decision.userId];
    await telephonyRepository.updateCallByExternalId(callSid, { structured_data: state });
    return dialResponse(decision.phone);
  }

  /** Passthru applet at flow end: record how the inbound call actually went. */
  async finalizeInbound(cfg: TenantTelephonyRow, q: Record<string, string>): Promise<void> {
    const callSid = q.CallSid?.trim();
    if (!callSid) return;

    const call = await telephonyRepository.findCallByExternalId(callSid);
    if (!call || call.tenant_id !== cfg.tenant_id) return;

    const status = this.mapStatus(q.CallStatus, q.DialCallDuration);
    // Exotel redelivers Passthru hits; a row already finalized with this
    // status has nothing left to do.
    if (call.call_status === status && TERMINAL_CALL_STATUSES.includes(status)) return;

    const durationSec = Number(q.DialCallDuration ?? q.ConversationDuration ?? 0) || 0;
    const agentUserId = await this.agentByDialedPhone(cfg.tenant_id, q.DialWhomNumber, call);

    const state = parseState(call.structured_data);
    state.callbacks = [...(Array.isArray(state.callbacks) ? state.callbacks : []), q];

    const missed = status !== "completed" || durationSec === 0;
    await telephonyRepository.updateCallByExternalId(callSid, {
      call_status: status,
      duration_sec: durationSec,
      recording_url: q.RecordingUrl?.trim() || call.recording_url,
      agent_user_id: agentUserId ?? call.agent_user_id,
      ...(missed ? { outcome: "MISSED" } : {}),
      structured_data: state,
    });

    if (missed) {
      await this.createCallbackTask(cfg.tenant_id, call);
    } else {
      void callIntelligenceService.processCall(call.id);
    }
  }

  /** StatusCallback for API-placed outbound calls (JSON POST). */
  async applyOutboundStatus(
    cfg: TenantTelephonyRow,
    body: Record<string, unknown>
  ): Promise<void> {
    const callSid = String(body.CallSid ?? "").trim();
    const customField = String(body.CustomField ?? "").trim();

    let call = callSid ? await telephonyRepository.findCallByExternalId(callSid) : undefined;
    if (!call && customField) {
      call = await telephonyRepository.getCallById(cfg.tenant_id, customField);
    }
    if (!call || call.tenant_id !== cfg.tenant_id || !call.external_call_id) return;

    const status = String(body.Status ?? body.CallStatus ?? "").trim().toLowerCase();
    if (!status) return;

    const durationSec =
      Number(body.ConversationDuration ?? body.DialCallDuration ?? body.Duration ?? 0) || 0;
    const recordingUrl = String(body.RecordingUrl ?? "").trim() || null;

    const state = parseState(call.structured_data);
    state.callbacks = [...(Array.isArray(state.callbacks) ? state.callbacks : []), body];

    const wasTerminal =
      !!call.call_status && TERMINAL_CALL_STATUSES.includes(call.call_status);

    await telephonyRepository.updateCallByExternalId(call.external_call_id, {
      call_status: status,
      ...(durationSec ? { duration_sec: durationSec } : {}),
      ...(recordingUrl ? { recording_url: recordingUrl } : {}),
      ...(status === "failed" || status === "busy" || status === "no-answer"
        ? { call_error: `Call ended ${status}` }
        : {}),
      structured_data: state,
    });

    if (!wasTerminal && TERMINAL_CALL_STATUSES.includes(status)) {
      void callIntelligenceService.processCall(call.id);
    }
  }

  // ---- helpers ----

  private mapStatus(rawStatus: string | undefined, dialDuration: string | undefined): string {
    const status = String(rawStatus ?? "").trim().toLowerCase();
    if (TERMINAL_CALL_STATUSES.includes(status)) return status;
    // Some flow configurations report only the overall CallStatus; treat a
    // finished call with zero conversation as no-answer.
    if (status === "completed" || status === "") {
      return Number(dialDuration ?? 0) > 0 ? "completed" : "no-answer";
    }
    return status || "no-answer";
  }

  /**
   * Which agent actually answered: match DialWhomNumber against tenant users'
   * phones. Exotel reports it in whatever format the flow dialed (+91 / 0 /
   * bare), so both sides go through normalizePhone.
   */
  private async agentByDialedPhone(
    tenantId: string,
    dialWhom: string | undefined,
    call: { structured_data: unknown }
  ): Promise<string | null> {
    const dialed = normalizePhone(String(dialWhom ?? "").trim());
    if (!dialed) return null;

    // The attempted list is tiny (the cascade), so check it first.
    const state = parseState(call.structured_data);
    const attempted = Array.isArray(state.attempted_user_ids) ? state.attempted_user_ids : [];
    if (attempted.length) {
      const rows = await db
        .selectFrom("users")
        .select(["id", "phone"])
        .where("tenant_id", "=", tenantId)
        .where("id", "in", attempted)
        .execute();
      const hit = rows.find((r) => r.phone && normalizePhone(r.phone) === dialed);
      if (hit) return hit.id;
    }

    const row = await db
      .selectFrom("users")
      .select(["id", "phone"])
      .where("tenant_id", "=", tenantId)
      .where("phone", "is not", null)
      .execute();
    return row.find((r) => r.phone && normalizePhone(r.phone) === dialed)?.id ?? null;
  }

  private async createCallbackTask(
    tenantId: string,
    call: { id: string; lead_id: string | null; contact_id: string | null }
  ): Promise<void> {
    try {
      // The sticky agent owns the callback; nobody specific means unassigned,
      // which surfaces in the shared task list rather than vanishing.
      let ownerId: string | null = null;
      let name = "an unknown caller";
      if (call.lead_id) {
        const lead = await db
          .selectFrom("leads")
          .select(["name", "owner_id"])
          .where("tenant_id", "=", tenantId)
          .where("id", "=", call.lead_id)
          .executeTakeFirst();
        if (lead) {
          name = lead.name;
          ownerId =
            lead.owner_id ??
            (await telephonyRepository.lastCompletedAgentForLead(tenantId, call.lead_id));
        }
      } else if (call.contact_id) {
        const contact = await db
          .selectFrom("contacts")
          .select(["name", "owner_id"])
          .where("tenant_id", "=", tenantId)
          .where("id", "=", call.contact_id)
          .executeTakeFirst();
        if (contact) {
          name = contact.name;
          ownerId = contact.owner_id;
        }
      }

      const now = new Date();
      await db
        .insertInto("tasks")
        .values({
          id: ulid(),
          tenant_id: tenantId,
          title: `Call back ${name} (missed call)`,
          status: "OPEN",
          priority: "HIGH",
          due_at: new Date(now.getTime() + 2 * 3600_000),
          owner_id: ownerId,
          lead_id: call.lead_id,
          contact_id: call.contact_id,
          ai_generated: false,
          created_at: now,
          updated_at: now,
        })
        .execute();
    } catch (err) {
      logger.warn(`missed-call task for ${call.id}: ${String(err)}`);
    }
  }
}

export default new ExotelWebhookService();
