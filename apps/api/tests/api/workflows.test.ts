import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_FINANCE, login } from "../helpers";

const MARKER = `WF Test ${Date.now()}`;
const TASK_TITLE = `Task for ${MARKER}`;

let adminToken: string;
let esAdminToken: string;
let financeToken: string;
let workflowId: string;
const createdWorkflowIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
});

afterAll(async () => {
  // Audit writes are fire-and-forget; give them a beat to land before cleanup.
  await new Promise((r) => setTimeout(r, 250));
  await db.deleteFrom("automation_runs").where("workflow_name", "=", MARKER).execute();
  await db.deleteFrom("tasks").where("title", "=", TASK_TITLE).execute();
  for (const id of createdWorkflowIds) {
    await db.deleteFrom("audit_logs").where("entity_id", "=", id).execute();
    await db.deleteFrom("workflows").where("id", "=", id).execute();
  }
  await closeDB();
});

describe("workflows module", () => {
  it("GET /catalogue returns triggers and actions", async () => {
    const res = await api.get("/api/v1/workflows/catalogue").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.triggers).toEqual(
      expect.arrayContaining(["lead.created", "deal.won", "ticket.created", "form.submitted"])
    );
    expect(res.body.data.actions).toEqual(
      expect.arrayContaining(["ASSIGN_AGENT", "SEND_WHATSAPP", "CREATE_TASK", "NOTIFY"])
    );
  });

  it("lists tenant workflows with parsed actions", async () => {
    const res = await api.get("/api/v1/workflows").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    for (const wf of res.body.data) {
      expect(Array.isArray(wf.actions)).toBe(true);
      expect(wf.trigger).toBeTruthy();
    }
  });

  it("FINANCE role cannot access workflows", async () => {
    const res = await api.get("/api/v1/workflows").set(auth(financeToken));
    expect(res.status).toBe(403);
  });

  it("rejects creation without name/trigger and with unknown trigger", async () => {
    const missing = await api
      .post("/api/v1/workflows")
      .set(auth(adminToken))
      .send({ trigger: "lead.created" });
    expect(missing.status).toBe(400);

    const unknown = await api
      .post("/api/v1/workflows")
      .set(auth(adminToken))
      .send({ name: "Bad", trigger: "not.a.trigger" });
    expect(unknown.status).toBe(400);
  });

  it("creates a workflow", async () => {
    const res = await api
      .post("/api/v1/workflows")
      .set(auth(adminToken))
      .send({
        name: MARKER,
        trigger: "form.submitted",
        actions: [{ type: "CREATE_TASK", params: { title: TASK_TITLE, dueInDays: 1 } }],
      });
    expect(res.status).toBe(201);
    const wf = res.body.data;
    workflowId = wf.id;
    createdWorkflowIds.push(wf.id);
    expect(wf.name).toBe(MARKER);
    expect(wf.trigger).toBe("form.submitted");
    expect(wf.active).toBe(true);
    expect(wf.run_count).toBe(0);
    expect(wf.actions[0].type).toBe("CREATE_TASK");
  });

  it("test-fires the workflow against the most recent lead", async () => {
    const res = await api.post(`/api/v1/workflows/${workflowId}/run`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.fired).toBeGreaterThanOrEqual(1);
    const myRun = res.body.data.runs.find(
      (r: { workflowName: string }) => r.workflowName === MARKER
    );
    expect(myRun).toBeTruthy();
    expect(myRun.event).toBe("form.submitted");
    expect(myRun.log).toContain("Created task");

    const task = await db
      .selectFrom("tasks")
      .selectAll()
      .where("title", "=", TASK_TITLE)
      .executeTakeFirst();
    expect(task).toBeTruthy();
    expect(task?.status).toBe("OPEN");

    const list = await api.get("/api/v1/workflows").set(auth(adminToken));
    const fresh = list.body.data.find((w: { id: string }) => w.id === workflowId);
    expect(fresh.run_count).toBeGreaterThanOrEqual(1);
    expect(fresh.last_run_at).toBeTruthy();
  });

  it("GET /runs returns latest-first runs with parsed logs", async () => {
    const res = await api.get("/api/v1/workflows/runs").set(auth(adminToken));
    expect(res.status).toBe(200);
    const runs = res.body.data;
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.length).toBeLessThanOrEqual(100);
    const mine = runs.find((r: { workflow_name: string }) => r.workflow_name === MARKER);
    expect(mine).toBeTruthy();
    expect(Array.isArray(mine.log)).toBe(true);
    const first = new Date(runs[0].created_at).getTime();
    const last = new Date(runs[runs.length - 1].created_at).getTime();
    expect(first).toBeGreaterThanOrEqual(last);
  });

  it("updates name, actions and active flag", async () => {
    const res = await api
      .put(`/api/v1/workflows/${workflowId}`)
      .set(auth(adminToken))
      .send({ name: `${MARKER} updated`, active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(`${MARKER} updated`);
    expect(res.body.data.active).toBe(false);
    // unchanged fields stay intact
    expect(res.body.data.trigger).toBe("form.submitted");
  });

  it("cross-tenant access returns 404", async () => {
    const update = await api
      .put(`/api/v1/workflows/${workflowId}`)
      .set(auth(esAdminToken))
      .send({ name: "hijack" });
    expect(update.status).toBe(404);

    const fire = await api.post(`/api/v1/workflows/${workflowId}/run`).set(auth(esAdminToken));
    expect(fire.status).toBe(404);

    const del = await api.delete(`/api/v1/workflows/${workflowId}`).set(auth(esAdminToken));
    expect(del.status).toBe(404);
  });

  it("deletes the workflow", async () => {
    const res = await api.delete(`/api/v1/workflows/${workflowId}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const gone = await api
      .put(`/api/v1/workflows/${workflowId}`)
      .set(auth(adminToken))
      .send({ name: "ghost" });
    expect(gone.status).toBe(404);
  });
});
