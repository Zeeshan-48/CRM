import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_FINANCE, login } from "../helpers";

const RUN = ulid().toLowerCase();
const TAG = `vitest-tag-${RUN}`;
const TPL_KEY = `vitest-tpl-${RUN}`;
const LIST_TPL_KEY = `vitest-tpl-list-${RUN}`;

let adminToken: string;
let esAdminToken: string;
let financeToken: string;
let tenantId: string;
const leadIds: string[] = [];
let taggedLeadA: string;
let taggedLeadB: string;
let plainLead: string;

const insertLead = async (name: string, tags: string[]): Promise<string> => {
  const now = new Date();
  const lead = await db
    .insertInto("leads")
    .values({
      id: ulid(),
      tenant_id: tenantId,
      name,
      email: `wa.${ulid().toLowerCase()}@example.com`,
      phone: "",
      city: "Pune",
      country: "India",
      source: "WhatsApp",
      campaign: "",
      status: "NEW",
      owner_id: null,
      tags: JSON.stringify(tags),
      notes: "",
      budget: false,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  leadIds.push(lead.id);
  return lead.id;
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);

  const tenant = await db
    .selectFrom("tenants")
    .select("id")
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;

  taggedLeadA = await insertLead(`WaTestOne Lead ${RUN}`, [TAG]);
  taggedLeadB = await insertLead(`WaTestTwo Lead ${RUN}`, [TAG]);
  plainLead = await insertLead(`WaTestThree Lead ${RUN}`, []);
});

afterAll(async () => {
  if (leadIds.length) {
    await db.deleteFrom("messages").where("lead_id", "in", leadIds).execute();
    await db.deleteFrom("conversations").where("lead_id", "in", leadIds).execute();
    await db.deleteFrom("leads").where("id", "in", leadIds).execute();
  }
  await db
    .deleteFrom("campaigns")
    .where("tenant_id", "=", tenantId)
    .where("name", "=", `WhatsApp Broadcast - ${TPL_KEY}`)
    .execute();
  await db
    .deleteFrom("whatsapp_templates")
    .where("tenant_id", "=", tenantId)
    .where("key", "in", [TPL_KEY, LIST_TPL_KEY])
    .execute();
  await closeDB();
});

describe("templates", () => {
  it("lists the workspace's templates", async () => {
    // Creates its own row rather than expecting a seeded "welcome": WhatsApp
    // templates have to be approved by Meta, so the seed deliberately ships none
    // and a test that assumed one only ever proved the seed's shape.
    const created = await api
      .post("/api/v1/whatsapp/templates")
      .set(auth(adminToken))
      .send({ key: LIST_TPL_KEY, body: `Listing check ${RUN}` });
    expect(created.status).toBe(201);

    const res = await api.get("/api/v1/whatsapp/templates").set(auth(adminToken));
    expect(res.status).toBe(200);
    const keys = res.body.data.map((t: { key: string }) => t.key);
    expect(keys).toContain(LIST_TPL_KEY);
  });

  it("creates a template and enforces tenant-unique keys", async () => {
    const created = await api
      .post("/api/v1/whatsapp/templates")
      .set(auth(adminToken))
      .send({ key: TPL_KEY, body: `Hello {name}, offer ${RUN}` });
    expect(created.status).toBe(201);
    expect(created.body.data.key).toBe(TPL_KEY);
    expect(created.body.data.category).toBe("MARKETING");
    // A template drafted in the CRM is not approved by Meta yet.
    expect(created.body.data.status).toBe("PENDING");

    const dup = await api
      .post("/api/v1/whatsapp/templates")
      .set(auth(adminToken))
      .send({ key: TPL_KEY, body: "another body" });
    expect(dup.status).toBe(409);
  });

  it("requires key and body, validates category", async () => {
    const missing = await api
      .post("/api/v1/whatsapp/templates")
      .set(auth(adminToken))
      .send({ key: `x-${RUN}` });
    expect(missing.status).toBe(400);

    const badCategory = await api
      .post("/api/v1/whatsapp/templates")
      .set(auth(adminToken))
      .send({ key: `y-${RUN}`, body: "hi", category: "SPAM" });
    expect(badCategory.status).toBe(400);
  });

  it("FINANCE role is blocked by RBAC", async () => {
    const res = await api.get("/api/v1/whatsapp/templates").set(auth(financeToken));
    expect(res.status).toBe(403);
  });
});

describe("POST /whatsapp/send", () => {
  it("sends a template message with {name} resolved to the lead first name", async () => {
    const res = await api
      .post("/api/v1/whatsapp/send")
      .set(auth(adminToken))
      .send({ leadId: taggedLeadA, templateKey: "welcome" });
    expect(res.status).toBe(201);
    const msg = res.body.data;
    expect(msg.channel).toBe("WHATSAPP");
    expect(msg.direction).toBe("OUTBOUND");
    expect(msg.lead_id).toBe(taggedLeadA);
    expect(msg.body).toContain("WaTestOne");
    expect(msg.body).not.toContain("{name}");
  });

  it("sends a raw body with {name} replaced", async () => {
    const res = await api
      .post("/api/v1/whatsapp/send")
      .set(auth(adminToken))
      .send({ leadId: taggedLeadB, body: "Hi {name}, custom note" });
    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe("Hi WaTestTwo, custom note");
  });

  it("requires body or templateKey", async () => {
    const res = await api
      .post("/api/v1/whatsapp/send")
      .set(auth(adminToken))
      .send({ leadId: taggedLeadA });
    expect(res.status).toBe(400);
  });

  it("cross-tenant lead returns 404", async () => {
    const res = await api
      .post("/api/v1/whatsapp/send")
      .set(auth(esAdminToken))
      .send({ leadId: taggedLeadA, templateKey: "welcome" });
    expect(res.status).toBe(404);
  });
});

describe("POST /whatsapp/campaigns", () => {
  it("broadcasts the template to leads carrying the audience tag", async () => {
    const res = await api
      .post("/api/v1/whatsapp/campaigns")
      .set(auth(adminToken))
      .send({ templateKey: TPL_KEY, audienceTag: TAG });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ sent: 2, audienceTag: TAG });

    const campaign = await db
      .selectFrom("campaigns")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("name", "=", `WhatsApp Broadcast - ${TPL_KEY}`)
      .executeTakeFirstOrThrow();
    expect(campaign.channel).toBe("WhatsApp");
    expect(campaign.status).toBe("COMPLETED");
    expect(Number(campaign.leads_generated)).toBe(0);
    expect(Number(campaign.cost)).toBe(0);
    expect(Number(campaign.revenue)).toBe(0);

    for (const [id, first] of [
      [taggedLeadA, "WaTestOne"],
      [taggedLeadB, "WaTestTwo"],
    ] as const) {
      const msg = await db
        .selectFrom("messages")
        .selectAll()
        .where("lead_id", "=", id)
        .where("body", "like", `%offer ${RUN}%`)
        .executeTakeFirst();
      expect(msg).toBeTruthy();
      expect(msg?.body).toContain(`Hello ${first}`);
    }

    const untouched = await db
      .selectFrom("messages")
      .selectAll()
      .where("lead_id", "=", plainLead)
      .where("body", "like", `%offer ${RUN}%`)
      .executeTakeFirst();
    expect(untouched).toBeUndefined();
  });

  it("requires templateKey and audienceTag", async () => {
    const res = await api
      .post("/api/v1/whatsapp/campaigns")
      .set(auth(adminToken))
      .send({ templateKey: TPL_KEY });
    expect(res.status).toBe(400);
  });
});

describe("POST /whatsapp/agent/reply", () => {
  it("answers from the knowledge base and infers create_ticket for refunds", async () => {
    const res = await api
      .post("/api/v1/whatsapp/agent/reply")
      .set(auth(adminToken))
      .send({ question: "What is your refund policy?" });
    expect(res.status).toBe(200);
    const { reply, action, sources } = res.body.data;
    expect(action).toBe("create_ticket");
    expect(reply).toContain("Refunds are available");
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources.map((s: { title: string }) => s.title)).toContain("Refund policy");
  });

  it("infers book_demo and logs the exchange when leadId is given", async () => {
    const question = `Can I book a demo session? ${RUN}`;
    const res = await api
      .post("/api/v1/whatsapp/agent/reply")
      .set(auth(adminToken))
      .send({ question, leadId: plainLead });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("book_demo");

    const logged = await db
      .selectFrom("messages")
      .selectAll()
      .where("lead_id", "=", plainLead)
      .where("channel", "=", "WHATSAPP")
      .execute();
    const inbound = logged.find((m) => m.direction === "INBOUND" && m.body === question);
    const outbound = logged.find(
      (m) => m.direction === "OUTBOUND" && m.body === res.body.data.reply
    );
    expect(inbound).toBeTruthy();
    expect(outbound).toBeTruthy();
  });

  it("infers send_pricing for pricing questions", async () => {
    const res = await api
      .post("/api/v1/whatsapp/agent/reply")
      .set(auth(adminToken))
      .send({ question: "What is the pricing?" });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("send_pricing");
  });

  it("falls back politely when nothing matches", async () => {
    const res = await api
      .post("/api/v1/whatsapp/agent/reply")
      .set(auth(adminToken))
      .send({ question: "zzz qqq xyzzy" });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("answer");
    expect(res.body.data.sources).toEqual([]);
    expect(res.body.data.reply.length).toBeGreaterThan(0);
  });

  it("requires a question", async () => {
    const res = await api.post("/api/v1/whatsapp/agent/reply").set(auth(adminToken)).send({});
    expect(res.status).toBe(400);
  });
});
