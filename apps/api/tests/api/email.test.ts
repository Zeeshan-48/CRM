import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let esAdminToken: string;
let nwTenantId: string;
let leadId: string;
let noEmailLeadId: string;

const marker = `EmailTest-${Date.now()}`;
const createdTemplateIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;

  const now = new Date();
  leadId = ulid();
  await db
    .insertInto("leads")
    .values({
      id: leadId,
      tenant_id: nwTenantId,
      name: marker,
      email: `${marker.toLowerCase()}@example.com`,
      created_at: now,
      updated_at: now,
    })
    .execute();

  noEmailLeadId = ulid();
  await db
    .insertInto("leads")
    .values({
      id: noEmailLeadId,
      tenant_id: nwTenantId,
      name: `${marker} NoEmail`,
      email: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
});

afterAll(async () => {
  await db.deleteFrom("messages").where("lead_id", "=", leadId).execute();
  await db.deleteFrom("conversations").where("lead_id", "=", leadId).execute();
  for (const id of createdTemplateIds) {
    await db.deleteFrom("email_templates").where("id", "=", id).execute();
  }
  await db.deleteFrom("leads").where("id", "=", leadId).execute();
  await db.deleteFrom("leads").where("id", "=", noEmailLeadId).execute();
  await closeDB();
});

describe("email templates", () => {
  it("lists templates including the seeded Welcome template", async () => {
    const res = await api.get("/api/v1/email/templates").set(auth(adminToken));
    expect(res.status).toBe(200);
    const welcome = res.body.data.find((t: { name: string }) => t.name === "Welcome");
    expect(welcome).toBeTruthy();
    expect(welcome.subject).toBe("Welcome aboard");
  });

  it("creates a template", async () => {
    const res = await api
      .post("/api/v1/email/templates")
      .set(auth(adminToken))
      .send({
        name: `${marker} Template`,
        subject: "Quick question",
        body: "Hi {name}, do you have 10 minutes this week?",
        category: "SALES",
      });
    expect(res.status).toBe(201);
    createdTemplateIds.push(res.body.data.id);
    expect(res.body.data.name).toBe(`${marker} Template`);
    expect(res.body.data.category).toBe("SALES");

    const list = await api.get("/api/v1/email/templates").set(auth(adminToken));
    const names = list.body.data.map((t: { name: string }) => t.name);
    expect(names).toContain(`${marker} Template`);
  });

  it("requires name and subject", async () => {
    const res = await api
      .post("/api/v1/email/templates")
      .set(auth(adminToken))
      .send({ name: `${marker} Incomplete` });
    expect(res.status).toBe(400);
  });

  it("updates a template", async () => {
    const created = await api
      .post("/api/v1/email/templates")
      .set(auth(adminToken))
      .send({ name: `${marker} Editable`, subject: "Before", body: "Old body", category: "SALES" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    createdTemplateIds.push(id);

    const res = await api
      .put(`/api/v1/email/templates/${id}`)
      .set(auth(adminToken))
      .send({ name: `${marker} Edited`, subject: "After", body: "New body", category: "SUPPORT" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(`${marker} Edited`);
    expect(res.body.data.subject).toBe("After");
    expect(res.body.data.category).toBe("SUPPORT");

    const stored = await db
      .selectFrom("email_templates")
      .select(["subject", "body"])
      .where("id", "=", id)
      .executeTakeFirst();
    expect(stored?.subject).toBe("After");
    expect(stored?.body).toBe("New body");
  });

  it("returns 404 updating a missing template", async () => {
    const res = await api
      .put(`/api/v1/email/templates/${ulid()}`)
      .set(auth(adminToken))
      .send({ name: "x", subject: "y" });
    expect(res.status).toBe(404);
  });

  it("does not update another tenant's template", async () => {
    const created = await api
      .post("/api/v1/email/templates")
      .set(auth(adminToken))
      .send({ name: `${marker} Private`, subject: "Mine" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    createdTemplateIds.push(id);

    const res = await api
      .put(`/api/v1/email/templates/${id}`)
      .set(auth(esAdminToken))
      .send({ name: "hijack", subject: "hijack" });
    expect(res.status).toBe(404);
  });

  it("deletes a template", async () => {
    const created = await api
      .post("/api/v1/email/templates")
      .set(auth(adminToken))
      .send({ name: `${marker} Disposable`, subject: "Bye" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await api.delete(`/api/v1/email/templates/${id}`).set(auth(adminToken));
    expect(res.status).toBe(200);

    const stored = await db
      .selectFrom("email_templates")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    expect(stored).toBeUndefined();
  });

  it("returns 404 deleting a missing template", async () => {
    const res = await api.delete(`/api/v1/email/templates/${ulid()}`).set(auth(adminToken));
    expect(res.status).toBe(404);
  });
});

describe("AI email writer", () => {
  it("returns a generated draft", async () => {
    const res = await api
      .post("/api/v1/email/write")
      .set(auth(adminToken))
      .send({ type: "sales", name: "Priya", company: "Acme" });
    expect(res.status).toBe(200);
    expect(res.body.data.subject).toContain("Priya");
    expect(res.body.data.body).toContain("Priya");
    expect(res.body.data.generatedBy).toBeTruthy();
    expect(res.body.data.type).toBe("sales");
  });
});

describe("email send and metrics", () => {
  it("sends a tracked outbound email to a lead", async () => {
    const res = await api
      .post("/api/v1/email/send")
      .set(auth(adminToken))
      .send({ leadId, subject: `${marker} subject`, body: "Hello from the email test" });
    expect(res.status).toBe(201);
    const msg = res.body.data;
    expect(msg.channel).toBe("EMAIL");
    expect(msg.direction).toBe("OUTBOUND");
    expect(msg.lead_id).toBe(leadId);
    expect(msg.subject).toBe(`${marker} subject`);
    expect(typeof msg.opened).toBe("boolean");
    expect(typeof msg.clicked).toBe("boolean");
    if (msg.clicked) expect(msg.opened).toBe(true);

    // The mailer never goes live under the test runner, so sends are simulated
    // and the message row is flagged accordingly (no real email leaves SES).
    expect(msg.provider).toBe("SIMULATED");
    const stored = await db
      .selectFrom("messages")
      .select(["simulated"])
      .where("id", "=", msg.id)
      .executeTakeFirst();
    expect(stored?.simulated).toBe(true);

    // The subject lands on the conversation.
    const conv = await db
      .selectFrom("conversations")
      .selectAll()
      .where("tenant_id", "=", nwTenantId)
      .where("lead_id", "=", leadId)
      .executeTakeFirst();
    expect(conv?.subject).toBe(`${marker} subject`);
    expect(conv?.channel).toBe("EMAIL");
  });

  it("resolves {name}/{company} merge fields against the real recipient", async () => {
    const res = await api
      .post("/api/v1/email/send")
      .set(auth(adminToken))
      .send({
        leadId,
        subject: `Hi {name} - ${marker}`,
        body: "Hi {name},\n\nWelcome aboard.",
      });
    expect(res.status).toBe(201);
    const msg = res.body.data;

    // A raw token reaching a real inbox is the bug this guards against.
    expect(msg.subject).toBe(`Hi ${marker} - ${marker}`);
    expect(msg.body).toContain(`Hi ${marker},`);
    expect(msg.body).not.toContain("{name}");

    // The timeline stores the resolved text, not the template source.
    const stored = await db
      .selectFrom("messages")
      .select(["body"])
      .where("id", "=", msg.id)
      .executeTakeFirst();
    expect(stored?.body).toContain(`Hi ${marker},`);
    expect(stored?.body).not.toContain("{name}");
  });

  it("renders {company} as empty for a lead rather than leaving the token", async () => {
    const res = await api
      .post("/api/v1/email/send")
      .set(auth(adminToken))
      .send({ leadId, subject: `${marker} company`, body: "Team at {company} here." });
    expect(res.status).toBe(201);
    // Leads have no company column, so the token resolves to an empty string.
    expect(res.body.data.body).toBe("Team at  here.");
    expect(res.body.data.body).not.toContain("{company}");
  });

  it("requires a body", async () => {
    const res = await api
      .post("/api/v1/email/send")
      .set(auth(adminToken))
      .send({ leadId, subject: "no body" });
    expect(res.status).toBe(400);
  });

  it("requires a lead or contact", async () => {
    const res = await api
      .post("/api/v1/email/send")
      .set(auth(adminToken))
      .send({ subject: "no recipient", body: "Hello" });
    expect(res.status).toBe(400);
  });

  it("rejects a recipient with no email address", async () => {
    const res = await api
      .post("/api/v1/email/send")
      .set(auth(adminToken))
      .send({ leadId: noEmailLeadId, subject: "no address", body: "Hello" });
    expect(res.status).toBe(400);
  });

  it("rejects a cross-tenant lead reference with 404", async () => {
    const res = await api
      .post("/api/v1/email/send")
      .set(auth(esAdminToken))
      .send({ leadId, body: "should not send" });
    expect(res.status).toBe(404);
  });

  it("reports engagement metrics", async () => {
    const res = await api.get("/api/v1/email/metrics").set(auth(adminToken));
    expect(res.status).toBe(200);
    const { sent, openRate, clickRate, replies } = res.body.data;
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(openRate).toBeGreaterThanOrEqual(0);
    expect(openRate).toBeLessThanOrEqual(100);
    expect(clickRate).toBeGreaterThanOrEqual(0);
    expect(clickRate).toBeLessThanOrEqual(openRate);
    expect(replies).toBeGreaterThanOrEqual(0);
  });
});

describe("email RBAC", () => {
  it("denies roles without the email module", async () => {
    const res = await api.get("/api/v1/email/templates").set(auth(salesToken));
    expect(res.status).toBe(403);
  });
});
