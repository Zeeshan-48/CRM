import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_FINANCE,
  NW_SUPPORT,
  login,
} from "../helpers";

const MARK = `tkt${Date.now()}`;
const startedAt = new Date();

let adminToken: string;
let supportToken: string;
let financeToken: string;
let esAdminToken: string;
let nwTenantId: string;
let contactId: string;
let supportUserId: string;
const createdTicketIds: string[] = [];

const createTicket = async (payload: Record<string, unknown>) => {
  const res = await api.post("/api/v1/tickets").set(auth(adminToken)).send(payload);
  expect(res.status).toBe(201);
  createdTicketIds.push(res.body.data.id);
  return res.body.data;
};

// notify() is fire-and-forget, so poll briefly for the rows to land.
const waitFor = async (fn: () => Promise<boolean>, timeoutMs = 4000): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  supportToken = await login(NW_SUPPORT.email, NW_SUPPORT.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;

  const contact = await db
    .selectFrom("contacts")
    .select(["id"])
    .where("tenant_id", "=", nwTenantId)
    .orderBy("created_at", "asc")
    .executeTakeFirstOrThrow();
  contactId = contact.id;

  const support = await db
    .selectFrom("users")
    .select(["id"])
    .where("tenant_id", "=", nwTenantId)
    .where("email", "=", NW_SUPPORT.email)
    .executeTakeFirstOrThrow();
  supportUserId = support.id;
});

afterAll(async () => {
  if (createdTicketIds.length) {
    await db.deleteFrom("ticket_replies").where("ticket_id", "in", createdTicketIds).execute();
    await db.deleteFrom("tickets").where("id", "in", createdTicketIds).execute();
  }
  await db
    .deleteFrom("notifications")
    .where("text", "like", `%${MARK}%`)
    .where("created_at", ">=", startedAt)
    .execute();
  await db
    .deleteFrom("notifications")
    .where("text", "=", "New support ticket needs attention")
    .where("created_at", ">=", startedAt)
    .execute();
  await db
    .deleteFrom("automation_runs")
    .where("event", "=", "ticket.created")
    .where("created_at", ">=", startedAt)
    .execute();
  await closeDB();
});

describe("tickets list, SLA and metrics", () => {
  it("lists tickets latest first with contact name and breached flag", async () => {
    const res = await api.get("/api/v1/tickets").set(auth(adminToken));
    expect(res.status).toBe(200);
    const tickets = res.body.data;
    expect(tickets.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < tickets.length; i++) {
      expect(new Date(tickets[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(tickets[i].created_at).getTime()
      );
    }
    expect(tickets.some((t: { contact: string | null }) => typeof t.contact === "string")).toBe(
      true
    );
    expect(typeof tickets[0].breached).toBe("boolean");
  });

  it("filters by status, priority and assignee", async () => {
    const open = await api.get("/api/v1/tickets?status=OPEN").set(auth(adminToken));
    expect(open.status).toBe(200);
    expect(open.body.data.every((t: { status: string }) => t.status === "OPEN")).toBe(true);

    const urgent = await api.get("/api/v1/tickets?priority=URGENT").set(auth(adminToken));
    expect(urgent.body.data.every((t: { priority: string }) => t.priority === "URGENT")).toBe(
      true
    );

    const mine = await api
      .get(`/api/v1/tickets?assignee=${supportUserId}`)
      .set(auth(adminToken));
    expect(mine.body.data.length).toBeGreaterThanOrEqual(1);
    expect(
      mine.body.data.every((t: { assignee_id: string }) => t.assignee_id === supportUserId)
    ).toBe(true);

    const invalid = await api.get("/api/v1/tickets?status=BOGUS").set(auth(adminToken));
    expect(invalid.status).toBe(400);
  });

  it("lists SLA policies including the seeded default", async () => {
    const res = await api.get("/api/v1/tickets/sla").set(auth(adminToken));
    expect(res.status).toBe(200);
    const standard = res.body.data.find((p: { name: string }) => p.name === "Standard");
    expect(standard).toBeTruthy();
    expect(standard.resolution_hours).toBe(24);
    expect(standard.is_default).toBe(true);
  });

  it("returns metrics with priority breakdown and null-safe csat", async () => {
    const res = await api.get("/api/v1/tickets/metrics").set(auth(adminToken));
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m.total).toBeGreaterThanOrEqual(6);
    expect(m.total).toBeGreaterThanOrEqual(m.open);
    expect(m.total).toBeGreaterThanOrEqual(m.resolved);
    expect(m.breached).toBeGreaterThanOrEqual(0);
    expect(m.byPriority.map((p: { priority: string }) => p.priority)).toEqual([
      "URGENT",
      "HIGH",
      "MEDIUM",
      "LOW",
    ]);
    const prioritySum = m.byPriority.reduce(
      (acc: number, p: { count: number }) => acc + p.count,
      0
    );
    expect(prioritySum).toBe(m.total);
    expect(m.csat === null || typeof m.csat === "number").toBe(true);
  });

  it("averages csat once tickets carry scores", async () => {
    const ticket = await createTicket({ subject: `${MARK} csat sample` });
    await db
      .updateTable("tickets")
      .set({ csat: 80 })
      .where("id", "=", ticket.id)
      .where("tenant_id", "=", nwTenantId)
      .execute();
    const res = await api.get("/api/v1/tickets/metrics").set(auth(adminToken));
    expect(typeof res.body.data.csat).toBe("number");
    expect(res.body.data.csat).toBeGreaterThan(0);
  });
});

describe("ticket creation", () => {
  it("creates a ticket with SLA due date, sentiment and fires ticket.created", async () => {
    const ticket = await createTicket({
      subject: `${MARK} cannot access course`,
      body: "I am interested in continuing but the videos do not load. Thanks!",
      priority: "HIGH",
      contactId,
      channel: "email",
    });
    expect(ticket.status).toBe("OPEN");
    expect(ticket.priority).toBe("HIGH");
    expect(ticket.channel).toBe("email");
    expect(ticket.contact_id).toBe(contactId);
    expect(ticket.sentiment).toBe("Positive");

    // Compare against created_at: both columns shift identically if the test
    // process timezone differs from the server's TZ=UTC runtime.
    const due = new Date(ticket.sla_due_at).getTime();
    const created = new Date(ticket.created_at).getTime();
    expect(Math.abs(due - created - 24 * 3600000)).toBeLessThan(60000);

    // Seeded "Ticket created: notify support" workflow notifies support agents.
    const notified = await waitFor(async () => {
      const row = await db
        .selectFrom("notifications")
        .select(["id"])
        .where("tenant_id", "=", nwTenantId)
        .where("user_id", "=", supportUserId)
        .where("text", "=", "New support ticket needs attention")
        .where("created_at", ">=", startedAt)
        .executeTakeFirst();
      return !!row;
    });
    expect(notified).toBe(true);
  });

  it("requires a subject", async () => {
    const res = await api
      .post("/api/v1/tickets")
      .set(auth(adminToken))
      .send({ body: "no subject here" });
    expect(res.status).toBe(400);
  });

  it("rejects a contactId from outside the tenant catalogue", async () => {
    const res = await api
      .post("/api/v1/tickets")
      .set(auth(adminToken))
      .send({ subject: `${MARK} bad contact`, contactId: "01XXXXXXXXXXXXXXXXXXXXXXXX" });
    expect(res.status).toBe(404);
  });
});

describe("ticket detail and updates", () => {
  it("returns ticket detail with contact row and ascending replies", async () => {
    const ticket = await createTicket({ subject: `${MARK} detail thread`, contactId });
    await api
      .post(`/api/v1/tickets/${ticket.id}/reply`)
      .set(auth(supportToken))
      .send({ body: "first response" });
    await api
      .post(`/api/v1/tickets/${ticket.id}/reply`)
      .set(auth(supportToken))
      .send({ body: "second response" });

    const res = await api.get(`/api/v1/tickets/${ticket.id}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.contact.id).toBe(contactId);
    expect(res.body.data.replies.map((r: { body: string }) => r.body)).toEqual([
      "first response",
      "second response",
    ]);
  });

  it("updates status, priority and assignee, stamping resolved_at on RESOLVED", async () => {
    const ticket = await createTicket({ subject: `${MARK} update me` });

    const updated = await api
      .put(`/api/v1/tickets/${ticket.id}`)
      .set(auth(adminToken))
      .send({ priority: "LOW", assignee_id: supportUserId });
    expect(updated.status).toBe(200);
    expect(updated.body.data.priority).toBe("LOW");
    expect(updated.body.data.assignee_id).toBe(supportUserId);
    expect(updated.body.data.resolved_at).toBeNull();

    const resolved = await api
      .put(`/api/v1/tickets/${ticket.id}`)
      .set(auth(adminToken))
      .send({ status: "RESOLVED" });
    expect(resolved.body.data.status).toBe("RESOLVED");
    expect(resolved.body.data.resolved_at).toBeTruthy();
  });

  it("escalates to URGENT and notifies active managers and admins", async () => {
    const subject = `${MARK} escalate me`;
    const ticket = await createTicket({ subject });

    const res = await api
      .post(`/api/v1/tickets/${ticket.id}/escalate`)
      .set(auth(supportToken));
    expect(res.status).toBe(200);
    expect(res.body.data.priority).toBe("URGENT");
    expect(res.body.data.escalated).toBe(true);

    // Northwind seeds one ACTIVE ADMIN and one ACTIVE MANAGER.
    const delivered = await waitFor(async () => {
      const rows = await db
        .selectFrom("notifications")
        .select(["id"])
        .where("tenant_id", "=", nwTenantId)
        .where("text", "=", `Ticket escalated: ${subject}`)
        .execute();
      return rows.length >= 2;
    });
    expect(delivered).toBe(true);

    const recipients = await db
      .selectFrom("notifications")
      .innerJoin("users", "users.id", "notifications.user_id")
      .select(["users.role"])
      .where("notifications.tenant_id", "=", nwTenantId)
      .where("notifications.text", "=", `Ticket escalated: ${subject}`)
      .execute();
    expect(recipients.every((r) => ["MANAGER", "ADMIN"].includes(r.role))).toBe(true);
  });

  it("replies set first_response_at once and move OPEN tickets to PENDING", async () => {
    const ticket = await createTicket({ subject: `${MARK} reply thread` });

    const empty = await api
      .post(`/api/v1/tickets/${ticket.id}/reply`)
      .set(auth(supportToken))
      .send({ body: "   " });
    expect(empty.status).toBe(400);

    const first = await api
      .post(`/api/v1/tickets/${ticket.id}/reply`)
      .set(auth(supportToken))
      .send({ body: "Looking into it now" });
    expect(first.status).toBe(201);
    expect(first.body.data.reply.is_ai).toBe(false);
    expect(first.body.data.reply.author_user_id).toBe(supportUserId);
    expect(first.body.data.ticket.status).toBe("PENDING");
    expect(first.body.data.ticket.first_response_at).toBeTruthy();

    const second = await api
      .post(`/api/v1/tickets/${ticket.id}/reply`)
      .set(auth(supportToken))
      .send({ body: "Update: fix deployed" });
    expect(second.body.data.ticket.status).toBe("PENDING");
    expect(new Date(second.body.data.ticket.first_response_at).getTime()).toBe(
      new Date(first.body.data.ticket.first_response_at).getTime()
    );
  });

  it("deletes a ticket (cascading replies) and blocks cross-tenant deletion", async () => {
    const ticket = await createTicket({ subject: `${MARK} delete me`, contactId });
    await api
      .post(`/api/v1/tickets/${ticket.id}/reply`)
      .set(auth(supportToken))
      .send({ body: "a reply that should cascade" });

    const cross = await api.delete(`/api/v1/tickets/${ticket.id}`).set(auth(esAdminToken));
    expect(cross.status).toBe(404);

    const del = await api.delete(`/api/v1/tickets/${ticket.id}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    expect(del.body.data.ok).toBe(true);

    const gone = await api.get(`/api/v1/tickets/${ticket.id}`).set(auth(adminToken));
    expect(gone.status).toBe(404);

    const replies = await db
      .selectFrom("ticket_replies")
      .select("id")
      .where("ticket_id", "=", ticket.id)
      .execute();
    expect(replies.length).toBe(0);
  });
});

describe("AI resolve", () => {
  it("auto-resolves with an AI reply when the KB has a confident match", async () => {
    const ticket = await createTicket({
      subject: `${MARK} refund request for duplicate payment`,
      body: "I was charged twice and need a refund for the duplicate payment.",
    });

    const res = await api
      .post(`/api/v1/tickets/${ticket.id}/ai-resolve`)
      .set(auth(supportToken));
    expect(res.status).toBe(200);
    expect(res.body.data.resolved).toBe(true);
    expect(res.body.data.reply.is_ai).toBe(true);
    expect(res.body.data.reply.body.length).toBeGreaterThan(0);
    expect(res.body.data.source.title).toBe("Refund policy");

    const after = await api.get(`/api/v1/tickets/${ticket.id}`).set(auth(adminToken));
    expect(after.body.data.status).toBe("RESOLVED");
    expect(after.body.data.resolved_by).toBe("ai");
    expect(after.body.data.resolved_at).toBeTruthy();
    expect(after.body.data.replies.some((r: { is_ai: boolean }) => r.is_ai)).toBe(true);
  });

  it("returns a suggestion-free miss when nothing in the KB matches", async () => {
    const ticket = await createTicket({
      subject: `${MARK} zxqv flibber wobble`,
      body: "qqq zzz xyzzy",
    });

    const res = await api
      .post(`/api/v1/tickets/${ticket.id}/ai-resolve`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.resolved).toBe(false);
    expect(res.body.data.suggestion).toBeNull();

    const after = await api.get(`/api/v1/tickets/${ticket.id}`).set(auth(adminToken));
    expect(after.body.data.status).toBe("OPEN");
    expect(after.body.data.replies.length).toBe(0);
  });
});

describe("RBAC and tenant isolation", () => {
  it("denies the FINANCE role access to tickets", async () => {
    const res = await api.get("/api/v1/tickets").set(auth(financeToken));
    expect(res.status).toBe(403);
  });

  it("returns 404 for cross-tenant ticket access", async () => {
    const ticket = await createTicket({ subject: `${MARK} isolation check` });
    const res = await api.get(`/api/v1/tickets/${ticket.id}`).set(auth(esAdminToken));
    expect(res.status).toBe(404);

    const update = await api
      .put(`/api/v1/tickets/${ticket.id}`)
      .set(auth(esAdminToken))
      .send({ status: "CLOSED" });
    expect(update.status).toBe(404);
  });
});
