import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_SALES,
  NW_SUPPORT,
  login,
} from "../helpers";

let adminToken: string;
let salesToken: string;
let supportToken: string;
let esAdminToken: string;
let nwTenantId: string;
let adminUserId: string;
let salesUserId: string;

const marker = `Platqa${Date.now()}`;
const dateStr = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

const createdNotificationIds: string[] = [];
const createdLeadIds: string[] = [];
const createdContactIds: string[] = [];
const createdAccountIds: string[] = [];
const createdDealIds: string[] = [];
const createdTicketIds: string[] = [];
const createdViewIds: string[] = [];
const createdReminderIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  supportToken = await login(NW_SUPPORT.email, NW_SUPPORT.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const adminMe = await api.get("/api/v1/auth/me").set(auth(adminToken));
  adminUserId = adminMe.body.data.user.id as string;
  nwTenantId = adminMe.body.data.user.tenant_id as string;
  const salesMe = await api.get("/api/v1/auth/me").set(auth(salesToken));
  salesUserId = salesMe.body.data.user.id as string;
});

afterAll(async () => {
  for (const [table, ids] of [
    ["notifications", createdNotificationIds],
    ["leads", createdLeadIds],
    ["contacts", createdContactIds],
    ["accounts", createdAccountIds],
    ["deals", createdDealIds],
    ["tickets", createdTicketIds],
    ["saved_views", createdViewIds],
    ["reminders", createdReminderIds],
  ] as const) {
    for (const id of ids) {
      await db.deleteFrom(table).where("id", "=", id).execute();
    }
  }
  await closeDB();
});

describe("notifications", () => {
  let unreadId: string;
  let readId: string;
  let adminNotificationId: string;

  beforeAll(async () => {
    const t = new Date();
    unreadId = ulid();
    readId = ulid();
    adminNotificationId = ulid();
    await db
      .insertInto("notifications")
      .values([
        {
          id: unreadId,
          tenant_id: nwTenantId,
          user_id: salesUserId,
          text: `${marker} unread ping`,
          link: "/leads",
          read: false,
          created_at: new Date(t.getTime() - 60000),
        },
        {
          id: readId,
          tenant_id: nwTenantId,
          user_id: salesUserId,
          text: `${marker} read ping`,
          link: null,
          read: true,
          created_at: t,
        },
        {
          id: adminNotificationId,
          tenant_id: nwTenantId,
          user_id: adminUserId,
          text: `${marker} admin-only ping`,
          link: null,
          read: false,
          created_at: t,
        },
      ])
      .execute();
    createdNotificationIds.push(unreadId, readId, adminNotificationId);
  });

  it("lists only the caller's notifications, unread first", async () => {
    const res = await api.get("/api/v1/notifications").set(auth(salesToken));
    expect(res.status).toBe(200);
    const { unread, notifications } = res.body.data;
    expect(unread).toBeGreaterThanOrEqual(1);
    expect(notifications.length).toBeLessThanOrEqual(50);

    const ids = notifications.map((n: { id: string }) => n.id);
    expect(ids).toContain(unreadId);
    expect(ids).toContain(readId);
    expect(ids).not.toContain(adminNotificationId);
    // The read row was created later but still sorts after the unread one.
    expect(ids.indexOf(unreadId)).toBeLessThan(ids.indexOf(readId));
  });

  it("another user's notification id returns 404", async () => {
    const res = await api
      .post(`/api/v1/notifications/${adminNotificationId}/read`)
      .set(auth(salesToken))
      .send({});
    expect(res.status).toBe(404);
  });

  it("marks a single notification read", async () => {
    const res = await api
      .post(`/api/v1/notifications/${unreadId}/read`)
      .set(auth(salesToken))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);
  });

  it("marks all notifications read", async () => {
    const res = await api.post("/api/v1/notifications/read-all").set(auth(salesToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const after = await api.get("/api/v1/notifications").set(auth(salesToken));
    expect(after.body.data.unread).toBe(0);
  });
});

describe("global search", () => {
  beforeAll(async () => {
    const t = new Date();
    const leadId = ulid();
    const contactId = ulid();
    const accountId = ulid();
    const dealId = ulid();
    const ticketId = ulid();

    const pipeline = await db
      .selectFrom("pipelines")
      .selectAll()
      .where("tenant_id", "=", nwTenantId)
      .where("is_default", "=", true)
      .executeTakeFirstOrThrow();
    const stage = await db
      .selectFrom("stages")
      .selectAll()
      .where("tenant_id", "=", nwTenantId)
      .where("pipeline_id", "=", pipeline.id)
      .orderBy("sort_order", "asc")
      .executeTakeFirstOrThrow();

    await db
      .insertInto("leads")
      .values({
        id: leadId,
        tenant_id: nwTenantId,
        name: `${marker} Lead`,
        email: "platqa.lead@example.com",
        phone: "",
        city: "Pune",
        source: "API",
        tags: JSON.stringify([]),
        notes: "",
        created_at: t,
        updated_at: t,
      })
      .execute();
    await db
      .insertInto("contacts")
      .values({
        id: contactId,
        tenant_id: nwTenantId,
        name: `${marker} Contact`,
        company: "Platqa Pvt Ltd",
        created_at: t,
        updated_at: t,
      })
      .execute();
    await db
      .insertInto("accounts")
      .values({
        id: accountId,
        tenant_id: nwTenantId,
        name: `${marker} Account`,
        industry: "EdTech",
        created_at: t,
        updated_at: t,
      })
      .execute();
    await db
      .insertInto("deals")
      .values({
        id: dealId,
        tenant_id: nwTenantId,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        title: `${marker} Deal`,
        value: 150000,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await db
      .insertInto("tickets")
      .values({
        id: ticketId,
        tenant_id: nwTenantId,
        subject: `${marker} Ticket`,
        body: "search fixture",
        created_at: t,
        updated_at: t,
      })
      .execute();

    createdLeadIds.push(leadId);
    createdContactIds.push(contactId);
    createdAccountIds.push(accountId);
    createdDealIds.push(dealId);
    createdTicketIds.push(ticketId);
  });

  it("requires a query of at least 2 characters", async () => {
    expect((await api.get("/api/v1/search").set(auth(adminToken))).status).toBe(400);
    expect((await api.get("/api/v1/search?q=a").set(auth(adminToken))).status).toBe(400);
  });

  it("returns typed groups across leads, contacts, accounts, deals and tickets", async () => {
    const res = await api.get(`/api/v1/search?q=${marker}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const groups = res.body.data;
    expect(groups.map((g: { type: string }) => g.type)).toEqual([
      "lead",
      "contact",
      "account",
      "deal",
      "ticket",
    ]);

    const byType = Object.fromEntries(
      groups.map((g: { type: string; items: Array<{ title: string }> }) => [g.type, g.items])
    );
    expect(byType.lead).toHaveLength(1);
    expect(byType.lead[0].title).toBe(`${marker} Lead`);
    expect(byType.contact).toHaveLength(1);
    expect(byType.contact[0].sub).toBe("Platqa Pvt Ltd");
    expect(byType.account).toHaveLength(1);
    expect(byType.deal).toHaveLength(1);
    expect(byType.deal[0].title).toBe(`${marker} Deal`);
    expect(byType.ticket).toHaveLength(1);
    expect(byType.ticket[0].title).toBe(`${marker} Ticket`);
  });

  it("caps items per type and is tenant-scoped", async () => {
    const res = await api.get(`/api/v1/search?q=${marker}`).set(auth(esAdminToken));
    expect(res.status).toBe(200);
    for (const group of res.body.data) {
      expect(group.items).toHaveLength(0);
    }

    const wide = await api.get("/api/v1/search?q=an").set(auth(adminToken));
    expect(wide.status).toBe(200);
    for (const group of wide.body.data) {
      expect(group.items.length).toBeLessThanOrEqual(10);
    }
  });
});

describe("saved views", () => {
  let viewId: string;

  it("saves a view for the caller with a trimmed name", async () => {
    const res = await api
      .post("/api/v1/views")
      .set(auth(salesToken))
      .send({ resource: "leads", name: `  ${marker} hot leads  `, filters: { grade: "HOT" } });
    expect(res.status).toBe(201);
    viewId = res.body.data.id;
    createdViewIds.push(viewId);
    expect(res.body.data.name).toBe(`${marker} hot leads`);
    expect(res.body.data.resource).toBe("leads");
    expect(res.body.data.filters).toEqual({ grade: "HOT" });
  });

  it("validates resource and name", async () => {
    const noResource = await api
      .post("/api/v1/views")
      .set(auth(salesToken))
      .send({ name: "x" });
    expect(noResource.status).toBe(400);
    const noName = await api
      .post("/api/v1/views")
      .set(auth(salesToken))
      .send({ resource: "leads", name: "   " });
    expect(noName.status).toBe(400);
  });

  it("is strictly private per user", async () => {
    const mine = await api.get("/api/v1/views?resource=leads").set(auth(salesToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((v: { id: string }) => v.id)).toContain(viewId);

    const admins = await api.get("/api/v1/views?resource=leads").set(auth(adminToken));
    expect(admins.body.data.map((v: { id: string }) => v.id)).not.toContain(viewId);

    const crossDelete = await api.delete(`/api/v1/views/${viewId}`).set(auth(adminToken));
    expect(crossDelete.status).toBe(404);
  });

  it("deletes the caller's own view", async () => {
    const res = await api.delete(`/api/v1/views/${viewId}`).set(auth(salesToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const after = await api.get("/api/v1/views").set(auth(salesToken));
    expect(after.body.data.map((v: { id: string }) => v.id)).not.toContain(viewId);

    const again = await api.delete(`/api/v1/views/${viewId}`).set(auth(salesToken));
    expect(again.status).toBe(404);
  });
});

describe("reminders", () => {
  let dueTodayId: string;
  let overdueId: string;
  let noDueId: string;

  it("creates reminders with defaults and validates input", async () => {
    const dueToday = await api
      .post("/api/v1/reminders")
      .set(auth(supportToken))
      .send({ title: `${marker} due today`, dueDate: dateStr(0) });
    expect(dueToday.status).toBe(201);
    dueTodayId = dueToday.body.data.id;
    createdReminderIds.push(dueTodayId);
    expect(dueToday.body.data.status).toBe("OPEN");
    expect(dueToday.body.data.priority).toBe("MEDIUM");
    expect(dueToday.body.data.due_date).toBe(dateStr(0));

    const overdue = await api
      .post("/api/v1/reminders")
      .set(auth(supportToken))
      .send({ title: `${marker} overdue`, dueDate: dateStr(-1), priority: "HIGH" });
    expect(overdue.status).toBe(201);
    overdueId = overdue.body.data.id;
    createdReminderIds.push(overdueId);
    expect(overdue.body.data.priority).toBe("HIGH");

    const noDue = await api
      .post("/api/v1/reminders")
      .set(auth(supportToken))
      .send({ title: `${marker} someday`, note: "no rush" });
    expect(noDue.status).toBe(201);
    noDueId = noDue.body.data.id;
    createdReminderIds.push(noDueId);
    expect(noDue.body.data.due_date).toBeNull();

    expect(
      (await api.post("/api/v1/reminders").set(auth(supportToken)).send({ note: "x" })).status
    ).toBe(400);
    expect(
      (
        await api
          .post("/api/v1/reminders")
          .set(auth(supportToken))
          .send({ title: "bad date", dueDate: "31-12-2026" })
      ).status
    ).toBe(400);
  });

  it("today view includes due-today and overdue items only", async () => {
    const res = await api.get("/api/v1/reminders/today").set(auth(supportToken));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(dueTodayId);
    expect(ids).toContain(overdueId);
    expect(ids).not.toContain(noDueId);
  });

  it("open filter sorts by due date with no-due-date items last", async () => {
    const res = await api.get("/api/v1/reminders?filter=open").set(auth(supportToken));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(dueTodayId);
    expect(ids).toContain(overdueId);
    expect(ids).toContain(noDueId);
    expect(ids.indexOf(overdueId)).toBeLessThan(ids.indexOf(dueTodayId));
    expect(ids.indexOf(dueTodayId)).toBeLessThan(ids.indexOf(noDueId));
  });

  it("counts open and due-today (including overdue), and toggling adjusts both", async () => {
    const before = await api.get("/api/v1/reminders/count").set(auth(supportToken));
    expect(before.status).toBe(200);
    expect(before.body.data.open).toBeGreaterThanOrEqual(3);
    expect(before.body.data.dueToday).toBeGreaterThanOrEqual(2);

    const toggled = await api
      .post(`/api/v1/reminders/${overdueId}/toggle`)
      .set(auth(supportToken))
      .send({});
    expect(toggled.status).toBe(200);
    expect(toggled.body.data.status).toBe("DONE");

    const after = await api.get("/api/v1/reminders/count").set(auth(supportToken));
    expect(after.body.data.open).toBe(before.body.data.open - 1);
    expect(after.body.data.dueToday).toBe(before.body.data.dueToday - 1);
  });

  it("filters done and all correctly after the toggle", async () => {
    const done = await api.get("/api/v1/reminders?filter=done").set(auth(supportToken));
    expect(done.body.data.map((r: { id: string }) => r.id)).toContain(overdueId);

    const today = await api.get("/api/v1/reminders?filter=today").set(auth(supportToken));
    expect(today.body.data.map((r: { id: string }) => r.id)).not.toContain(overdueId);

    const all = await api.get("/api/v1/reminders?filter=all").set(auth(supportToken));
    const allIds = all.body.data.map((r: { id: string }) => r.id);
    expect(allIds).toEqual(expect.arrayContaining([dueTodayId, overdueId, noDueId]));
  });

  it("updates fields on the caller's own reminder", async () => {
    const res = await api
      .put(`/api/v1/reminders/${noDueId}`)
      .set(auth(supportToken))
      .send({ note: "updated note", priority: "LOW", dueDate: dateStr(1) });
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe("updated note");
    expect(res.body.data.priority).toBe("LOW");
    expect(res.body.data.due_date).toBe(dateStr(1));
  });

  it("is strictly private: another user in the same tenant gets 404", async () => {
    const update = await api
      .put(`/api/v1/reminders/${dueTodayId}`)
      .set(auth(adminToken))
      .send({ title: "hijack" });
    expect(update.status).toBe(404);

    const toggle = await api
      .post(`/api/v1/reminders/${dueTodayId}/toggle`)
      .set(auth(adminToken))
      .send({});
    expect(toggle.status).toBe(404);

    const del = await api.delete(`/api/v1/reminders/${dueTodayId}`).set(auth(adminToken));
    expect(del.status).toBe(404);

    const crossTenant = await api
      .delete(`/api/v1/reminders/${dueTodayId}`)
      .set(auth(esAdminToken));
    expect(crossTenant.status).toBe(404);
  });

  it("deletes the caller's own reminder", async () => {
    const res = await api.delete(`/api/v1/reminders/${dueTodayId}`).set(auth(supportToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const all = await api.get("/api/v1/reminders?filter=all").set(auth(supportToken));
    expect(all.body.data.map((r: { id: string }) => r.id)).not.toContain(dueTodayId);
  });
});
