import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, login } from "../helpers";

// Exercises the two "fit"-based routing strategies (skill / territory) and the
// workspace default-strategy auto-assignment. Runs against the seeded `northwind`
// tenant where agent "Neha" owns the Mumbai territory and the "LinkedIn Forms"
// skill. The seeded `lead.created` workflow assigns every new lead, so we
// deactivate it for the file to observe auto-assignment in isolation, then
// restore it (and the tenant config) in afterAll.

let adminToken: string;
let tenantId: string;
let savedConfig: unknown = null;
let workflowId: string | null = null;
let workflowWasActive = false;
const createdLeadIds: string[] = [];

const TENANT_ME = "/api/v1/tenant/me";

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id", "config"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  savedConfig = tenant.config ?? null;

  const workflow = await db
    .selectFrom("workflows")
    .select(["id", "active"])
    .where("tenant_id", "=", tenantId)
    .where("trigger", "=", "lead.created")
    .where("active", "=", true)
    .executeTakeFirst();
  if (workflow) {
    workflowId = workflow.id;
    workflowWasActive = workflow.active;
    await db
      .updateTable("workflows")
      .set({ active: false })
      .where("id", "=", workflow.id)
      .execute();
  }
});

afterAll(async () => {
  if (workflowId) {
    await db
      .updateTable("workflows")
      .set({ active: workflowWasActive })
      .where("id", "=", workflowId)
      .execute();
  }
  await db
    .updateTable("tenants")
    .set({ config: savedConfig ? JSON.stringify(savedConfig) : null, updated_at: new Date() })
    .where("id", "=", tenantId)
    .execute();
  if (createdLeadIds.length) {
    await db.deleteFrom("leads").where("id", "in", createdLeadIds).execute();
  }
  await closeDB();
});

const createLead = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const res = await api.post("/api/v1/leads").set(auth(adminToken)).send(body);
  expect(res.status).toBe(201);
  createdLeadIds.push(res.body.data.id as string);
  return res.body.data as Record<string, unknown>;
};

const setDefaultStrategy = async (defaultStrategy: string) => {
  const res = await api
    .put(TENANT_ME)
    .set(auth(adminToken))
    .send({ config: { leadAssignment: { defaultStrategy } } });
  expect(res.status).toBe(200);
};

describe("lead assignment strategies", () => {
  it("matches territory case-insensitively", async () => {
    const lead = await createLead({ name: "CI Territory Lead", city: "mumbai" });
    const res = await api
      .post(`/api/v1/leads/${lead.id}/assign`)
      .set(auth(adminToken))
      .send({ strategy: "TERRITORY_BASED" });
    expect(res.status).toBe(200);
    // "mumbai" (lower) must still match Neha's "Mumbai" territory.
    expect(res.body.data.owner.name).toBe("Neha");
  });

  it("matches skill case-insensitively", async () => {
    const lead = await createLead({ name: "CI Skill Lead", source: "linkedin forms" });
    const res = await api
      .post(`/api/v1/leads/${lead.id}/assign`)
      .set(auth(adminToken))
      .send({ strategy: "SKILL_BASED" });
    expect(res.status).toBe(200);
    expect(res.body.data.owner.name).toBe("Neha");
  });

  it("leaves new leads unassigned when the default strategy is MANUAL", async () => {
    await setDefaultStrategy("MANUAL");
    const lead = await createLead({ name: "No Auto Lead", city: "Nowhere", source: "API" });
    expect(lead.owner_id).toBeFalsy();
  });

  it("auto-assigns new leads using the configured default strategy", async () => {
    await setDefaultStrategy("SKILL_BASED");
    const lead = await createLead({ name: "Auto Skill Lead", source: "LinkedIn Forms" });
    expect(lead.owner_id).toBeTruthy();
    // The skill match should route to Neha specifically.
    const owner = await db
      .selectFrom("users")
      .select(["name"])
      .where("id", "=", lead.owner_id as string)
      .executeTakeFirst();
    expect(owner?.name).toBe("Neha");
  });

  it("shallow-merges tenant config so config sections don't clobber each other", async () => {
    await setDefaultStrategy("AI");
    // Write an unrelated config key; the leadAssignment section must survive.
    const marker = await api
      .put(TENANT_ME)
      .set(auth(adminToken))
      .send({ config: { __test_marker: "keep" } });
    expect(marker.status).toBe(200);

    const me = await api.get(TENANT_ME).set(auth(adminToken));
    expect(me.status).toBe(200);
    const config = me.body.data.tenant.config as Record<string, unknown>;
    expect((config.leadAssignment as Record<string, unknown>).defaultStrategy).toBe("AI");
    expect(config.__test_marker).toBe("keep");
  });
});
