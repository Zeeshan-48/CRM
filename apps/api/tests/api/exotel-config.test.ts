import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, NW_SALES, login } from "../helpers";

// Exotel config + numbers pool + outbound click-to-call + manual logging.
// Snapshot/restore of tenant_telephony per house rules; beforeAll ESTABLISHES
// the state each block needs rather than assuming it.

let adminToken: string;
let salesToken: string;
let tenantId: string;
let salesUserId: string;
let leadId: string;
let savedConfig: Record<string, unknown> | null = null;

const marker = `ExotelCfgTest-${Date.now()}`;
const leadPhone = "+919812340001";
const agentPhone = "+919812340002";
const MAIN_EXOPHONE = "+918047110001";
const AGENT_EXOPHONE = "+918047110002";
const API_TOKEN = "exotel-super-secret-token";
const API_KEY = "exotel-super-secret-key";

// An instant inside the TRAI window (15:00 IST) so outbound tests do not
// depend on when the suite runs.
const IST_AFTERNOON = new Date(Date.UTC(2026, 7, 20, 9, 30));
const IST_NIGHT = new Date(Date.UTC(2026, 7, 20, 17, 0)); // 22:30 IST

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;

  const sales = await db
    .selectFrom("users")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .where("email", "=", NW_SALES.email)
    .executeTakeFirstOrThrow();
  salesUserId = sales.id;

  savedConfig =
    ((await db
      .selectFrom("tenant_telephony")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_telephony").where("tenant_id", "=", tenantId).execute();
  await db.deleteFrom("telephony_numbers").where("tenant_id", "=", tenantId).execute();

  const now = new Date();
  leadId = ulid();
  await db
    .insertInto("leads")
    .values({
      id: leadId,
      tenant_id: tenantId,
      name: marker,
      phone: leadPhone,
      created_at: now,
      updated_at: now,
    })
    .execute();
});

afterAll(async () => {
  vi.useRealTimers();
  await db
    .deleteFrom("activities")
    .where("tenant_id", "=", tenantId)
    .where("lead_id", "=", leadId)
    .execute();
  await db
    .deleteFrom("voice_calls")
    .where("tenant_id", "=", tenantId)
    .where("provider", "in", ["exotel", "manual"])
    .execute();
  await db.deleteFrom("telephony_numbers").where("tenant_id", "=", tenantId).execute();
  await db.deleteFrom("tenant_telephony").where("tenant_id", "=", tenantId).execute();
  if (savedConfig) {
    await db.insertInto("tenant_telephony").values(savedConfig as never).execute();
  }
  await db.deleteFrom("leads").where("id", "=", leadId).execute();
  await closeDB();
});

describe("exotel config", () => {
  it("denies config writes to non-admins", async () => {
    const res = await api
      .put("/api/v1/telephony")
      .set(auth(salesToken))
      .send({ provider: "EXOTEL", accountSid: "acme1", apiKey: API_KEY, authToken: API_TOKEN, fromNumber: MAIN_EXOPHONE });
    expect(res.status).toBe(403);
  });

  it("rejects a subdomain outside the Exotel allowlist", async () => {
    const res = await api
      .put("/api/v1/telephony")
      .set(auth(adminToken))
      .send({
        provider: "EXOTEL",
        accountSid: "acme1",
        apiKey: API_KEY,
        authToken: API_TOKEN,
        fromNumber: MAIN_EXOPHONE,
        subdomain: "evil.example.com",
      });
    expect(res.status).toBe(400);
  });

  it("saves Exotel creds: PENDING, webhook token minted, secrets never echoed", async () => {
    const res = await api
      .put("/api/v1/telephony")
      .set(auth(adminToken))
      .send({
        provider: "EXOTEL",
        accountSid: "acme1",
        apiKey: API_KEY,
        authToken: API_TOKEN,
        fromNumber: MAIN_EXOPHONE,
        subdomain: "api.in.exotel.com",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("EXOTEL");
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.api_key_set).toBe(true);
    expect(res.body.data.webhook_token).toMatch(/^[0-9a-f]{48}$/);
    const serialized = JSON.stringify(res.body.data);
    expect(serialized).not.toContain(API_TOKEN);
    expect(serialized).not.toContain(API_KEY);
  });

  it("re-saving preserves the webhook token (URLs are pasted into the Exotel flow)", async () => {
    const before = await api.get("/api/v1/telephony").set(auth(adminToken));
    const token = before.body.data.webhook_token as string;

    const res = await api
      .put("/api/v1/telephony")
      .set(auth(adminToken))
      .send({ provider: "EXOTEL", fromNumber: MAIN_EXOPHONE });
    expect(res.status).toBe(200);
    expect(res.body.data.webhook_token).toBe(token);
  });

  it("validate flips to ACTIVE (simulated) and auto-creates the MAIN pool number", async () => {
    const res = await api.post("/api/v1/telephony/validate").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");

    const main = await db
      .selectFrom("telephony_numbers")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("phone", "=", MAIN_EXOPHONE)
      .executeTakeFirst();
    expect(main?.kind).toBe("MAIN");
  });

  it("keeps credentials write-only: no reveal endpoint, never in the config", async () => {
    const reveal = await api.get("/api/v1/telephony/secrets").set(auth(adminToken));
    expect(reveal.status).toBe(404);
    const cfg = await api.get("/api/v1/telephony").set(auth(adminToken));
    expect(cfg.status).toBe(200);
    const body = JSON.stringify(cfg.body);
    expect(body).not.toContain(API_KEY);
    expect(body).not.toContain(API_TOKEN);
  });
});

describe("exophone pool", () => {
  it("denies number writes to non-admins", async () => {
    const res = await api
      .post("/api/v1/telephony/numbers")
      .set(auth(salesToken))
      .send({ phone: AGENT_EXOPHONE, kind: "AGENT", assignedUserId: salesUserId });
    expect(res.status).toBe(403);
  });

  it("adds an AGENT number assigned to a real agent", async () => {
    const res = await api
      .post("/api/v1/telephony/numbers")
      .set(auth(adminToken))
      .send({ phone: AGENT_EXOPHONE, label: "Asha's line", kind: "AGENT", assignedUserId: salesUserId });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("AGENT");
    expect(res.body.data.assigned_user_id).toBe(salesUserId);
  });

  it("rejects a duplicate ExoPhone", async () => {
    const res = await api
      .post("/api/v1/telephony/numbers")
      .set(auth(adminToken))
      .send({ phone: AGENT_EXOPHONE, kind: "MAIN" });
    expect(res.status).toBe(400);
  });

  it("rejects an AGENT number without an assignee", async () => {
    const res = await api
      .post("/api/v1/telephony/numbers")
      .set(auth(adminToken))
      .send({ phone: "+918047110003", kind: "AGENT" });
    expect(res.status).toBe(400);
  });

  it("lists numbers for any authenticated user", async () => {
    const res = await api.get("/api/v1/telephony/numbers").set(auth(salesToken));
    expect(res.status).toBe(200);
    const phones = res.body.data.map((n: { phone: string }) => n.phone);
    expect(phones).toContain(MAIN_EXOPHONE);
    expect(phones).toContain(AGENT_EXOPHONE);
  });
});

describe("availability toggle", () => {
  it("flips the agent's own availability", async () => {
    const off = await api
      .post("/api/v1/telephony/availability")
      .set(auth(salesToken))
      .send({ available: false });
    expect(off.status).toBe(200);
    expect(off.body.data.available_for_calls).toBe(false);

    const row = await db
      .selectFrom("users")
      .select(["available_for_calls"])
      .where("id", "=", salesUserId)
      .executeTakeFirstOrThrow();
    expect(row.available_for_calls).toBe(false);

    const on = await api
      .post("/api/v1/telephony/availability")
      .set(auth(salesToken))
      .send({ available: true });
    expect(on.body.data.available_for_calls).toBe(true);
  });
});

describe("exotel click-to-call", () => {
  it("blocks calls outside the TRAI window with a clear message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IST_NIGHT);
    try {
      const res = await api
        .post("/api/v1/telephony/call")
        .set(auth(adminToken))
        .send({ leadId, agentPhone });
      expect(res.status).toBe(400);
      expect(String(res.body.message ?? "")).toMatch(/TRAI/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("places a simulated call from the main ExoPhone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IST_AFTERNOON);
    try {
      const res = await api
        .post("/api/v1/telephony/call")
        .set(auth(adminToken))
        .send({ leadId, agentPhone });
      expect(res.status).toBe(201);
      expect(res.body.data.simulated).toBe(true);
      expect(res.body.data.provider).toBe("exotel");
      expect(res.body.data.external_call_id).toMatch(/^sim_/);
      // Admin has no dedicated number, so CallerId falls back to the main one.
      expect(res.body.data.from_number).toBe(MAIN_EXOPHONE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the agent's dedicated ExoPhone as CallerId when assigned", async () => {
    // The sales agent needs a linked phone for click-to-call.
    await db
      .updateTable("users")
      .set({ phone: agentPhone })
      .where("id", "=", salesUserId)
      .execute();

    vi.useFakeTimers();
    vi.setSystemTime(IST_AFTERNOON);
    try {
      const res = await api
        .post("/api/v1/telephony/call")
        .set(auth(salesToken))
        .send({ leadId });
      expect(res.status).toBe(201);
      expect(res.body.data.from_number).toBe(AGENT_EXOPHONE);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("manual call logging", () => {
  it("logs a personal-SIM call with notes and side effects", async () => {
    const res = await api
      .post("/api/v1/telephony/calls/manual")
      .set(auth(salesToken))
      .send({ leadId, durationSec: 300, outcome: "CONNECTED", notes: `${marker} pitched the Pro plan` });
    expect(res.status).toBe(201);
    expect(res.body.data.provider).toBe("manual");
    expect(res.body.data.outcome).toBe("CONNECTED");
    expect(res.body.data.summary).toContain("pitched the Pro plan");

    const activity = await db
      .selectFrom("activities")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("lead_id", "=", leadId)
      .where("type", "=", "CALL")
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    expect(activity?.notes).toContain("pitched the Pro plan");

    const lead = await db
      .selectFrom("leads")
      .select(["last_activity_at"])
      .where("id", "=", leadId)
      .executeTakeFirstOrThrow();
    expect(lead.last_activity_at).not.toBeNull();
  });

  it("rejects an unknown outcome", async () => {
    const res = await api
      .post("/api/v1/telephony/calls/manual")
      .set(auth(salesToken))
      .send({ leadId, outcome: "WON_THE_LOTTERY" });
    expect(res.status).toBe(400);
  });
});

describe("recording endpoint", () => {
  it("returns pending for an unmirrored provider URL and a URL for a mirrored key", async () => {
    const now = new Date();
    const pendingId = ulid();
    const mirroredId = ulid();
    await db
      .insertInto("voice_calls")
      .values([
        {
          id: pendingId,
          tenant_id: tenantId,
          lead_id: leadId,
          provider: "exotel",
          direction: "INBOUND",
          call_status: "completed",
          recording_url: "https://recordings.exotel.com/x.mp3",
          created_at: now,
          updated_at: now,
        },
        {
          id: mirroredId,
          tenant_id: tenantId,
          lead_id: leadId,
          provider: "exotel",
          direction: "INBOUND",
          call_status: "completed",
          recording_url: `telephony/${tenantId}/rec-${marker}.mp3`,
          created_at: now,
          updated_at: now,
        },
      ])
      .execute();

    const pending = await api
      .get(`/api/v1/telephony/calls/${pendingId}/recording`)
      .set(auth(adminToken));
    expect(pending.status).toBe(200);
    expect(pending.body.data.pending).toBe(true);
    expect(pending.body.data.url).toBeNull();

    const mirrored = await api
      .get(`/api/v1/telephony/calls/${mirroredId}/recording`)
      .set(auth(adminToken));
    expect(mirrored.status).toBe(200);
    expect(mirrored.body.data.url).toBeTruthy();
  });
});
