import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let esAdminToken: string;
let tenantId: string;
// Runs against the seeded `northwind` tenant, snapshot/restore its WhatsApp config so
// the test run never wipes a tenant's saved connection.
let savedConfig: Record<string, unknown> | null = null;

const EXCHANGE = "/api/v1/whatsapp/config/embedded-signup/exchange";
const WABA_ID = "wa-test-111";

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  savedConfig =
    ((await db
      .selectFrom("tenant_whatsapp")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
});

afterAll(async () => {
  await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
  if (savedConfig) {
    await db.insertInto("tenant_whatsapp").values(savedConfig as never).execute();
  }
  await closeDB();
});

describe("whatsapp embedded signup", () => {
  it("reports not-configured initially", async () => {
    const res = await api.get("/api/v1/whatsapp/config").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.access_token_set).toBe(false);
  });

  it("denies connecting to non-admins", async () => {
    const res = await api
      .post(EXCHANGE)
      .set(auth(salesToken))
      .send({ code: "AUTHCODE", wabaId: WABA_ID, phoneNumberId: "222" });
    expect(res.status).toBe(403);
  });

  it("requires code, wabaId and phoneNumberId", async () => {
    const res = await api.post(EXCHANGE).set(auth(adminToken)).send({ code: "AUTHCODE" });
    expect(res.status).toBe(400);
  });

  it("connects via embedded signup (simulated) and goes ACTIVE", async () => {
    const res = await api
      .post(EXCHANGE)
      .set(auth(adminToken))
      .send({ code: "AUTHCODE", wabaId: WABA_ID, phoneNumberId: "222", businessId: "333" });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.configured).toBe(true);
    expect(d.status).toBe("ACTIVE");
    expect(d.connect_method).toBe("EMBEDDED");
    expect(d.waba_id).toBe(WABA_ID);
    expect(d.phone_number_id).toBe("222");
    expect(d.business_id).toBe("333");
    expect(d.access_token_set).toBe(true);
    expect(d.display_phone_number).toBeTruthy();
  });

  it("never returns the raw token in the masked config", async () => {
    const res = await api.get("/api/v1/whatsapp/config").set(auth(adminToken));
    expect(JSON.stringify(res.body.data)).not.toContain("sim_token");
    expect(JSON.stringify(res.body.data)).not.toContain("access_token_encrypted");
  });

  it("re-syncs the connection via validate (simulated) and stays ACTIVE", async () => {
    const res = await api.post("/api/v1/whatsapp/config/validate").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.display_phone_number).toBeTruthy();
  });

  it("rejects a WABA already connected to another workspace", async () => {
    // northwind owns WABA_ID; a different tenant's admin cannot claim it.
    const res = await api
      .post(EXCHANGE)
      .set(auth(esAdminToken))
      .send({ code: "AUTHCODE", wabaId: WABA_ID, phoneNumberId: "999" });
    expect(res.status).toBe(409);
  });

  it("disconnects (removes) the config", async () => {
    const res = await api.delete("/api/v1/whatsapp/config").set(auth(adminToken));
    expect(res.status).toBe(200);
    const after = await api.get("/api/v1/whatsapp/config").set(auth(adminToken));
    expect(after.body.data.configured).toBe(false);
  });
});
