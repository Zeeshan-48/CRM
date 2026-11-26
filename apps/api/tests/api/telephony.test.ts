import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { sweepStaleCalls } from "../../src/jobs/calls-poll.job";
import { api, auth, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let tenantId: string;
let leadId: string;
// Runs against the seeded `northwind` tenant, snapshot/restore its telephony config so
// the test run never wipes a tenant's saved Twilio credentials.
let savedConfig: Record<string, unknown> | null = null;

const marker = `TelephonyTest-${Date.now()}`;
const leadPhone = "+14155550100";
const agentPhone = "+14155550111";
const createdCallIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  savedConfig =
    ((await db
      .selectFrom("tenant_telephony")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_telephony").where("tenant_id", "=", tenantId).execute();

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
  await db.deleteFrom("voice_calls").where("tenant_id", "=", tenantId).where("provider", "=", "twilio").execute();
  if (createdCallIds.length > 0) {
    await db.deleteFrom("voice_calls").where("id", "in", createdCallIds).execute();
  }
  await db.deleteFrom("tenant_telephony").where("tenant_id", "=", tenantId).execute();
  if (savedConfig) {
    await db.insertInto("tenant_telephony").values(savedConfig as never).execute();
  }
  await db.deleteFrom("leads").where("id", "=", leadId).execute();
  await closeDB();
});

describe("telephony config", () => {
  it("reports not-configured initially", async () => {
    const res = await api.get("/api/v1/telephony").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
  });

  it("denies saving config to non-admins", async () => {
    const res = await api
      .put("/api/v1/telephony")
      .set(auth(salesToken))
      .send({ accountSid: "ACxxxx", authToken: "tok", fromNumber: "+14155550000" });
    expect(res.status).toBe(403);
  });

  it("rejects an unparseable from number", async () => {
    // A bare 10-digit number is now normalized to E.164; only genuinely
    // unparseable input (too short to be a real number) is rejected.
    const res = await api
      .put("/api/v1/telephony")
      .set(auth(adminToken))
      .send({ accountSid: "ACxxxx", authToken: "tok", fromNumber: "12" });
    expect(res.status).toBe(400);
  });

  it("saves BYO credentials (PENDING, token never returned)", async () => {
    const res = await api
      .put("/api/v1/telephony")
      .set(auth(adminToken))
      .send({
        accountSid: "AC0123456789abcdef",
        authToken: "super-secret-token",
        fromNumber: "+14155550000",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.account_sid).toContain("...");
    expect(JSON.stringify(res.body.data)).not.toContain("super-secret-token");
  });

  it("validates the credentials to ACTIVE (simulated under test)", async () => {
    const res = await api.post("/api/v1/telephony/validate").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");
  });
});

describe("click-to-call", () => {
  it("places a bridge call and records it", async () => {
    const res = await api
      .post("/api/v1/telephony/call")
      .set(auth(adminToken))
      .send({ leadId, agentPhone });
    expect(res.status).toBe(201);
    expect(res.body.data.simulated).toBe(true);
    expect(res.body.data.to_number).toBe(leadPhone);
    expect(res.body.data.provider).toBe("twilio");

    const row = await db
      .selectFrom("voice_calls")
      .selectAll()
      .where("id", "=", res.body.data.id)
      .executeTakeFirst();
    expect(row?.call_status).toBeTruthy();
    expect(row?.twilio_call_sid).toBeTruthy();
  });

  it("rejects an unparseable agent number", async () => {
    const res = await api
      .post("/api/v1/telephony/call")
      .set(auth(adminToken))
      .send({ leadId, agentPhone: "12" });
    expect(res.status).toBe(400);
  });

  it("normalizes a bare 10-digit agent number to E.164 and places the call", async () => {
    const res = await api
      .post("/api/v1/telephony/call")
      .set(auth(adminToken))
      .send({ leadId, agentPhone: "98765 43210" });
    expect(res.status).toBe(201);
    expect(res.body.data.simulated).toBe(true);
  });

  it("requires a lead or contact", async () => {
    const res = await api
      .post("/api/v1/telephony/call")
      .set(auth(adminToken))
      .send({ agentPhone });
    expect(res.status).toBe(400);
  });

  it("lists recent calls", async () => {
    const res = await api.get("/api/v1/telephony/calls").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { to_number: string }) => c.to_number === leadPhone)).toBe(true);
  });
});

describe("call state sync & stale call reconciliation", () => {
  it("transitions queued -> in-progress -> completed and rejects invalid or terminal downgrades", async () => {
    const admin = await db
      .selectFrom("users")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("email", "=", NW_ADMIN.email)
      .executeTakeFirstOrThrow();

    const callId = ulid();
    createdCallIds.push(callId);
    const now = new Date();
    await db
      .insertInto("voice_calls")
      .values({
        id: callId,
        tenant_id: tenantId,
        lead_id: leadId,
        agent_user_id: admin.id,
        provider: "plivo",
        direction: "OUTBOUND",
        call_status: "queued",
        from_number: "+918065395632",
        to_number: leadPhone,
        duration_sec: 0,
        created_at: now,
        updated_at: now,
      })
      .execute();

    // 1. Rejects unsupported status
    const badRes = await api
      .patch(`/api/v1/telephony/calls/${callId}/state`)
      .set(auth(adminToken))
      .send({ status: "bogus" });
    expect(badRes.status).toBe(400);

    // 2. Non-owner agent cannot update another user's active call
    const forbiddenRes = await api
      .patch(`/api/v1/telephony/calls/${callId}/state`)
      .set(auth(salesToken))
      .send({ status: "canceled" });
    expect(forbiddenRes.status).toBe(403);

    // 3. Moves queued -> in-progress
    const liveRes = await api
      .patch(`/api/v1/telephony/calls/${callId}/state`)
      .set(auth(adminToken))
      .send({ status: "in-progress" });
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.data.call_status).toBe("in-progress");

    // 4. Moves in-progress -> completed with duration
    const doneRes = await api
      .patch(`/api/v1/telephony/calls/${callId}/state`)
      .set(auth(adminToken))
      .send({ status: "completed", durationSec: 42 });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.data.call_status).toBe("completed");
    expect(doneRes.body.data.duration_sec).toBe(42);

    // 5. Never downgrades an already terminal completed call back to queued/failed
    const downgradeRes = await api
      .patch(`/api/v1/telephony/calls/${callId}/state`)
      .set(auth(adminToken))
      .send({ status: "failed", durationSec: 0 });
    expect(downgradeRes.status).toBe(200);
    expect(downgradeRes.body.data.call_status).toBe("completed");
    expect(downgradeRes.body.data.duration_sec).toBe(42);
  });

  it("sweeps stale queued calls to failed and stuck recorded calls to completed", async () => {
    const oldQueuedId = ulid();
    const stuckWithAudioId = ulid();
    const freshQueuedId = ulid();
    createdCallIds.push(oldQueuedId, stuckWithAudioId, freshQueuedId);

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);

    await db
      .insertInto("voice_calls")
      .values([
        {
          id: oldQueuedId,
          tenant_id: tenantId,
          lead_id: leadId,
          provider: "plivo",
          direction: "OUTBOUND",
          call_status: "queued",
          from_number: "+918065395632",
          to_number: leadPhone,
          duration_sec: 0,
          created_at: thirtyMinsAgo,
          updated_at: thirtyMinsAgo,
        },
        {
          id: stuckWithAudioId,
          tenant_id: tenantId,
          lead_id: leadId,
          provider: "plivo",
          direction: "OUTBOUND",
          call_status: "in-progress",
          recording_url: "telephony/sample/rec.mp3",
          from_number: "+918065395632",
          to_number: leadPhone,
          duration_sec: 0,
          created_at: thirtyMinsAgo,
          updated_at: thirtyMinsAgo,
        },
        {
          id: freshQueuedId,
          tenant_id: tenantId,
          lead_id: leadId,
          provider: "plivo",
          direction: "OUTBOUND",
          call_status: "queued",
          from_number: "+918065395632",
          to_number: leadPhone,
          duration_sec: 0,
          created_at: twoMinsAgo,
          updated_at: twoMinsAgo,
        },
      ])
      .execute();

    await sweepStaleCalls();

    const rows = await db
      .selectFrom("voice_calls")
      .select(["id", "call_status", "call_error", "completed_at"])
      .where("id", "in", [oldQueuedId, stuckWithAudioId, freshQueuedId])
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(oldQueuedId)?.call_status).toBe("failed");
    expect(byId.get(oldQueuedId)?.call_error).toContain("timeout");
    expect(byId.get(oldQueuedId)?.completed_at).toBeTruthy();

    expect(byId.get(stuckWithAudioId)?.call_status).toBe("completed");
    expect(byId.get(stuckWithAudioId)?.completed_at).toBeTruthy();

    expect(byId.get(freshQueuedId)?.call_status).toBe("queued");
  });

  it("enforces Plivo webhook security (unknown token 404, forged sig 401, safe XML on valid request)", async () => {
    const forgedSig = await api
      .post("/api/v1/telephony/webhooks/plivo/answer")
      .set("X-Plivo-Signature-V2", "forged_signature==")
      .set("X-Plivo-Signature-V2-Nonce", "12345")
      .send({ To: "+917903719233" });
    expect(forgedSig.status).toBe(401);

    const badToken = await api
      .post("/api/v1/telephony/webhooks/plivo/totally-bogus-token-value/answer")
      .send({ To: "+917903719233" });
    expect(badToken.status).toBe(404);

    // Invalid leadPhone / XML injection attempt returns clean empty <Response /> rather than injecting tags
    const injected = await api
      .post("/api/v1/telephony/webhooks/plivo/answer")
      .send({ To: "evil</Number><Speak>hacked</Speak>" });
    expect(injected.status).toBe(200);
    expect(injected.text).not.toContain("<Speak>hacked");
    expect(injected.text).toContain("<Response");
  });
});
