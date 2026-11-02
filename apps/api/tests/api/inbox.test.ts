import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_FINANCE, login } from "../helpers";

const RUN = ulid();
const LEAD_NAME = `InboxTest Lead ${RUN}`;

let adminToken: string;
let esAdminToken: string;
let financeToken: string;
let tenantId: string;
let leadId: string;
let conversationId: string;

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

  const now = new Date();
  const lead = await db
    .insertInto("leads")
    .values({
      id: ulid(),
      tenant_id: tenantId,
      name: LEAD_NAME,
      email: `inbox.${RUN.toLowerCase()}@example.com`,
      phone: "",
      city: "Pune",
      country: "India",
      source: "WhatsApp",
      campaign: "",
      status: "NEW",
      owner_id: null,
      tags: JSON.stringify([]),
      notes: "",
      budget: false,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  leadId = lead.id;
});

afterAll(async () => {
  await db.deleteFrom("messages").where("lead_id", "=", leadId).execute();
  await db.deleteFrom("conversations").where("lead_id", "=", leadId).execute();
  await db.deleteFrom("leads").where("id", "=", leadId).execute();
  await closeDB();
});

describe("POST /inbox/simulate-inbound", () => {
  it("records an inbound message and opens a conversation", async () => {
    const res = await api
      .post("/api/v1/inbox/simulate-inbound")
      .set(auth(adminToken))
      .send({ channel: "WHATSAPP", leadId, body: "Hi, I am interested in a demo" });
    expect(res.status).toBe(201);
    const msg = res.body.data;
    expect(msg.direction).toBe("INBOUND");
    expect(msg.channel).toBe("WHATSAPP");
    expect(msg.lead_id).toBe(leadId);
    expect(msg.sentiment).toBeTruthy();
    expect(msg.conversation_id).toBeTruthy();
    conversationId = msg.conversation_id;
  });

  it("requires channel and body", async () => {
    const noChannel = await api
      .post("/api/v1/inbox/simulate-inbound")
      .set(auth(adminToken))
      .send({ leadId, body: "hello" });
    expect(noChannel.status).toBe(400);

    const noBody = await api
      .post("/api/v1/inbox/simulate-inbound")
      .set(auth(adminToken))
      .send({ channel: "WHATSAPP", leadId });
    expect(noBody.status).toBe(400);
  });

  it("rejects unknown channels", async () => {
    const res = await api
      .post("/api/v1/inbox/simulate-inbound")
      .set(auth(adminToken))
      .send({ channel: "PIGEON", leadId, body: "hello" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown lead", async () => {
    const res = await api
      .post("/api/v1/inbox/simulate-inbound")
      .set(auth(adminToken))
      .send({ channel: "WHATSAPP", leadId: ulid(), body: "hello" });
    expect(res.status).toBe(404);
  });
});

describe("GET /inbox", () => {
  it("returns per-channel counts and conversations sorted latest first", async () => {
    const res = await api.get("/api/v1/inbox").set(auth(adminToken));
    expect(res.status).toBe(200);

    const { channels, conversations } = res.body.data;
    const keys = channels.map((c: { channel: string }) => c.channel);
    expect(keys).toEqual(
      expect.arrayContaining([
        "WHATSAPP",
        "EMAIL",
        "SMS",
        "TELEGRAM",
        "CHAT",
        "FACEBOOK",
        "INSTAGRAM",
        "VOICE",
      ])
    );

    const wa = channels.find((c: { channel: string }) => c.channel === "WHATSAPP");
    expect(wa.conversations).toBeGreaterThanOrEqual(1);
    expect(wa.unread).toBeGreaterThanOrEqual(1);

    const mine = conversations.find((c: { id: string }) => c.id === conversationId);
    expect(mine).toBeTruthy();
    expect(mine.who).toMatchObject({ id: leadId, name: LEAD_NAME });

    for (let i = 1; i < conversations.length; i++) {
      const prev = conversations[i - 1].last_message_at;
      const next = conversations[i].last_message_at;
      if (prev && next) {
        expect(new Date(prev).getTime()).toBeGreaterThanOrEqual(new Date(next).getTime());
      }
    }
  });

  it("filters conversations by channel", async () => {
    const res = await api.get("/api/v1/inbox?channel=EMAIL").set(auth(adminToken));
    expect(res.status).toBe(200);
    const { conversations } = res.body.data;
    expect(
      conversations.every((c: { channel: string }) => c.channel === "EMAIL")
    ).toBe(true);
  });

  it("rejects an invalid channel filter", async () => {
    const res = await api.get("/api/v1/inbox?channel=PIGEON").set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("FINANCE role is blocked by RBAC", async () => {
    const res = await api.get("/api/v1/inbox").set(auth(financeToken));
    expect(res.status).toBe(403);
  });
});

describe("GET /inbox/:id", () => {
  it("returns the thread ascending and resets unread_count", async () => {
    const res = await api.get(`/api/v1/inbox/${conversationId}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const conv = res.body.data;
    expect(conv.id).toBe(conversationId);
    expect(conv.unread_count).toBe(0);
    expect(conv.who).toMatchObject({ id: leadId, name: LEAD_NAME });
    expect(conv.messages.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < conv.messages.length; i++) {
      expect(new Date(conv.messages[i].at).getTime()).toBeGreaterThanOrEqual(
        new Date(conv.messages[i - 1].at).getTime()
      );
    }

    const row = await db
      .selectFrom("conversations")
      .select("unread_count")
      .where("id", "=", conversationId)
      .executeTakeFirstOrThrow();
    expect(row.unread_count).toBe(0);
  });

  it("cross-tenant fetch returns 404", async () => {
    const res = await api.get(`/api/v1/inbox/${conversationId}`).set(auth(esAdminToken));
    expect(res.status).toBe(404);
  });
});

describe("POST /inbox/:id/send", () => {
  it("sends an outbound reply on the conversation channel", async () => {
    const res = await api
      .post(`/api/v1/inbox/${conversationId}/send`)
      .set(auth(adminToken))
      .send({ body: "Thanks for reaching out, sharing the demo link." });
    expect(res.status).toBe(201);
    const msg = res.body.data;
    expect(msg.direction).toBe("OUTBOUND");
    expect(msg.channel).toBe("WHATSAPP");
    expect(msg.conversation_id).toBe(conversationId);
    expect(msg.sender_user_id).toBeTruthy();

    const detail = await api.get(`/api/v1/inbox/${conversationId}`).set(auth(adminToken));
    expect(detail.body.data.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("requires a body", async () => {
    const res = await api
      .post(`/api/v1/inbox/${conversationId}/send`)
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown conversation", async () => {
    const res = await api
      .post(`/api/v1/inbox/${ulid()}/send`)
      .set(auth(adminToken))
      .send({ body: "hello" });
    expect(res.status).toBe(404);
  });
});
