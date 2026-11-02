import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { executeToolPlan, type ToolResult } from "../../src/services/ai/copilot-tools";
import { NW_ADMIN, ACME_ADMIN } from "../helpers";

const MARKER = `tools-${Date.now()}`;
const CITY = `Toolville${Date.now()}`;

let nwTenantId: string;
let esTenantId: string;
let leadId: string;
let activityId: string;

const tenantOf = async (email: string): Promise<string> => {
  const row = await db
    .selectFrom("users")
    .select(["tenant_id"])
    .where("email", "=", email)
    .executeTakeFirstOrThrow();
  return row.tenant_id;
};

const run = async (tenantId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> =>
  (await executeToolPlan(tenantId, [{ name, args }]))[0];

beforeAll(async () => {
  nwTenantId = await tenantOf(NW_ADMIN.email);
  esTenantId = await tenantOf(ACME_ADMIN.email);

  const now = new Date();
  leadId = ulid();
  await db
    .insertInto("leads")
    .values({
      id: leadId,
      tenant_id: nwTenantId,
      name: `Tool Lead ${MARKER}`,
      email: "toollead@example.com",
      phone: "",
      city: CITY,
      country: "India",
      source: "Referral",
      campaign: "",
      status: "NEW",
      owner_id: null,
      tags: JSON.stringify([]),
      notes: "seeded for tool tests",
      budget: true,
      score_total: 90,
      score_grade: "HOT",
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();

  activityId = ulid();
  await db
    .insertInto("activities")
    .values({
      id: activityId,
      tenant_id: nwTenantId,
      type: "DEMO",
      lead_id: leadId,
      created_at: now,
      updated_at: now,
    })
    .execute();
});

afterAll(async () => {
  await db.deleteFrom("activities").where("id", "=", activityId).execute();
  await db.deleteFrom("leads").where("id", "=", leadId).execute();
  await closeDB();
});

describe("copilot tools, queryLeads", () => {
  it("finds a seeded lead by city and returns the documented columns", async () => {
    const res = await run(nwTenantId, "queryLeads", { city: CITY });
    expect(res.columns).toEqual(["Name", "City", "Source", "Score", "Grade", "Status"]);
    expect(res.rows.some((r) => String(r[0]).includes(MARKER))).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(1);
  });

  it("respects the grade + hasDemo filters", async () => {
    const res = await run(nwTenantId, "queryLeads", { grade: "HOT", hasDemo: true, city: CITY });
    expect(res.rows.some((r) => String(r[0]).includes(MARKER))).toBe(true);
  });

  it("never leaks the lead to another tenant", async () => {
    const res = await run(esTenantId, "queryLeads", { city: CITY });
    expect(res.rows.some((r) => String(r[0]).includes(MARKER))).toBe(false);
  });

  it("ignores an invalid enum arg instead of throwing", async () => {
    const res = await run(nwTenantId, "queryLeads", { grade: "NONSENSE", city: CITY });
    expect(res.note).toBeUndefined();
    // grade dropped → the HOT lead still comes back
    expect(res.rows.some((r) => String(r[0]).includes(MARKER))).toBe(true);
  });
});

describe("copilot tools, aggregate", () => {
  it("counts leads grouped by source (our Referral bucket is present)", async () => {
    const res = await run(nwTenantId, "aggregate", {
      entity: "leads",
      metric: "count",
      groupBy: "source",
    });
    expect(res.columns).toEqual(["Source", "Count"]);
    const referral = res.rows.find((r) => r[0] === "Referral");
    expect(referral).toBeDefined();
    expect(Number(referral?.[1])).toBeGreaterThanOrEqual(1);
  });

  it("returns a single scalar when ungrouped", async () => {
    const res = await run(nwTenantId, "aggregate", { entity: "leads", metric: "count" });
    expect(res.columns).toEqual(["Count"]);
    expect(res.rows).toHaveLength(1);
    expect(Number(res.rows[0][0])).toBeGreaterThanOrEqual(1);
  });

  it("rejects a value metric on a non-deal entity with a note", async () => {
    const res = await run(nwTenantId, "aggregate", { entity: "leads", metric: "sum_value" });
    expect(res.rows).toHaveLength(0);
    expect(res.note).toContain("only valid for deals");
  });

  it("rejects an unsupported groupBy with a helpful note", async () => {
    const res = await run(nwTenantId, "aggregate", { entity: "tickets", groupBy: "owner" });
    expect(res.note).toContain("cannot group");
  });
});

describe("copilot tools, smoke + orchestration", () => {
  it("every read tool runs without error and returns columns", async () => {
    for (const name of ["queryDeals", "queryTickets", "queryContacts", "agentPerformance"]) {
      const res = await run(nwTenantId, name, {});
      expect(Array.isArray(res.columns)).toBe(true);
      expect(Array.isArray(res.rows)).toBe(true);
    }
  });

  it("degrades an unknown tool to a note instead of throwing", async () => {
    const res = await run(nwTenantId, "dropTables", {});
    expect(res.note).toBe("unknown tool");
    expect(res.rows).toEqual([]);
  });

  it("caps a plan at 4 tool calls", async () => {
    const calls = Array.from({ length: 7 }, () => ({ name: "aggregate", args: { entity: "leads" } }));
    const results = await executeToolPlan(nwTenantId, calls);
    expect(results).toHaveLength(4);
  });
});
