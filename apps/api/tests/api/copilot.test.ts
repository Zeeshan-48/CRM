import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, login } from "../helpers";

const MARKER = `copilot-${Date.now()}`;
const LEAD_NAME = `Hot Isolation Lead ${MARKER}`;
const testStart = new Date();

let adminToken: string;
let esAdminToken: string;
let nwTenantId: string;
let isolationLeadId: string;

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;

  // A lead engineered to score 65+ live (Referral source, positive notes,
  // budget, fresh activity) so the hot-leads intent must surface it.
  const now = new Date();
  isolationLeadId = ulid();
  await db
    .insertInto("leads")
    .values({
      id: isolationLeadId,
      tenant_id: nwTenantId,
      name: LEAD_NAME,
      email: "isolation@example.com",
      phone: "",
      city: "Bengaluru",
      country: "India",
      source: "Referral",
      campaign: "",
      status: "NEW",
      owner_id: null,
      tags: JSON.stringify(["a", "b", "c"]),
      notes: "very interested ready to buy demo pricing",
      budget: true,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();
});

afterAll(async () => {
  // copilot.ask audits are fire-and-forget; let them land, then sweep the
  // window this suite created (suites run sequentially, so it is ours).
  await new Promise((r) => setTimeout(r, 250));
  await db
    .deleteFrom("audit_logs")
    .where("action", "=", "copilot.ask")
    .where("created_at", ">=", testStart)
    .execute();
  await db.deleteFrom("leads").where("id", "=", isolationLeadId).execute();
  await closeDB();
});

describe("copilot module", () => {
  it("GET /suggestions returns the suggestion list", async () => {
    const res = await api.get("/api/v1/copilot/suggestions").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.arrayContaining([
        "Which leads are hot right now?",
        "Show all hot leads from Bengaluru who attended a demo but haven't purchased.",
        "Which deals are likely to close and what's the forecast?",
        "Which agents are underperforming?",
        "Show inactive customers from the last 30 days.",
        "Which support tickets are overdue?",
      ])
    );
  });

  it("answers a hot-leads question over tenant data", async () => {
    const query = `Which leads are hot right now? ${MARKER}`;
    const res = await api.post("/api/v1/copilot/ask").set(auth(adminToken)).send({ query });
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.question).toBe(query);
    expect(data.intent).toBe("hot_leads");
    expect(data.columns).toEqual(["Name", "City", "Source", "Score", "Grade"]);
    expect(
      data.rows.some((row: Array<string | number>) => String(row[0]).includes(MARKER))
    ).toBe(true);
  });

  it("never leaks another tenant's records", async () => {
    const res = await api
      .post("/api/v1/copilot/ask")
      .set(auth(esAdminToken))
      .send({ query: "Which leads are hot right now?" });
    expect(res.status).toBe(200);
    expect(
      res.body.data.rows.some((row: Array<string | number>) => String(row[0]).includes(MARKER))
    ).toBe(false);
  });

  it("answers a forecast question", async () => {
    const res = await api
      .post("/api/v1/copilot/ask")
      .set(auth(adminToken))
      .send({ query: "Which deals are likely to close and what's the forecast?" });
    expect(res.status).toBe(200);
    expect(res.body.data.intent).toBe("forecast");
    expect(res.body.data.answer).toContain("Weighted pipeline");
  });

  it("answers a tickets question", async () => {
    const res = await api
      .post("/api/v1/copilot/ask")
      .set(auth(adminToken))
      .send({ query: "Which support tickets are overdue?" });
    expect(res.status).toBe(200);
    expect(res.body.data.intent).toBe("tickets");
    expect(res.body.data.columns).toEqual(["Subject", "Priority", "Status", "SLA"]);
  });

  it("requires a query", async () => {
    const res = await api.post("/api/v1/copilot/ask").set(auth(adminToken)).send({});
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated asks", async () => {
    const res = await api.post("/api/v1/copilot/ask").send({ query: "anything" });
    expect(res.status).toBe(401);
  });

  it("audits copilot.ask with the question and intent", async () => {
    let found: { meta: unknown } | undefined;
    for (let i = 0; i < 20 && !found; i++) {
      const rows = await db
        .selectFrom("audit_logs")
        .select(["meta"])
        .where("tenant_id", "=", nwTenantId)
        .where("action", "=", "copilot.ask")
        .where("created_at", ">=", testStart)
        .execute();
      found = rows.find((r) => {
        const meta = r.meta as { q?: string; intent?: string } | null;
        return !!meta?.q?.includes(MARKER) && meta.intent === "hot_leads";
      });
      if (!found) await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toBeTruthy();
  });
});
