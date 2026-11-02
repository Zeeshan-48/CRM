import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { encryptSecret } from "../../src/utils/crypto";
import { api } from "../helpers";

// The inbound Exotel pipeline end to end: Connect dynamic-URL routing (sticky
// agent, cascade, exhaustion, out-of-hours, dedicated numbers), Passthru
// finalize (agent attach by dialed number, missed-call task), and the outbound
// StatusCallback. All through the real public webhook endpoints.

let tenantId: string;
let stickyAgentId: string;
let secondAgentId: string;
let leadId: string;
let savedConfig: Record<string, unknown> | null = null;
let savedTenantConfig: unknown = null;

const marker = `ExotelHookTest-${Date.now()}`;
const TOKEN = `hooktok${Date.now().toString(36)}`;
const MAIN_EXOPHONE = "+918047220001";
const AGENT_EXOPHONE = "+918047220002";
const STICKY_PHONE = "+919812350001";
const SECOND_PHONE = "+919812350002";
const LEAD_PHONE = "+919812350009";
const webhook = (path: string) => `/api/v1/telephony/webhooks/exotel/${TOKEN}/${path}`;

// Retry-loop assert for work that happens after the webhook has already
// answered (finalize + callback process async).
const eventually = async <T>(fn: () => Promise<T | undefined | null>): Promise<T> => {
  for (let i = 0; i < 25; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("condition never became true");
};

const setWorkingHours = async (hours: { days: number[]; start: string; end: string }) => {
  const row = await db
    .selectFrom("tenants")
    .select("config")
    .where("id", "=", tenantId)
    .executeTakeFirst();
  const config =
    row?.config && typeof row.config === "object" ? { ...(row.config as Record<string, unknown>) } : {};
  config.scheduling = { timezone: "Asia/Kolkata", ...hours };
  await db
    .updateTable("tenants")
    .set({ config: JSON.stringify(config) })
    .where("id", "=", tenantId)
    .execute();
};

const ALWAYS_OPEN = { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" };
const ALWAYS_CLOSED = { days: [], start: "00:00", end: "00:01" };

beforeAll(async () => {
  const tenant = await db
    .selectFrom("tenants")
    .select(["id", "config"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  savedTenantConfig = tenant.config;

  savedConfig =
    ((await db
      .selectFrom("tenant_telephony")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_telephony").where("tenant_id", "=", tenantId).execute();
  await db.deleteFrom("telephony_numbers").where("tenant_id", "=", tenantId).execute();

  const now = new Date();
  // A validated Exotel config with a KNOWN webhook token, written directly (the
  // webhook is what we are testing, not the settings flow).
  await db
    .insertInto("tenant_telephony")
    .values({
      id: ulid(),
      tenant_id: tenantId,
      provider: "EXOTEL",
      account_sid: "acme1",
      auth_token_encrypted: encryptSecret("tok"),
      api_key_encrypted: encryptSecret("key"),
      subdomain: "api.in.exotel.com",
      from_number: MAIN_EXOPHONE,
      webhook_token: TOKEN,
      status: "ACTIVE",
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();

  // Two dedicated ring-able agents owned by this suite, so routing decisions
  // never depend on the seed users' phone/availability state.
  stickyAgentId = ulid();
  secondAgentId = ulid();
  await db
    .insertInto("users")
    .values([
      {
        id: stickyAgentId,
        tenant_id: tenantId,
        name: `${marker} Sticky`,
        email: `${marker.toLowerCase()}.sticky@example.com`,
        password_hash: "x",
        role: "SALES_AGENT",
        status: "ACTIVE",
        phone: STICKY_PHONE,
        created_at: now,
        updated_at: now,
      },
      {
        id: secondAgentId,
        tenant_id: tenantId,
        name: `${marker} Second`,
        email: `${marker.toLowerCase()}.second@example.com`,
        password_hash: "x",
        role: "SALES_AGENT",
        status: "ACTIVE",
        phone: SECOND_PHONE,
        created_at: now,
        updated_at: now,
      },
    ])
    .execute();
  // Establish availability explicitly (never assume the column default).
  await db
    .updateTable("users")
    .set({ available_for_calls: true })
    .where("id", "in", [stickyAgentId, secondAgentId])
    .execute();
  // Everyone else sits out so least-recently-called ranking is deterministic.
  await db
    .updateTable("users")
    .set({ available_for_calls: false })
    .where("tenant_id", "=", tenantId)
    .where("id", "not in", [stickyAgentId, secondAgentId])
    .execute();

  // The lead is OWNED by the sticky agent, that is the sticky signal.
  leadId = ulid();
  await db
    .insertInto("leads")
    .values({
      id: leadId,
      tenant_id: tenantId,
      name: marker,
      phone: LEAD_PHONE,
      owner_id: stickyAgentId,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db
    .insertInto("telephony_numbers")
    .values([
      {
        id: ulid(),
        tenant_id: tenantId,
        phone: MAIN_EXOPHONE,
        label: "Main",
        kind: "MAIN",
        assigned_user_id: null,
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: ulid(),
        tenant_id: tenantId,
        phone: AGENT_EXOPHONE,
        label: "Second's line",
        kind: "AGENT",
        assigned_user_id: secondAgentId,
        active: true,
        created_at: now,
        updated_at: now,
      },
    ])
    .execute();

  await setWorkingHours(ALWAYS_OPEN);
});

afterAll(async () => {
  // Restore availability for everyone this suite benched.
  await db
    .updateTable("users")
    .set({ available_for_calls: true })
    .where("tenant_id", "=", tenantId)
    .execute();
  await db
    .updateTable("tenants")
    .set({ config: (savedTenantConfig ?? null) as never })
    .where("id", "=", tenantId)
    .execute();
  await db.deleteFrom("tasks").where("tenant_id", "=", tenantId).where("lead_id", "=", leadId).execute();
  await db
    .deleteFrom("activities")
    .where("tenant_id", "=", tenantId)
    .where("lead_id", "=", leadId)
    .execute();
  await db.deleteFrom("voice_calls").where("tenant_id", "=", tenantId).where("provider", "=", "exotel").execute();
  // Sweep leads auto-created from unknown callers this run.
  await db
    .deleteFrom("leads")
    .where("tenant_id", "=", tenantId)
    .where("source", "=", "Phone call")
    .where("phone", "like", "+9198123599%")
    .execute();
  await db.deleteFrom("leads").where("id", "=", leadId).execute();
  await db.deleteFrom("users").where("id", "in", [stickyAgentId, secondAgentId]).execute();
  await db.deleteFrom("telephony_numbers").where("tenant_id", "=", tenantId).execute();
  await db.deleteFrom("tenant_telephony").where("tenant_id", "=", tenantId).execute();
  if (savedConfig) {
    await db.insertInto("tenant_telephony").values(savedConfig as never).execute();
  }
  await closeDB();
});

describe("token auth", () => {
  it("404s all three endpoints on a bad token", async () => {
    const route = await api.get("/api/v1/telephony/webhooks/exotel/nope/route?CallSid=x");
    expect(route.status).toBe(404);
    const status = await api.get("/api/v1/telephony/webhooks/exotel/nope/status?CallSid=x");
    expect(status.status).toBe(404);
    const cb = await api.post("/api/v1/telephony/webhooks/exotel/nope/callback").send({});
    expect(cb.status).toBe(404);
  });
});

describe("inbound routing (Connect dynamic URL)", () => {
  const callSid = `EX_${marker}_1`;

  it("rings the sticky agent first (0-prefixed caller normalized to the lead)", async () => {
    const res = await api.get(webhook("route")).query({
      CallSid: callSid,
      // Exotel-style 0-prefixed national number; the lead stores +91...
      CallFrom: `0${LEAD_PHONE.slice(3)}`,
      CallTo: MAIN_EXOPHONE,
      Direction: "incoming",
    });
    expect(res.status).toBe(200);
    expect(res.body.destination.numbers).toEqual([STICKY_PHONE]);
    expect(res.body.fetch_after_attempt).toBe(true);
    expect(res.body.record).toBe(true);

    const call = await db
      .selectFrom("voice_calls")
      .selectAll()
      .where("external_call_id", "=", callSid)
      .executeTakeFirstOrThrow();
    expect(call.direction).toBe("INBOUND");
    expect(call.provider).toBe("exotel");
    expect(call.lead_id).toBe(leadId);
  });

  it("re-fetch cascades to the next agent, then exhausts to an empty destination", async () => {
    const second = await api.get(webhook("route")).query({
      CallSid: callSid,
      CallFrom: LEAD_PHONE,
      CallTo: MAIN_EXOPHONE,
      DialCallStatus: "no-answer",
    });
    expect(second.status).toBe(200);
    expect(second.body.destination.numbers).toEqual([SECOND_PHONE]);

    const third = await api.get(webhook("route")).query({
      CallSid: callSid,
      CallFrom: LEAD_PHONE,
      CallTo: MAIN_EXOPHONE,
      DialCallStatus: "no-answer",
    });
    expect(third.status).toBe(200);
    expect(third.body.destination.numbers).toEqual([]);
  });

  it("auto-creates a lead for an unknown caller", async () => {
    const unknownPhone = "+919812359901";
    const res = await api.get(webhook("route")).query({
      CallSid: `EX_${marker}_unknown`,
      CallFrom: unknownPhone,
      CallTo: MAIN_EXOPHONE,
    });
    expect(res.status).toBe(200);

    const lead = await db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("phone", "=", unknownPhone)
      .executeTakeFirstOrThrow();
    expect(lead.source).toBe("Phone call");
  });

  it("a call to an agent's dedicated ExoPhone rings that agent first", async () => {
    const res = await api.get(webhook("route")).query({
      CallSid: `EX_${marker}_dedicated`,
      CallFrom: LEAD_PHONE,
      CallTo: AGENT_EXOPHONE,
    });
    expect(res.status).toBe(200);
    // The lead's sticky agent is Sticky, but the DIALED NUMBER belongs to
    // Second, ownership of the number outranks stickiness.
    expect(res.body.destination.numbers).toEqual([SECOND_PHONE]);
  });

  it("returns an empty destination outside working hours", async () => {
    await setWorkingHours(ALWAYS_CLOSED);
    try {
      const res = await api.get(webhook("route")).query({
        CallSid: `EX_${marker}_closed`,
        CallFrom: LEAD_PHONE,
        CallTo: MAIN_EXOPHONE,
      });
      expect(res.status).toBe(200);
      expect(res.body.destination.numbers).toEqual([]);
    } finally {
      await setWorkingHours(ALWAYS_OPEN);
    }
  });
});

describe("inbound finalize (Passthru)", () => {
  it("completed: attaches the agent by 0-prefixed DialWhomNumber and stores the recording", async () => {
    const callSid = `EX_${marker}_done`;
    await api.get(webhook("route")).query({
      CallSid: callSid,
      CallFrom: LEAD_PHONE,
      CallTo: MAIN_EXOPHONE,
    });

    const res = await api.get(webhook("status")).query({
      CallSid: callSid,
      CallStatus: "completed",
      DialCallDuration: "42",
      DialWhomNumber: `0${STICKY_PHONE.slice(3)}`,
      RecordingUrl: "https://recordings.exotel.com/rec1.mp3",
    });
    expect(res.status).toBe(200);

    const call = await eventually(async () => {
      const row = await db
        .selectFrom("voice_calls")
        .selectAll()
        .where("external_call_id", "=", callSid)
        .executeTakeFirst();
      return row?.call_status === "completed" ? row : null;
    });
    expect(call.duration_sec).toBe(42);
    expect(call.agent_user_id).toBe(stickyAgentId);
    expect(call.recording_url).toBe("https://recordings.exotel.com/rec1.mp3");
    expect(call.completed_at).not.toBeNull();

    // The intelligence pipeline records the CALL activity (transcription is
    // skipped under test, side effects are not).
    await eventually(async () =>
      db
        .selectFrom("activities")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .where("type", "=", "CALL")
        .where("subject", "=", "Inbound phone call")
        .executeTakeFirst()
    );
  });

  it("missed: outcome MISSED and a HIGH callback task for the sticky agent", async () => {
    const callSid = `EX_${marker}_missed`;
    await api.get(webhook("route")).query({
      CallSid: callSid,
      CallFrom: LEAD_PHONE,
      CallTo: MAIN_EXOPHONE,
    });

    const res = await api.get(webhook("status")).query({
      CallSid: callSid,
      CallStatus: "no-answer",
      DialCallDuration: "0",
    });
    expect(res.status).toBe(200);

    const call = await eventually(async () => {
      const row = await db
        .selectFrom("voice_calls")
        .selectAll()
        .where("external_call_id", "=", callSid)
        .executeTakeFirst();
      return row?.outcome === "MISSED" ? row : null;
    });
    expect(call.call_status).toBe("no-answer");

    const task = await eventually(async () =>
      db
        .selectFrom("tasks")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .where("title", "like", `%${marker}%`)
        .executeTakeFirst()
    );
    expect(task.priority).toBe("HIGH");
    expect(task.owner_id).toBe(stickyAgentId);
    expect(task.status).toBe("OPEN");
  });
});

describe("outbound StatusCallback", () => {
  it("updates the call row on terminal status", async () => {
    const now = new Date();
    const rowId = ulid();
    const callSid = `EX_${marker}_out`;
    await db
      .insertInto("voice_calls")
      .values({
        id: rowId,
        tenant_id: tenantId,
        lead_id: leadId,
        agent_user_id: stickyAgentId,
        provider: "exotel",
        direction: "OUTBOUND",
        external_call_id: callSid,
        call_status: "in-progress",
        from_number: MAIN_EXOPHONE,
        to_number: LEAD_PHONE,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const res = await api
      .post(webhook("callback"))
      .send({
        CallSid: callSid,
        Status: "completed",
        ConversationDuration: 77,
        RecordingUrl: "https://recordings.exotel.com/rec2.mp3",
        CustomField: rowId,
      });
    expect(res.status).toBe(200);

    const call = await eventually(async () => {
      const row = await db
        .selectFrom("voice_calls")
        .selectAll()
        .where("id", "=", rowId)
        .executeTakeFirst();
      return row?.call_status === "completed" ? row : null;
    });
    expect(call.duration_sec).toBe(77);
    expect(call.recording_url).toBe("https://recordings.exotel.com/rec2.mp3");
  });
});
