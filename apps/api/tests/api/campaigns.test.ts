import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let esAdminToken: string;

const marker = `CampaignTest-${Date.now()}`;
const createdCampaignIds: string[] = [];

const waTemplateKey = `camp-tpl-${Date.now()}`;
let waTemplateId = "";

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  // An APPROVED WhatsApp template the WhatsApp campaign can reference.
  const tenant = await db
    .selectFrom("tenants")
    .select("id")
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  waTemplateId = ulid();
  const now = new Date();
  await db
    .insertInto("whatsapp_templates")
    .values({
      id: waTemplateId,
      tenant_id: tenant.id,
      key: waTemplateKey,
      body: "Hi {name}, a quick update from our team.",
      category: "MARKETING",
      status: "APPROVED",
      created_at: now,
      updated_at: now,
    })
    .execute();
});

afterAll(async () => {
  for (const id of createdCampaignIds) {
    await db.deleteFrom("campaigns").where("id", "=", id).execute();
  }
  if (waTemplateId) {
    await db.deleteFrom("whatsapp_templates").where("id", "=", waTemplateId).execute();
  }
  await closeDB();
});

describe("campaigns list", () => {
  it("returns campaigns with computed roi/roas plus totals", async () => {
    const res = await api.get("/api/v1/campaigns").set(auth(adminToken));
    expect(res.status).toBe(200);
    const { campaigns, totals } = res.body.data;
    expect(campaigns.length).toBeGreaterThanOrEqual(3);

    const seeded = campaigns.find((c: { name: string }) => c.name === "May Intake - Google");
    expect(seeded).toBeTruthy();
    // cost 120000, revenue 540000 -> roi 350, roas 4.5
    expect(seeded.roi).toBe(350);
    expect(seeded.roas).toBe(4.5);

    expect(totals.cost).toBeGreaterThanOrEqual(195000);
    expect(totals.revenue).toBeGreaterThanOrEqual(940000);
    expect(totals.leadsGenerated).toBeGreaterThanOrEqual(1);
    expect(typeof totals.roi).toBe("number");
    expect(totals.roi).toBe(
      Math.round(((totals.revenue - totals.cost) / totals.cost) * 100)
    );
  });
});

describe("campaign create", () => {
  it("creates a campaign and computes roi", async () => {
    const res = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({
        name: `${marker} Paid`,
        channel: "Google",
        cost: 1000,
        revenue: 3000,
        startAt: "2026-06-01T00:00:00.000Z",
      });
    expect(res.status).toBe(201);
    createdCampaignIds.push(res.body.data.id);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.roi).toBe(200);
    expect(res.body.data.roas).toBe(3);
    expect(res.body.data.start_at).toBeTruthy();
  });

  it("defaults cost/revenue to 0 and roi to 0 when cost is 0", async () => {
    const res = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({ name: `${marker} Organic`, channel: "Email" });
    expect(res.status).toBe(201);
    createdCampaignIds.push(res.body.data.id);
    expect(res.body.data.cost).toBe(0);
    expect(res.body.data.revenue).toBe(0);
    expect(res.body.data.roi).toBe(0);
  });

  it("requires name and channel", async () => {
    const res = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({ name: `${marker} NoChannel` });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid status", async () => {
    const res = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({ name: `${marker} BadStatus`, channel: "Google", status: "RUNNING" });
    expect(res.status).toBe(400);
  });

  it("requires an approved template for a WhatsApp campaign", async () => {
    const missing = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({ name: `${marker} WA-noTpl`, channel: "WhatsApp", body: "hi" });
    expect(missing.status).toBe(400);

    const bogus = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({ name: `${marker} WA-badTpl`, channel: "WhatsApp", subject: "not-a-real-template" });
    expect(bogus.status).toBe(400);
  });

  it("creates a WhatsApp campaign referencing an approved template", async () => {
    const res = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({
        name: `${marker} WA-ok`,
        channel: "WhatsApp",
        subject: waTemplateKey,
        body: "Hi {name}, a quick update from our team.",
      });
    expect(res.status).toBe(201);
    createdCampaignIds.push(res.body.data.id);
    // The template key is carried in `subject`.
    expect(res.body.data.subject).toBe(waTemplateKey);
  });
});

describe("campaign detail", () => {
  it("fetches a campaign by id with roi", async () => {
    const created = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({ name: `${marker} Detail`, channel: "Facebook", cost: 500, revenue: 1500 });
    createdCampaignIds.push(created.body.data.id);

    const res = await api
      .get(`/api/v1/campaigns/${created.body.data.id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.roi).toBe(200);
  });

  it("cross-tenant fetch returns 404", async () => {
    const created = await api
      .post("/api/v1/campaigns")
      .set(auth(adminToken))
      .send({ name: `${marker} CrossTenant`, channel: "Google" });
    createdCampaignIds.push(created.body.data.id);

    const res = await api
      .get(`/api/v1/campaigns/${created.body.data.id}`)
      .set(auth(esAdminToken));
    expect(res.status).toBe(404);
  });
});

describe("campaigns RBAC", () => {
  it("denies roles without the campaigns module", async () => {
    const res = await api.get("/api/v1/campaigns").set(auth(salesToken));
    expect(res.status).toBe(403);
  });
});
