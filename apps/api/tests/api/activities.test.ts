import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_FINANCE,
  login,
} from "../helpers";

// pg serializes Date writes with local getters; index.ts forces TZ=UTC in the
// server process, so the test process must match or timestamps shift.
process.env.TZ = "UTC";

const MARKER = `act-test-${Date.now()}`;

let adminToken: string;
let financeToken: string;
let esAdminToken: string;
let adminUserId: string;
let nwTenantId: string;
let testLeadId: string;

const createdActivityIds: string[] = [];
const createdTaskIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const me = await api.get("/api/v1/auth/me").set(auth(adminToken));
  adminUserId = me.body.data.user.id;

  const tenant = await db
    .selectFrom("tenants")
    .select("id")
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;

  // A lead inserted directly so no workflow side effects need cleanup.
  testLeadId = ulid();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db
    .insertInto("leads")
    .values({
      id: testLeadId,
      tenant_id: nwTenantId,
      name: `Lead ${MARKER}`,
      email: `${MARKER}@example.com`,
      phone: "",
      city: "Pune",
      source: "API",
      campaign: "",
      owner_id: null,
      tags: JSON.stringify([]),
      notes: "",
      last_activity_at: old,
      created_at: old,
      updated_at: old,
    })
    .execute();
});

afterAll(async () => {
  for (const id of createdActivityIds) {
    await db.deleteFrom("activities").where("id", "=", id).execute();
  }
  for (const id of createdTaskIds) {
    await db.deleteFrom("tasks").where("id", "=", id).execute();
  }
  await db.deleteFrom("leads").where("id", "=", testLeadId).execute();
  await closeDB();
});

describe("activities", () => {
  it("lists activities most recent first with a default limit", async () => {
    const res = await api.get("/api/v1/activities").set(auth(adminToken));
    expect(res.status).toBe(200);
    const list = res.body.data;
    expect(list.length).toBeGreaterThanOrEqual(20);
    expect(list.length).toBeLessThanOrEqual(100);
    for (let i = 1; i < list.length; i++) {
      expect(new Date(list[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(list[i].created_at).getTime()
      );
    }

    const limited = await api.get("/api/v1/activities?limit=5").set(auth(adminToken));
    expect(limited.body.data.length).toBe(5);
  });

  it("filters by type", async () => {
    const res = await api.get("/api/v1/activities?type=CALL").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((a: { type: string }) => a.type === "CALL")).toBe(true);

    const bad = await api.get("/api/v1/activities?type=BOGUS").set(auth(adminToken));
    expect(bad.status).toBe(400);
  });

  it("rejects logging without a valid type", async () => {
    const missing = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ notes: "no type" });
    expect(missing.status).toBe(400);

    const invalid = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ type: "PIGEON" });
    expect(invalid.status).toBe(400);

    const badDirection = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ type: "CALL", direction: "SIDEWAYS" });
    expect(badDirection.status).toBe(400);
  });

  it("logs an activity, touches the lead and supports leadId filtering", async () => {
    const before = await db
      .selectFrom("leads")
      .select("last_activity_at")
      .where("id", "=", testLeadId)
      .executeTakeFirstOrThrow();

    const res = await api.post("/api/v1/activities").set(auth(adminToken)).send({
      type: "CALL",
      lead_id: testLeadId,
      notes: `Discussed pricing ${MARKER}`,
      duration_sec: 180,
    });
    expect(res.status).toBe(201);
    const activity = res.body.data;
    createdActivityIds.push(activity.id);
    expect(activity.type).toBe("CALL");
    expect(activity.direction).toBe("OUTBOUND");
    expect(activity.subject).toBe("CALL");
    expect(activity.owner_id).toBe(adminUserId);
    expect(activity.duration_sec).toBe(180);

    const after = await db
      .selectFrom("leads")
      .select("last_activity_at")
      .where("id", "=", testLeadId)
      .executeTakeFirstOrThrow();
    expect(new Date(after.last_activity_at as unknown as string).getTime()).toBeGreaterThan(
      new Date(before.last_activity_at as unknown as string).getTime()
    );

    const filtered = await api
      .get(`/api/v1/activities?leadId=${testLeadId}`)
      .set(auth(adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.length).toBe(1);
    const row = filtered.body.data[0];
    expect(row.id).toBe(activity.id);
    // The feed row carries resolved display names: the linked lead and the agent.
    expect(row.with_type).toBe("LEAD");
    expect(row.with_name).toBe(`Lead ${MARKER}`);
    expect(typeof row.owner_name).toBe("string");
    expect(row.owner_name.length).toBeGreaterThan(0);
  });

  it("respects an explicit INBOUND direction and subject", async () => {
    const res = await api.post("/api/v1/activities").set(auth(adminToken)).send({
      type: "EMAIL",
      direction: "INBOUND",
      subject: `Re: proposal ${MARKER}`,
    });
    expect(res.status).toBe(201);
    createdActivityIds.push(res.body.data.id);
    expect(res.body.data.direction).toBe("INBOUND");
    expect(res.body.data.subject).toBe(`Re: proposal ${MARKER}`);
  });

  it("counts activities beyond the page limit and grows when one is logged", async () => {
    // The real total must exceed a small page limit, this is the bug the stat
    // tile had: it showed a capped list length that never moved.
    const capped = await api.get("/api/v1/activities?limit=5").set(auth(adminToken));
    expect(capped.body.data.length).toBe(5);

    const before = await api.get("/api/v1/activities/count").set(auth(adminToken));
    expect(before.status).toBe(200);
    expect(typeof before.body.data.total).toBe("number");
    expect(before.body.data.total).toBeGreaterThan(5);

    const logged = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ type: "NOTE", notes: `count check ${MARKER}` });
    expect(logged.status).toBe(201);
    createdActivityIds.push(logged.body.data.id);

    const after = await api.get("/api/v1/activities/count").set(auth(adminToken));
    expect(after.body.data.total).toBe(before.body.data.total + 1);
  });

  it("counts honour the type filter and reject a bad type", async () => {
    const calls = await api
      .get("/api/v1/activities/count?type=CALL")
      .set(auth(adminToken));
    expect(calls.status).toBe(200);
    const all = await api.get("/api/v1/activities/count").set(auth(adminToken));
    expect(calls.body.data.total).toBeLessThanOrEqual(all.body.data.total);

    const bad = await api
      .get("/api/v1/activities/count?type=BOGUS")
      .set(auth(adminToken));
    expect(bad.status).toBe(400);
  });

  it("hides AI-generated activities when includeAi=0, shows them by default", async () => {
    // A dedicated lead so the leadId filter gives a deterministic, isolated set.
    const aiLeadId = ulid();
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db
      .insertInto("leads")
      .values({
        id: aiLeadId,
        tenant_id: nwTenantId,
        name: `AI Lead ${MARKER}`,
        email: `ai-${MARKER}@example.com`,
        phone: "",
        city: "Pune",
        source: "API",
        campaign: "",
        owner_id: null,
        tags: JSON.stringify([]),
        notes: "",
        last_activity_at: old,
        created_at: old,
        updated_at: old,
      })
      .execute();

    // One human activity (via the API) and one AI activity (as an agent writes it).
    const human = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ type: "NOTE", lead_id: aiLeadId, notes: `human ${MARKER}` });
    createdActivityIds.push(human.body.data.id);

    const aiId = ulid();
    await db
      .insertInto("activities")
      .values({
        id: aiId,
        tenant_id: nwTenantId,
        type: "CALL",
        subject: "AI voice call",
        notes: "bot",
        owner_id: adminUserId,
        lead_id: aiLeadId,
        ai_generated: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    createdActivityIds.push(aiId);

    // Default: both show, and the AI row is flagged for the badge.
    const all = await api
      .get(`/api/v1/activities?leadId=${aiLeadId}`)
      .set(auth(adminToken));
    expect(all.body.data.length).toBe(2);
    expect(all.body.data.find((a: { id: string }) => a.id === aiId).ai_generated).toBe(true);

    // includeAi=0: only the human row survives.
    const humanOnly = await api
      .get(`/api/v1/activities?leadId=${aiLeadId}&includeAi=0`)
      .set(auth(adminToken));
    expect(humanOnly.body.data.length).toBe(1);
    expect(humanOnly.body.data[0].ai_generated).toBe(false);

    // Count mirrors the same filter.
    const countAll = await api
      .get(`/api/v1/activities/count?leadId=${aiLeadId}`)
      .set(auth(adminToken));
    const countHuman = await api
      .get(`/api/v1/activities/count?leadId=${aiLeadId}&includeAi=0`)
      .set(auth(adminToken));
    expect(countAll.body.data.total).toBe(2);
    expect(countHuman.body.data.total).toBe(1);

    await db.deleteFrom("leads").where("id", "=", aiLeadId).execute();
  });

  it("denies the activities module to FINANCE", async () => {
    const res = await api.get("/api/v1/activities").set(auth(financeToken));
    expect(res.status).toBe(403);
  });
});

describe("tasks", () => {
  it("requires a title and a valid priority", async () => {
    const missing = await api.post("/api/v1/activities/tasks").set(auth(adminToken)).send({});
    expect(missing.status).toBe(400);

    const badPriority = await api
      .post("/api/v1/activities/tasks")
      .set(auth(adminToken))
      .send({ title: `Bad priority ${MARKER}`, priority: "URGENT-ISH" });
    expect(badPriority.status).toBe(400);
  });

  it("creates a task with defaults (MEDIUM priority, owner = caller, OPEN)", async () => {
    const res = await api
      .post("/api/v1/activities/tasks")
      .set(auth(adminToken))
      .send({ title: `Follow up ${MARKER}` });
    expect(res.status).toBe(201);
    const task = res.body.data;
    createdTaskIds.push(task.id);
    expect(task.status).toBe("OPEN");
    expect(task.priority).toBe("MEDIUM");
    expect(task.owner_id).toBe(adminUserId);
    expect(task.due_at).toBeTruthy();
  });

  it("creates a HIGH priority task with an explicit due date", async () => {
    const due = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const res = await api
      .post("/api/v1/activities/tasks")
      .set(auth(adminToken))
      .send({ title: `Send contract ${MARKER}`, priority: "HIGH", due_at: due });
    expect(res.status).toBe(201);
    createdTaskIds.push(res.body.data.id);
    expect(res.body.data.priority).toBe("HIGH");
    expect(new Date(res.body.data.due_at).getTime()).toBe(new Date(due).getTime());
  });

  it("lists tasks filtered by status", async () => {
    const res = await api.get("/api/v1/activities/tasks/list?status=OPEN").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.every((t: { status: string }) => t.status === "OPEN")).toBe(true);
    const ids = res.body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(createdTaskIds[0]);

    const bad = await api
      .get("/api/v1/activities/tasks/list?status=NOT_A_STATUS")
      .set(auth(adminToken));
    expect(bad.status).toBe(400);
  });

  it("completes a task (DONE + completed_at)", async () => {
    const taskId = createdTaskIds[0];
    const res = await api
      .post(`/api/v1/activities/tasks/${taskId}/complete`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("DONE");
    expect(res.body.data.completed_at).toBeTruthy();
  });

  it("returns 404 when another tenant completes the task", async () => {
    const res = await api
      .post(`/api/v1/activities/tasks/${createdTaskIds[1]}/complete`)
      .set(auth(esAdminToken));
    expect(res.status).toBe(404);
  });
});

describe("activity edit and delete", () => {
  it("edits an activity's subject, notes and type", async () => {
    const created = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ type: "NOTE", subject: `Original ${MARKER}`, notes: "before" });
    expect(created.status).toBe(201);
    const activityId = created.body.data.id;
    createdActivityIds.push(activityId);

    const updated = await api
      .put(`/api/v1/activities/${activityId}`)
      .set(auth(adminToken))
      .send({ type: "MEETING", subject: `Updated ${MARKER}`, notes: "after" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.type).toBe("MEETING");
    expect(updated.body.data.subject).toBe(`Updated ${MARKER}`);
    expect(updated.body.data.notes).toBe("after");
  });

  it("rejects an invalid type on edit", async () => {
    const created = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ type: "NOTE", subject: `Edit-guard ${MARKER}` });
    createdActivityIds.push(created.body.data.id);
    const res = await api
      .put(`/api/v1/activities/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ type: "PIGEON" });
    expect(res.status).toBe(400);
  });

  it("deletes an activity and 404s cross-tenant", async () => {
    const created = await api
      .post("/api/v1/activities")
      .set(auth(adminToken))
      .send({ type: "NOTE", subject: `Delete me ${MARKER}` });
    const activityId = created.body.data.id;

    const crossTenant = await api
      .delete(`/api/v1/activities/${activityId}`)
      .set(auth(esAdminToken));
    expect(crossTenant.status).toBe(404);

    const del = await api.delete(`/api/v1/activities/${activityId}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    const gone = await db
      .selectFrom("activities")
      .select("id")
      .where("id", "=", activityId)
      .executeTakeFirst();
    expect(gone).toBeUndefined();
  });
});

describe("task edit and delete", () => {
  it("edits a task's title, priority and status", async () => {
    const created = await api
      .post("/api/v1/activities/tasks")
      .set(auth(adminToken))
      .send({ title: `Edit task ${MARKER}` });
    const taskId = created.body.data.id;
    createdTaskIds.push(taskId);

    const updated = await api
      .put(`/api/v1/activities/tasks/${taskId}`)
      .set(auth(adminToken))
      .send({ title: `Edited task ${MARKER}`, priority: "HIGH", status: "DONE" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe(`Edited task ${MARKER}`);
    expect(updated.body.data.priority).toBe("HIGH");
    expect(updated.body.data.status).toBe("DONE");
    expect(updated.body.data.completed_at).toBeTruthy();
  });

  it("deletes a task and 404s cross-tenant", async () => {
    const created = await api
      .post("/api/v1/activities/tasks")
      .set(auth(adminToken))
      .send({ title: `Delete task ${MARKER}` });
    const taskId = created.body.data.id;

    const crossTenant = await api
      .delete(`/api/v1/activities/tasks/${taskId}`)
      .set(auth(esAdminToken));
    expect(crossTenant.status).toBe(404);

    const del = await api.delete(`/api/v1/activities/tasks/${taskId}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    const gone = await db
      .selectFrom("tasks")
      .select("id")
      .where("id", "=", taskId)
      .executeTakeFirst();
    expect(gone).toBeUndefined();
  });
});
