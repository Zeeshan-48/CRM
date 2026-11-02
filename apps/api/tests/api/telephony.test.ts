import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
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
