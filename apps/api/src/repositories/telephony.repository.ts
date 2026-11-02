import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { telephony_status } from "../db/enums";
import type { tenant_telephony, voice_calls } from "../db/types";

export type TenantTelephonyRow = Selectable<tenant_telephony>;
export type VoiceCallRow = Selectable<voice_calls>;

// Call statuses Twilio will not move past, so the poller can stop checking.
export const TERMINAL_CALL_STATUSES = ["completed", "busy", "failed", "no-answer", "canceled"];

class TelephonyRepository {
  // ---- Config (one per tenant) ----
  async getConfig(tenantId: string): Promise<TenantTelephonyRow | undefined> {
    return db
      .selectFrom("tenant_telephony")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async upsertConfig(data: {
    tenant_id: string;
    provider?: string;
    account_sid: string;
    auth_token_encrypted: string;
    from_number: string;
    api_key_encrypted?: string | null;
    subdomain?: string | null;
    webhook_token?: string | null;
  }): Promise<TenantTelephonyRow> {
    const existing = await this.getConfig(data.tenant_id);
    const now = new Date();
    const provider = data.provider ?? "TWILIO";
    if (existing) {
      return db
        .updateTable("tenant_telephony")
        .set({
          provider,
          account_sid: data.account_sid,
          auth_token_encrypted: data.auth_token_encrypted,
          from_number: data.from_number,
          api_key_encrypted: data.api_key_encrypted ?? null,
          subdomain: data.subdomain ?? null,
          // Preserve an existing webhook token across re-saves: the tenant has
          // already pasted the URLs into their Exotel flow.
          webhook_token: data.webhook_token ?? existing.webhook_token,
          status: "PENDING",
          last_error: null,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return db
      .insertInto("tenant_telephony")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        provider,
        account_sid: data.account_sid,
        auth_token_encrypted: data.auth_token_encrypted,
        from_number: data.from_number,
        api_key_encrypted: data.api_key_encrypted ?? null,
        subdomain: data.subdomain ?? null,
        webhook_token: data.webhook_token ?? null,
        status: "PENDING",
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Indexed unique lookup for the public Exotel webhook path. This sits on the
  // Connect dynamic-URL hot path (Exotel gives us 5 seconds), hence unique-index
  // only, no joins.
  async getConfigByWebhookToken(token: string): Promise<TenantTelephonyRow | undefined> {
    if (!token) return undefined;
    return db
      .selectFrom("tenant_telephony")
      .selectAll()
      .where("webhook_token", "=", token)
      .executeTakeFirst();
  }

  async updateStatus(
    tenantId: string,
    patch: { status?: telephony_status; verified_at?: Date | null; last_error?: string | null }
  ): Promise<TenantTelephonyRow> {
    return db
      .updateTable("tenant_telephony")
      .set({ ...patch, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async removeConfig(tenantId: string): Promise<void> {
    await db.deleteFrom("tenant_telephony").where("tenant_id", "=", tenantId).execute();
  }

  // ---- Recipient + agent lookups ----
  async leadPhone(
    tenantId: string,
    leadId: string
  ): Promise<{ name: string; phone: string | null } | undefined> {
    return db
      .selectFrom("leads")
      .select(["name", "phone"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", leadId)
      .executeTakeFirst();
  }

  async contactPhone(
    tenantId: string,
    contactId: string
  ): Promise<{ name: string; phone: string | null } | undefined> {
    return db
      .selectFrom("contacts")
      .select(["name", "phone"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", contactId)
      .executeTakeFirst();
  }

  async userPhone(tenantId: string, userId: string): Promise<string | null> {
    const row = await db
      .selectFrom("users")
      .select(["phone"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", userId)
      .executeTakeFirst();
    return row?.phone ?? null;
  }

  // ---- Call records (stored in voice_calls) ----
  async createCall(data: {
    tenant_id: string;
    lead_id: string | null;
    contact_id: string | null;
    agent_user_id: string | null;
    provider?: string;
    direction?: "INBOUND" | "OUTBOUND";
    twilio_call_sid?: string | null;
    external_call_id?: string | null;
    call_status: string;
    from_number: string;
    to_number: string;
    structured_data?: unknown;
    summary?: string | null;
    outcome?: string | null;
    duration_sec?: number;
    completed_at?: Date | null;
  }): Promise<VoiceCallRow> {
    const now = new Date();
    return db
      .insertInto("voice_calls")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        lead_id: data.lead_id,
        contact_id: data.contact_id,
        agent_user_id: data.agent_user_id,
        direction: data.direction ?? "OUTBOUND",
        provider: data.provider ?? "twilio",
        twilio_call_sid: data.twilio_call_sid ?? null,
        external_call_id: data.external_call_id ?? null,
        call_status: data.call_status,
        from_number: data.from_number,
        to_number: data.to_number,
        ...(data.structured_data !== undefined
          ? { structured_data: JSON.stringify(data.structured_data) }
          : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.outcome !== undefined ? { outcome: data.outcome } : {}),
        ...(data.duration_sec !== undefined ? { duration_sec: data.duration_sec } : {}),
        ...(data.completed_at !== undefined ? { completed_at: data.completed_at } : {}),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateCallStatus(
    callSid: string,
    patch: { call_status: string; duration_sec?: number; call_error?: string | null }
  ): Promise<void> {
    await db
      .updateTable("voice_calls")
      .set({
        call_status: patch.call_status,
        ...(patch.duration_sec !== undefined ? { duration_sec: patch.duration_sec } : {}),
        ...(patch.call_error !== undefined ? { call_error: patch.call_error } : {}),
        ...(TERMINAL_CALL_STATUSES.includes(patch.call_status) ? { completed_at: new Date() } : {}),
        updated_at: new Date(),
      })
      .where("twilio_call_sid", "=", callSid)
      .execute();
  }

  async listCalls(tenantId: string, limit = 50): Promise<VoiceCallRow[]> {
    return db
      .selectFrom("voice_calls")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      // Human telephony providers only: the voice-AI engine and simulated demo
      // calls share voice_calls but belong to their own surfaces.
      .where("provider", "in", ["twilio", "exotel", "manual"])
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  // Non-terminal Twilio calls for the poller, across tenants.
  async pollableCalls(limit = 100): Promise<
    Array<{ tenant_id: string; twilio_call_sid: string }>
  > {
    const rows = await db
      .selectFrom("voice_calls")
      .select(["tenant_id", "twilio_call_sid"])
      .where("provider", "=", "twilio")
      .where("twilio_call_sid", "is not", null)
      .where((eb) => eb.or([eb("call_status", "is", null), eb("call_status", "not in", TERMINAL_CALL_STATUSES)]))
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
    return rows
      .filter((r): r is { tenant_id: string; twilio_call_sid: string } => !!r.twilio_call_sid);
  }

  // ---- Exotel call helpers ----

  async findCallByExternalId(externalCallId: string): Promise<VoiceCallRow | undefined> {
    return db
      .selectFrom("voice_calls")
      .selectAll()
      .where("external_call_id", "=", externalCallId)
      .executeTakeFirst();
  }

  async getCallById(tenantId: string, id: string): Promise<VoiceCallRow | undefined> {
    return db
      .selectFrom("voice_calls")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * Updates a call found by its provider Sid. Status changes never downgrade a
   * terminal row (StatusCallback, Passthru and the sync sweep can race, and
   * Exotel redelivers), while non-status fields (recording, agent, summary)
   * still apply.
   */
  async updateCallByExternalId(
    externalCallId: string,
    patch: {
      call_status?: string;
      duration_sec?: number;
      recording_url?: string | null;
      agent_user_id?: string | null;
      outcome?: string | null;
      structured_data?: unknown;
      call_error?: string | null;
      summary?: string | null;
      sentiment_label?: string | null;
      sentiment_score?: number | null;
      transcript?: unknown;
      lead_id?: string | null;
      contact_id?: string | null;
    }
  ): Promise<VoiceCallRow | undefined> {
    const existing = await this.findCallByExternalId(externalCallId);
    if (!existing) return undefined;

    const set: Record<string, unknown> = { updated_at: new Date() };
    const alreadyTerminal =
      !!existing.call_status && TERMINAL_CALL_STATUSES.includes(existing.call_status);

    if (patch.call_status !== undefined && !(alreadyTerminal && !TERMINAL_CALL_STATUSES.includes(patch.call_status))) {
      set.call_status = patch.call_status;
      if (TERMINAL_CALL_STATUSES.includes(patch.call_status) && !existing.completed_at) {
        set.completed_at = new Date();
      }
    }
    if (patch.duration_sec !== undefined) set.duration_sec = patch.duration_sec;
    if (patch.recording_url !== undefined) set.recording_url = patch.recording_url;
    if (patch.agent_user_id !== undefined) set.agent_user_id = patch.agent_user_id;
    if (patch.outcome !== undefined) set.outcome = patch.outcome;
    if (patch.call_error !== undefined) set.call_error = patch.call_error;
    if (patch.summary !== undefined) set.summary = patch.summary;
    if (patch.sentiment_label !== undefined) set.sentiment_label = patch.sentiment_label;
    if (patch.sentiment_score !== undefined) set.sentiment_score = patch.sentiment_score;
    if (patch.lead_id !== undefined) set.lead_id = patch.lead_id;
    if (patch.contact_id !== undefined) set.contact_id = patch.contact_id;
    if (patch.structured_data !== undefined) {
      set.structured_data = JSON.stringify(patch.structured_data);
    }
    if (patch.transcript !== undefined) set.transcript = JSON.stringify(patch.transcript);

    return db
      .updateTable("voice_calls")
      .set(set as never)
      .where("id", "=", existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** The agent who last finished a call with this lead, the sticky pick. */
  async lastCompletedAgentForLead(tenantId: string, leadId: string): Promise<string | null> {
    const row = await db
      .selectFrom("voice_calls")
      .select(["agent_user_id"])
      .where("tenant_id", "=", tenantId)
      .where("lead_id", "=", leadId)
      .where("agent_user_id", "is not", null)
      .where("completed_at", "is not", null)
      .orderBy("completed_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return row?.agent_user_id ?? null;
  }

  /**
   * Agents eligible to take an inbound call, ranked least-recently-called
   * first (never-called agents lead). One grouped query: this sits on the
   * 5-second Connect dynamic-URL path.
   */
  async eligibleAgents(
    tenantId: string,
    excludeIds: string[]
  ): Promise<Array<{ id: string; name: string; phone: string; last_called_at: Date | null }>> {
    let query = db
      .selectFrom("users")
      .leftJoin("voice_calls", (join) =>
        join
          .onRef("voice_calls.agent_user_id", "=", "users.id")
          .on("voice_calls.tenant_id", "=", tenantId)
      )
      .select(({ fn }) => [
        "users.id as id",
        "users.name as name",
        "users.phone as phone",
        fn.max("voice_calls.created_at").as("last_called_at"),
      ])
      .where("users.tenant_id", "=", tenantId)
      .where("users.status", "=", "ACTIVE")
      .where("users.available_for_calls", "=", true)
      .where("users.phone", "is not", null)
      .groupBy(["users.id", "users.name", "users.phone"]);
    if (excludeIds.length) query = query.where("users.id", "not in", excludeIds);

    const rows = await query.execute();
    return rows
      .filter((r): r is typeof r & { phone: string } => !!r.phone)
      .map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        last_called_at: r.last_called_at ? new Date(r.last_called_at as unknown as string) : null,
      }))
      .sort((a, b) => {
        if (!a.last_called_at && !b.last_called_at) return 0;
        if (!a.last_called_at) return -1;
        if (!b.last_called_at) return 1;
        return a.last_called_at.getTime() - b.last_called_at.getTime();
      });
  }

  /** Non-terminal Exotel calls for the reconciliation sweep. */
  async staleExotelCalls(
    olderThan: Date,
    limit = 50
  ): Promise<Array<{ id: string; tenant_id: string; external_call_id: string }>> {
    const rows = await db
      .selectFrom("voice_calls")
      .select(["id", "tenant_id", "external_call_id"])
      .where("provider", "=", "exotel")
      .where("external_call_id", "is not", null)
      .where("external_call_id", "not like", "sim\\_%")
      .where("created_at", "<", olderThan)
      .where((eb) =>
        eb.or([eb("call_status", "is", null), eb("call_status", "not in", TERMINAL_CALL_STATUSES)])
      )
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
    return rows.filter(
      (r): r is { id: string; tenant_id: string; external_call_id: string } =>
        !!r.external_call_id
    );
  }

  /**
   * Terminal Exotel calls whose recording is still the provider's authed http
   * URL (not yet mirrored to our storage). The sweep retries these.
   */
  async exotelCallsMissingMirror(since: Date, limit = 25): Promise<VoiceCallRow[]> {
    return db
      .selectFrom("voice_calls")
      .selectAll()
      .where("provider", "=", "exotel")
      .where("recording_url", "like", "http%")
      .where("created_at", ">", since)
      .where("call_status", "in", TERMINAL_CALL_STATUSES)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }
}

export default new TelephonyRepository();
