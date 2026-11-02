import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, ACME_ADMIN, login } from "../helpers";

// Inbound lead-capture endpoints (public /api/v1/ingest). Authenticated by a
// workspace API key or the per-tenant token URL, NOT the tenant JWT.

let adminToken: string;
let esAdminToken: string;
let tenantId: string;
let rawKey: string;
let apiKeyId: string;
let ingestToken: string;

// Unique suffix so the dedup/create assertions never collide with seed data or
// a prior run. (Math.random is fine in tests; only workflow scripts forbid it.)
const uniq = Math.random().toString(36).slice(2, 10);
const email = (label: string) => `ingest.${label}.${uniq}@example.com`;

const createdLeadIds: string[] = [];

const post = (path: string, body: unknown, key?: string) => {
  const req = api.post(path).send(body);
  return key ? req.set("Authorization", `Bearer ${key}`) : req;
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
  const me = await api.get("/api/v1/tenant/me").set(auth(adminToken));
  tenantId = me.body.data.tenant.id as string;

  const key = await api
    .post("/api/v1/integrations/api-keys")
    .set(auth(adminToken))
    .send({ name: "Ingest QA key" });
  rawKey = key.body.data.key as string;
  apiKeyId = key.body.data.id as string;

  const settings = await api.get("/api/v1/integrations/ingest").set(auth(adminToken));
  ingestToken = settings.body.data.token as string;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300)); // let fire-and-forget audits land
  for (const id of createdLeadIds) {
    await db.deleteFrom("audit_logs").where("entity_id", "=", id).execute();
    await db.deleteFrom("leads").where("id", "=", id).execute();
  }
  await db.deleteFrom("lead_ingest_events").where("tenant_id", "=", tenantId).where("source", "in", ["Ingest QA key", "Web form"]).execute();
  await db.deleteFrom("api_keys").where("id", "=", apiKeyId).execute();
  await db.deleteFrom("audit_logs").where("entity_id", "=", apiKeyId).execute();
  await closeDB();
});

describe("api key auth", () => {
  it("rejects a missing key with 401", async () => {
    const res = await post("/api/v1/ingest/leads", { email: email("noauth") });
    expect(res.status).toBe(401);
  });

  it("rejects a bogus key with 401", async () => {
    const res = await post("/api/v1/ingest/leads", { email: email("bogus") }, "crm_sk_nope");
    expect(res.status).toBe(401);
  });
});

describe("generic ingest", () => {
  it("creates a lead from a minimal payload and returns its id", async () => {
    const res = await post("/api/v1/ingest/leads", { name: "Ada Lovelace", email: email("create") }, rawKey);
    expect(res.status).toBe(201);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.deduped).toBe(false);
    const leadId = res.body.data.leadId as string;
    expect(leadId).toBeTruthy();
    createdLeadIds.push(leadId);

    const lead = await db.selectFrom("leads").selectAll().where("id", "=", leadId).executeTakeFirst();
    expect(lead?.tenant_id).toBe(tenantId);
    expect(lead?.email?.toLowerCase()).toBe(email("create"));
    expect(lead?.external_source).toBe("Ingest QA key");
    expect(lead?.scored_at).toBeTruthy(); // scoring ran via leadsService.create
  });

  it("maps first/last name, utm_campaign and custom fields", async () => {
    const res = await post(
      "/api/v1/ingest/leads",
      {
        first_name: "Grace",
        last_name: "Hopper",
        email: email("map"),
        utm_campaign: "spring-launch",
        favourite_language: "COBOL",
      },
      rawKey
    );
    expect(res.status).toBe(201);
    const leadId = res.body.data.leadId as string;
    createdLeadIds.push(leadId);
    const lead = await db.selectFrom("leads").selectAll().where("id", "=", leadId).executeTakeFirst();
    expect(lead?.name).toBe("Grace Hopper");
    expect(lead?.campaign).toBe("spring-launch");
    expect(lead?.notes ?? "").toContain("favourite_language: COBOL");
  });

  it("requires at least name, email or phone", async () => {
    const res = await post("/api/v1/ingest/leads", { city: "Pune" }, rawKey);
    expect(res.status).toBe(400);
  });
});

describe("dedup + idempotency", () => {
  it("updates the existing lead instead of duplicating on the same email", async () => {
    const addr = email("dedup");
    const first = await post("/api/v1/ingest/leads", { name: "Dup One", email: addr }, rawKey);
    const leadId = first.body.data.leadId as string;
    createdLeadIds.push(leadId);

    const second = await post("/api/v1/ingest/leads", { email: addr, city: "Mumbai" }, rawKey);
    expect(second.status).toBe(201);
    expect(second.body.data.deduped).toBe(true);
    expect(second.body.data.leadId).toBe(leadId);

    const rows = await db
      .selectFrom("leads")
      .select(["id", "city"])
      .where("tenant_id", "=", tenantId)
      .where("email", "ilike", addr)
      .execute();
    expect(rows.length).toBe(1);
    expect(rows[0].city).toBe("Mumbai"); // empty field enriched
  });

  it("treats a repeated external_id as a no-op", async () => {
    const addr = email("idem");
    const body = { name: "Idem", email: addr, external_id: `ext-${uniq}` };
    const first = await post("/api/v1/ingest/leads", body, rawKey);
    const leadId = first.body.data.leadId as string;
    createdLeadIds.push(leadId);

    const again = await post("/api/v1/ingest/leads", body, rawKey);
    expect(again.status).toBe(201);
    expect(again.body.data.leadId).toBe(leadId);

    const count = await db
      .selectFrom("leads")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("tenant_id", "=", tenantId)
      .where("email", "ilike", addr)
      .executeTakeFirst();
    expect(Number(count?.n)).toBe(1);
  });
});

describe("spam honeypot", () => {
  it("silently accepts a filled honeypot and creates no lead", async () => {
    const addr = email("spam");
    const res = await post("/api/v1/ingest/leads", { email: addr, _gotcha: "i am a bot" }, rawKey);
    expect(res.status).toBe(201);
    expect(res.body.data.spam).toBe(true);
    expect(res.body.data.leadId).toBeNull();

    const row = await db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("email", "ilike", addr)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});

describe("token URL variant", () => {
  it("creates a lead via the per-tenant token URL", async () => {
    const res = await post(`/api/v1/ingest/leads/t/${ingestToken}`, { name: "Token Lead", email: email("token") });
    expect(res.status).toBe(201);
    const leadId = res.body.data.leadId as string;
    createdLeadIds.push(leadId);
    const lead = await db.selectFrom("leads").selectAll().where("id", "=", leadId).executeTakeFirst();
    expect(lead?.external_source).toBe("Web form");
  });

  it("rejects a wrong token with 401", async () => {
    const res = await post("/api/v1/ingest/leads/t/lit_wrongtoken", { email: email("badtoken") });
    expect(res.status).toBe(401);
  });
});

describe("tenant isolation", () => {
  it("does not leak another workspace's ingest token", async () => {
    const mine = await api.get("/api/v1/integrations/ingest").set(auth(adminToken));
    const theirs = await api.get("/api/v1/integrations/ingest").set(auth(esAdminToken));
    expect(mine.body.data.token).not.toBe(theirs.body.data.token);
  });
});
