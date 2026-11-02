import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_FINANCE,
  NW_SALES,
  login,
} from "../helpers";

let adminToken: string;
let salesToken: string;
let financeToken: string;
let esAdminToken: string;
const createdLeadIds: string[] = [];
const createdUserIds: string[] = [];
// Cleaned up in afterAll, not inline after the assertions. Inline deletes are
// skipped when an expect() above them fails, and the conversion test then leaves
// a deal on the workspace forever, which is how a stray "Convert - Deal" ended up
// breaking the pipeline-board test in a different file.
const createdDealIds: string[] = [];
const createdContactIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
});

afterAll(async () => {
  // Deals before contacts before leads: the child rows reference the parents.
  for (const id of createdDealIds) {
    await db.deleteFrom("deals").where("id", "=", id).execute();
  }
  for (const id of createdContactIds) {
    await db.deleteFrom("contacts").where("id", "=", id).execute();
  }
  for (const id of createdLeadIds) {
    await db.deleteFrom("leads").where("id", "=", id).execute();
  }
  for (const id of createdUserIds) {
    await db.deleteFrom("users").where("id", "=", id).execute();
  }
  await closeDB();
});

describe("health and auth", () => {
  it("GET /api/health is public", async () => {
    const res = await api.get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("does not list workspaces to anonymous callers", async () => {
    const res = await api.get("/api/v1/auth/tenants");
    expect(res.status).toBe(404);
  });

  it("rejects bad credentials with 401", async () => {
    const res = await api
      .post("/api/v1/auth/login")
      .send({ email: NW_ADMIN.email, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("login returns token, modules and tenant branding", async () => {
    const res = await api.post("/api/v1/auth/login").send(NW_ADMIN);
    expect(res.status).toBe(200);
    const { token, user } = res.body.data;
    expect(token).toBeTruthy();
    expect(user.role).toBe("ADMIN");
    // Visible modules are role modules intersected with tenant entitlements;
    // an ENTERPRISE admin sees every module but never the raw "*" marker.
    expect(user.modules).toContain("leads");
    expect(user.modules).toContain("agents");
    expect(user.modules).not.toContain("*");
    expect(user.tenant.slug).toBe("northwind");
    expect(user.tenant.brand_color).toBe("#b6207f");
  });

  it("GET /auth/me returns the current user", async () => {
    const res = await api.get("/api/v1/auth/me").set(auth(salesToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe("SALES_AGENT");
    expect(res.body.data.user.modules).toContain("leads");
    expect(res.body.data.user.modules).not.toContain("finance");
  });

  it("rejects missing/garbage tokens", async () => {
    expect((await api.get("/api/v1/leads")).status).toBe(401);
    expect((await api.get("/api/v1/leads").set(auth("garbage"))).status).toBe(401);
  });
});

describe("tenant workspace", () => {
  it("GET /tenant/me returns tenant, usage and entitled modules", async () => {
    const res = await api.get("/api/v1/tenant/me").set(auth(adminToken));
    expect(res.status).toBe(200);
    const { tenant, usage, modules, limits } = res.body.data;
    expect(tenant.slug).toBe("northwind");
    expect(usage.users).toBeGreaterThanOrEqual(7);
    expect(usage.leads).toBeGreaterThanOrEqual(12);
    expect(modules).toContain("agents");
    expect(limits.seats).toBe(200);
  });

  it("GROWTH tenant is not entitled to agents", async () => {
    const res = await api.get("/api/v1/tenant/me").set(auth(esAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.modules).not.toContain("agents");
    expect(res.body.data.modules).toContain("whatsapp");
  });

  it("PUT /tenant/me requires ADMIN", async () => {
    const denied = await api
      .put("/api/v1/tenant/me")
      .set(auth(salesToken))
      .send({ brand_color: "#000000" });
    expect(denied.status).toBe(403);

    const ok = await api
      .put("/api/v1/tenant/me")
      .set(auth(adminToken))
      .send({ brand_color: "#0a66c2" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.brand_color).toBe("#0a66c2");
  });

  it("GET /tenant/plans lists operator-managed plans", async () => {
    const res = await api.get("/api/v1/tenant/plans").set(auth(adminToken));
    expect(res.status).toBe(200);
    const keys = res.body.data.map((p: { key: string }) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["STARTER", "GROWTH", "ENTERPRISE"]));
  });
});

describe("users and roles", () => {
  it("lists tenant users with resolved permissions", async () => {
    const res = await api.get("/api/v1/users").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(7);
    const sales = res.body.data.find((u: { email: string }) => u.email === NW_SALES.email);
    expect(sales.permissions).toContain("leads");
  });

  it("roles catalogue includes builtin, modules and the custom Closer role", async () => {
    const res = await api.get("/api/v1/users/roles").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.builtin).toContain("SALES_AGENT");
    expect(res.body.data.modules).toContain("whatsapp");
    const custom = res.body.data.custom.map((r: { key: string }) => r.key);
    expect(custom).toContain("CLOSER");
  });

  it("creating users is manager+ only and enforces unique email", async () => {
    const denied = await api
      .post("/api/v1/users")
      .set(auth(salesToken))
      .send({ name: "X", email: "x@northwind.example.com", role: "SALES_AGENT" });
    expect(denied.status).toBe(403);

    const created = await api
      .post("/api/v1/users")
      .set(auth(adminToken))
      .send({ name: "Test Agent", email: "test.agent@northwind.example.com", role: "SALES_AGENT" });
    expect(created.status).toBe(201);
    createdUserIds.push(created.body.data.id);

    const dup = await api
      .post("/api/v1/users")
      .set(auth(adminToken))
      .send({ name: "Test Agent 2", email: "test.agent@northwind.example.com", role: "SALES_AGENT" });
    expect(dup.status).toBe(409);
  });
});

describe("leads module", () => {
  it("lists seeded leads sorted by stored AI score", async () => {
    const res = await api.get("/api/v1/leads").set(auth(adminToken));
    expect(res.status).toBe(200);
    const { leads, total } = res.body.data;
    expect(total).toBeGreaterThanOrEqual(12);
    expect(leads[0].score.total).toBeGreaterThanOrEqual(leads[1].score.total);
    expect(leads[0].score_grade).toBeDefined();
  });

  it("filters by grade, source and q", async () => {
    const hot = await api.get("/api/v1/leads?grade=HOT").set(auth(adminToken));
    expect(hot.body.data.leads.every((l: { score_grade: string }) => l.score_grade === "HOT")).toBe(true);

    const wa = await api.get("/api/v1/leads?source=WhatsApp").set(auth(adminToken));
    expect(wa.body.data.leads.every((l: { source: string }) => l.source === "WhatsApp")).toBe(true);

    const q = await api.get("/api/v1/leads?q=Sneha").set(auth(adminToken));
    expect(q.body.data.leads.length).toBeGreaterThanOrEqual(1);
  });

  it("exposes sources and assignment strategies", async () => {
    const sources = await api.get("/api/v1/leads/sources").set(auth(adminToken));
    expect(sources.body.data).toContain("WhatsApp");
    const strategies = await api.get("/api/v1/leads/assignment-strategies").set(auth(adminToken));
    expect(strategies.body.data).toEqual(
      expect.arrayContaining(["ROUND_ROBIN", "AI", "SKILL_BASED", "TERRITORY_BASED", "MANUAL"])
    );
  });

  it("capturing a lead fires the lead.created workflow (assign + WhatsApp + task)", async () => {
    const res = await api.post("/api/v1/leads").set(auth(adminToken)).send({
      name: "Workflow Test Lead",
      email: "wf@example.com",
      city: "Bengaluru",
      source: "WhatsApp",
      notes: "interested in pricing, wants demo",
      budget: true,
    });
    expect(res.status).toBe(201);
    const lead = res.body.data;
    createdLeadIds.push(lead.id);
    expect(lead.automationRuns).toBeGreaterThanOrEqual(1);
    expect(lead.owner_id).toBeTruthy();
    expect(lead.score.total).toBeGreaterThan(0);

    const detail = await api.get(`/api/v1/leads/${lead.id}`).set(auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.messages.length).toBeGreaterThanOrEqual(1);
    // The welcome workflow sends both an email and a WhatsApp message, so assert
    // the WhatsApp message is present rather than assuming timeline position.
    expect(
      detail.body.data.messages.some((m: { channel: string }) => m.channel === "WHATSAPP")
    ).toBe(true);

    const task = await db
      .selectFrom("tasks")
      .selectAll()
      .where("lead_id", "=", lead.id)
      .executeTakeFirst();
    expect(task).toBeTruthy();
    if (task) {
      await db.deleteFrom("tasks").where("id", "=", task.id).execute();
    }
  });

  it("requires at least name, email or phone", async () => {
    const res = await api.post("/api/v1/leads").set(auth(adminToken)).send({ city: "Pune" });
    expect(res.status).toBe(400);
  });

  it("supports territory and skill based assignment", async () => {
    const created = await api.post("/api/v1/leads").set(auth(adminToken)).send({
      name: "Territory Lead",
      city: "Mumbai",
      source: "LinkedIn Forms",
    });
    createdLeadIds.push(created.body.data.id);

    const territory = await api
      .post(`/api/v1/leads/${created.body.data.id}/assign`)
      .set(auth(adminToken))
      .send({ strategy: "TERRITORY_BASED" });
    expect(territory.status).toBe(200);
    // Mumbai is in Neha's territory (Northwind tenant).
    expect(territory.body.data.owner.name).toBe("Neha");

    const skill = await api
      .post(`/api/v1/leads/${created.body.data.id}/assign`)
      .set(auth(adminToken))
      .send({ strategy: "SKILL_BASED" });
    expect(skill.status).toBe(200);
    expect(skill.body.data.owner.name).toBe("Neha"); // LinkedIn Forms skill
  });

  it("AI assignment routes to a real agent with an explainable reason", async () => {
    const created = await api.post("/api/v1/leads").set(auth(adminToken)).send({
      name: "AI Route Lead",
      city: "Mumbai",
      source: "LinkedIn Forms",
    });
    createdLeadIds.push(created.body.data.id);

    const ai = await api
      .post(`/api/v1/leads/${created.body.data.id}/assign`)
      .set(auth(adminToken))
      .send({ strategy: "AI" });
    expect(ai.status).toBe(200);
    expect(ai.body.data.strategy).toBe("AI");
    // Score-based router, not a stub: it picks a real active sales agent and
    // returns a human-readable reason for the choice.
    expect(ai.body.data.owner.id).toBeTruthy();
    expect(ai.body.data.owner.name).toBeTruthy();
    expect(typeof ai.body.data.reason).toBe("string");
    expect(ai.body.data.reason.length).toBeGreaterThan(0);
  });

  it("bulk import, bulk tag and bulk delete are tenant-scoped", async () => {
    const imported = await api
      .post("/api/v1/leads/bulk")
      .set(auth(adminToken))
      .send({
        rows: [
          { name: "Bulk One", email: "b1@example.com", city: "Pune" },
          { name: "Bulk Two", email: "b2@example.com", city: "Delhi" },
        ],
      });
    expect(imported.status).toBe(201);
    expect(imported.body.data.imported).toBe(2);

    const list = await api.get("/api/v1/leads?q=Bulk").set(auth(adminToken));
    const ids = list.body.data.leads.map((l: { id: string }) => l.id);
    expect(ids.length).toBe(2);

    const tagged = await api
      .post("/api/v1/leads/bulk-action")
      .set(auth(adminToken))
      .send({ ids, action: "tag", value: "test-bulk" });
    expect(tagged.body.data.affected).toBe(2);

    // Another tenant cannot bulk-delete these ids.
    const crossDelete = await api
      .post("/api/v1/leads/bulk-action")
      .set(auth(esAdminToken))
      .send({ ids, action: "delete" });
    expect(crossDelete.body.data.affected).toBe(0);

    const deleted = await api
      .post("/api/v1/leads/bulk-action")
      .set(auth(adminToken))
      .send({ ids, action: "delete" });
    expect(deleted.body.data.affected).toBe(2);
  });

  it("exports CSV", async () => {
    const res = await api.get("/api/v1/leads/export.csv").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split("\n")[0]).toBe("name,email,phone,city,source,status,score");
    expect(res.text.split("\n").length).toBeGreaterThan(5);
  });

  it("manages lead documents", async () => {
    const lead = await api
      .post("/api/v1/leads")
      .set(auth(adminToken))
      .send({ name: "Doc Lead", email: "doc@example.com" });
    createdLeadIds.push(lead.body.data.id);

    const doc = await api
      .post(`/api/v1/leads/${lead.body.data.id}/documents`)
      .set(auth(adminToken))
      .send({ name: "KYC.pdf", doc_type: "kyc", url: "https://example.com/kyc.pdf" });
    expect(doc.status).toBe(201);

    const docs = await api
      .get(`/api/v1/leads/${lead.body.data.id}/documents`)
      .set(auth(adminToken));
    expect(docs.body.data.length).toBe(1);
    expect(docs.body.data[0].name).toBe("KYC.pdf");
  });

  it("converts a lead into a contact plus deal", async () => {
    const lead = await api
      .post("/api/v1/leads")
      .set(auth(adminToken))
      .send({ name: "Convert Me", email: "convert@example.com", city: "Chennai" });
    createdLeadIds.push(lead.body.data.id);

    const converted = await api
      .post(`/api/v1/leads/${lead.body.data.id}/convert`)
      .set(auth(adminToken))
      .send({ createDeal: true, value: 75000 });
    expect(converted.status).toBe(201);
    // Registered for cleanup BEFORE the assertions, so a failure below cannot
    // strand the rows on the shared workspace.
    createdDealIds.push(converted.body.data.deal.id);
    createdContactIds.push(converted.body.data.contact.id);

    // Conversion makes a PROSPECT. The contact only becomes a CUSTOMER when a deal
    // is actually won, so asserting CUSTOMER here would lock in the wrong model.
    expect(converted.body.data.contact.lifecycle).toBe("PROSPECT");
    expect(converted.body.data.deal.value).toBe(75000);
    expect(converted.body.data.deal.status).toBe("OPEN");
    // A converted deal must arrive with its stored AI fields populated, same as a
    // deal created through POST /deals.
    expect(converted.body.data.deal.health_label).toBeTruthy();
    expect(typeof converted.body.data.deal.health_score).toBe("number");
    expect(typeof converted.body.data.deal.win_probability).toBe("number");

    const after = await api.get(`/api/v1/leads/${lead.body.data.id}`).set(auth(adminToken));
    expect(after.body.data.status).toBe("CONVERTED");
  });
});

describe("multi-tenant isolation and RBAC", () => {
  it("cross-tenant lead fetch returns 404", async () => {
    const nwLeads = await api.get("/api/v1/leads?limit=1").set(auth(adminToken));
    const leadId = nwLeads.body.data.leads[0].id;
    const res = await api.get(`/api/v1/leads/${leadId}`).set(auth(esAdminToken));
    expect(res.status).toBe(404);
  });

  it("FINANCE role cannot access leads but can access finance", async () => {
    expect((await api.get("/api/v1/leads").set(auth(financeToken))).status).toBe(403);
    // finance module route is implemented in a later slice; the gate must pass
    // (anything but 401/403 means RBAC allowed it).
    const fin = await api.get("/api/v1/finance/summary").set(auth(financeToken));
    expect([200, 404]).toContain(fin.status);
  });

  it("GROWTH tenant admin is blocked from agents by entitlement", async () => {
    const res = await api.get("/api/v1/agents").set(auth(esAdminToken));
    expect(res.status).toBe(403);
  });
});
