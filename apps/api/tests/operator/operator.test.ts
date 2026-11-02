import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEAL_STAGES, DEAL_STAGE_NAMES } from "../../src/constants/deal-stages.const";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, login, ROOT_OPERATOR } from "./helpers";

const marker = Date.now().toString(36);
const MARKER = marker.toUpperCase();
const suiteStart = new Date(Date.now() - 1000);

let rootToken: string;

const createdTenantIds: string[] = [];
const createdOperatorIds: string[] = [];
const createdPlanIds: string[] = [];

// Operator audit writes are fire-and-forget; poll briefly before asserting.
async function waitForAuditRow(filter: {
  action: string;
  tenantId?: string;
  resourceId?: string;
}) {
  for (let i = 0; i < 20; i++) {
    let query = db
      .selectFrom("operator_audit_logs")
      .selectAll()
      .where("action", "=", filter.action)
      .where("created_at", ">=", suiteStart);
    if (filter.tenantId) query = query.where("tenant_id", "=", filter.tenantId);
    if (filter.resourceId) query = query.where("resource_id", "=", filter.resourceId);
    const row = await query.orderBy("created_at", "desc").executeTakeFirst();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 150));
  }
  return undefined;
}

beforeAll(async () => {
  rootToken = await login(ROOT_OPERATOR.email, ROOT_OPERATOR.password);
});

afterAll(async () => {
  // Let trailing fire-and-forget audit writes land before cleanup.
  await new Promise((r) => setTimeout(r, 500));
  for (const id of createdTenantIds) {
    await db.deleteFrom("tenants").where("id", "=", id).execute();
  }
  for (const id of createdOperatorIds) {
    await db.deleteFrom("operator_users").where("id", "=", id).execute();
  }
  for (const id of createdPlanIds) {
    await db.deleteFrom("plans").where("id", "=", id).execute();
  }
  // This suite is the only writer of operator_audit_logs while it runs;
  // remove every row it produced (logins included) by time window.
  await db.deleteFrom("operator_audit_logs").where("created_at", ">=", suiteStart).execute();
  await closeDB();
});

describe("auth", () => {
  it("logs in the seeded root operator", async () => {
    const res = await api
      .post("/api/v1/operator/auth/login")
      .send({ email: ROOT_OPERATOR.email, password: ROOT_OPERATOR.password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe(ROOT_OPERATOR.email);
    expect(res.body.data.user.role).toBe("SUPERADMIN");
    expect(res.body.data.user).not.toHaveProperty("password_hash");
  });

  it("rejects a bad password", async () => {
    const res = await api
      .post("/api/v1/operator/auth/login")
      .send({ email: ROOT_OPERATOR.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("returns the caller on /auth/me and rejects missing tokens", async () => {
    const res = await api.get("/api/v1/operator/auth/me").set(auth(rootToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(ROOT_OPERATOR.email);
    expect(res.body.data.user).not.toHaveProperty("password_hash");

    expect((await api.get("/api/v1/operator/auth/me")).status).toBe(401);
  });
});

describe("plans", () => {
  let planId: string;
  const planKey = `QA_PLAN_${MARKER}`;

  it("lists the seeded plans", async () => {
    const res = await api.get("/api/v1/operator/plans").set(auth(rootToken));
    expect(res.status).toBe(200);
    const keys = res.body.data.map((p: { key: string }) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["STARTER", "GROWTH", "ENTERPRISE"]));
  });

  it("creates a plan", async () => {
    const res = await api
      .post("/api/v1/operator/plans")
      .set(auth(rootToken))
      .send({
        key: planKey,
        name: `QA Plan ${marker}`,
        description: "test plan",
        price_monthly: 999,
        modules: ["leads", "contacts", "deals"],
        limits: { seats: 5, leads: 1000, ai_credits_monthly: 50 },
      });
    expect(res.status).toBe(201);
    planId = res.body.data.id;
    createdPlanIds.push(planId);
    expect(res.body.data.key).toBe(planKey);
    expect(res.body.data.modules).toEqual(["leads", "contacts", "deals"]);
    expect(res.body.data.is_active).toBe(true);
  });

  it("rejects an unknown module key with 400", async () => {
    const res = await api
      .post("/api/v1/operator/plans")
      .set(auth(rootToken))
      .send({
        key: `QA_BAD_${MARKER}`,
        name: "Bad plan",
        price_monthly: 0,
        modules: ["leads", "not_a_module"],
        limits: { seats: 1, leads: 1, ai_credits_monthly: 1 },
      });
    expect(res.status).toBe(400);
  });

  it("updates a plan and keeps inactive plans in the listing", async () => {
    const res = await api
      .put(`/api/v1/operator/plans/${planId}`)
      .set(auth(rootToken))
      .send({ name: `QA Plan ${marker} v2`, price_monthly: 1499, is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(`QA Plan ${marker} v2`);
    expect(res.body.data.price_monthly).toBe(1499);
    expect(res.body.data.is_active).toBe(false);

    const list = await api.get("/api/v1/operator/plans").set(auth(rootToken));
    const keys = list.body.data.map((p: { key: string }) => p.key);
    expect(keys).toContain(planKey);
  });

  it("writes audit rows for plan mutations", async () => {
    const created = await waitForAuditRow({ action: "plan.created", resourceId: planId });
    expect(created).toBeTruthy();
    expect(created?.category).toBe("plans");
    expect(created?.actor_email).toBe(ROOT_OPERATOR.email);

    const updated = await waitForAuditRow({ action: "plan.updated", resourceId: planId });
    expect(updated).toBeTruthy();
  });
});

describe("tenants", () => {
  it("lists tenants with usage counts", async () => {
    const res = await api.get("/api/v1/operator/tenants").set(auth(rootToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    for (const tenant of res.body.data) {
      expect(typeof tenant.usage.users).toBe("number");
      expect(typeof tenant.usage.leads).toBe("number");
    }
    const withUsers = res.body.data.filter(
      (t: { usage: { users: number } }) => t.usage.users >= 1
    );
    expect(withUsers.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by q and validates status", async () => {
    const filtered = await api.get("/api/v1/operator/tenants?status=ACTIVE").set(auth(rootToken));
    expect(filtered.status).toBe(200);
    for (const tenant of filtered.body.data) expect(tenant.status).toBe("ACTIVE");

    expect((await api.get("/api/v1/operator/tenants?status=NOPE").set(auth(rootToken))).status).toBe(400);
  });

  it("returns tenant detail with entitlements, usage and admin users", async () => {
    const list = await api.get("/api/v1/operator/tenants").set(auth(rootToken));
    const someTenant = list.body.data[0];
    const res = await api.get(`/api/v1/operator/tenants/${someTenant.id}`).set(auth(rootToken));
    expect(res.status).toBe(200);
    expect(res.body.data.tenant.id).toBe(someTenant.id);
    expect(Array.isArray(res.body.data.entitlements)).toBe(true);
    expect(typeof res.body.data.usage.users).toBe("number");
    expect(Array.isArray(res.body.data.adminUsers)).toBe(true);
    for (const user of res.body.data.adminUsers) {
      expect(user).not.toHaveProperty("password_hash");
      expect(user.role).toBe("ADMIN");
    }
  });

  it("returns 404 for an unknown tenant id", async () => {
    expect((await api.get("/api/v1/operator/tenants/01UNKNOWNTENANTID00000000").set(auth(rootToken))).status).toBe(
      404
    );
  });
});

describe("tenant onboarding", () => {
  const tenantName = `QA Tenant ${marker}`;
  const adminEmail = `qa-admin-${marker}@example.com`;
  const ADMIN_PASSWORD = `Qa-Admin-${marker}!1`;
  let tenantId: string;

  it("onboards a tenant on the GROWTH plan in one shot", async () => {
    const res = await api
      .post("/api/v1/operator/tenants")
      .set(auth(rootToken))
      .send({
        name: tenantName,
        industry: "EdTech",
        brand_color: "#123456",
        plan_key: "GROWTH",
        admin: { name: "QA Admin", email: adminEmail, password: ADMIN_PASSWORD },
      });
    expect(res.status).toBe(201);
    tenantId = res.body.data.tenant.id;
    createdTenantIds.push(tenantId);

    expect(res.body.data.tenant.slug).toBe(`qa-tenant-${marker}`);
    expect(res.body.data.tenant.plan_key).toBe("GROWTH");
    expect(res.body.data.tenant.brand_color).toBe("#123456");
    expect(res.body.data.adminUser.email).toBe(adminEmail);
    expect(res.body.data.adminUser).not.toHaveProperty("password_hash");

    const codes = res.body.data.entitlements.map((e: { code: string }) => e.code);
    expect(codes).toContain("module.leads");
    expect(codes).toContain("module.whatsapp");
    expect(codes).not.toContain("module.agents");
    const seats = res.body.data.entitlements.find(
      (e: { code: string }) => e.code === "limit.seats"
    );
    expect(seats.limit_value).toBe(25);
    expect(seats.source).toBe("PLAN");
  });

  it("created the admin user with the password the operator supplied", async () => {
    // Onboarding no longer falls back to a shared `admin123`: an operator either
    // supplies a password or one is generated and emailed. The tenant above is
    // created with an explicit password, so this asserts it is what gets hashed.
    const adminUser = await db
      .selectFrom("users")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("email", "=", adminEmail)
      .executeTakeFirstOrThrow();
    expect(adminUser.role).toBe("ADMIN");
    expect(adminUser.status).toBe("ACTIVE");
    expect(await bcrypt.compare(ADMIN_PASSWORD, adminUser.password_hash)).toBe(true);
  });

  it("provisioned the default pipeline with its 7 stages", async () => {
    const pipeline = await db
      .selectFrom("pipelines")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("is_default", "=", true)
      .executeTakeFirstOrThrow();
    expect(pipeline.name).toBe("Sales Pipeline");

    const stages = await db
      .selectFrom("stages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("pipeline_id", "=", pipeline.id)
      .orderBy("sort_order", "asc")
      .execute();
    // Asserted against the shared spec, so onboarding and the deals API can never
    // drift apart without one of them failing loudly.
    expect(stages.map((s) => s.name)).toEqual(DEAL_STAGE_NAMES);
    expect(stages.map((s) => s.sort_order)).toEqual(DEAL_STAGES.map((_, i) => i));
    expect(stages.map((s) => ({ won: s.won, lost: s.lost }))).toEqual(
      DEAL_STAGES.map((s) => ({ won: s.won, lost: s.lost }))
    );
    expect(stages[6].won).toBe(false);
  });

  it("rejects a duplicate slug with 409 and an unknown plan with 400", async () => {
    const dup = await api
      .post("/api/v1/operator/tenants")
      .set(auth(rootToken))
      .send({
        name: "Different Name",
        slug: `qa-tenant-${marker}`,
        plan_key: "GROWTH",
        admin: { name: "X", email: `qa-dup-${marker}@example.com` },
      });
    expect(dup.status).toBe(409);

    const badPlan = await api
      .post("/api/v1/operator/tenants")
      .set(auth(rootToken))
      .send({
        name: `QA Tenant Badplan ${marker}`,
        plan_key: `NOPE_${MARKER}`,
        admin: { name: "X", email: `qa-badplan-${marker}@example.com` },
      });
    expect(badPlan.status).toBe(400);
  });

  it("writes a tenant.created audit row", async () => {
    const row = await waitForAuditRow({ action: "tenant.created", tenantId });
    expect(row).toBeTruthy();
    expect(row?.category).toBe("tenants");
    expect(row?.actor_email).toBe(ROOT_OPERATOR.email);
    expect(row?.summary).toContain(tenantName);
  });

  describe("entitlement overrides and plan change", () => {
    it("upserts an ADMIN-source override over a PLAN row", async () => {
      const res = await api
        .put(`/api/v1/operator/tenants/${tenantId}/entitlements`)
        .set(auth(rootToken))
        .send({ code: "limit.seats", limit_value: 999 });
      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe("ADMIN");
      expect(res.body.data.limit_value).toBe(999);
      expect(res.body.data.enabled).toBe(true);
    });

    it("changes the plan to ENTERPRISE, re-snapshotting PLAN rows only", async () => {
      const res = await api
        .put(`/api/v1/operator/tenants/${tenantId}`)
        .set(auth(rootToken))
        .send({ plan_key: "ENTERPRISE" });
      expect(res.status).toBe(200);
      expect(res.body.data.plan_key).toBe("ENTERPRISE");

      const detail = await api.get(`/api/v1/operator/tenants/${tenantId}`).set(auth(rootToken));
      const entitlements = detail.body.data.entitlements as Array<{
        code: string;
        enabled: boolean;
        limit_value: number | null;
        source: string;
      }>;
      const agents = entitlements.find((e) => e.code === "module.agents");
      expect(agents).toBeTruthy();
      expect(agents?.enabled).toBe(true);
      expect(agents?.source).toBe("PLAN");

      // The ADMIN override survives the plan change untouched.
      const seats = entitlements.find((e) => e.code === "limit.seats");
      expect(seats?.source).toBe("ADMIN");
      expect(seats?.limit_value).toBe(999);
    });

    it("updates an existing override and inserts a brand-new code", async () => {
      const updated = await api
        .put(`/api/v1/operator/tenants/${tenantId}/entitlements`)
        .set(auth(rootToken))
        .send({ code: "limit.seats", limit_value: 500 });
      expect(updated.status).toBe(200);
      expect(updated.body.data.limit_value).toBe(500);
      expect(updated.body.data.source).toBe("ADMIN");

      const inserted = await api
        .put(`/api/v1/operator/tenants/${tenantId}/entitlements`)
        .set(auth(rootToken))
        .send({ code: `limit.qa_custom_${marker}`, limit_value: 7, enabled: true });
      expect(inserted.status).toBe(200);
      expect(inserted.body.data.source).toBe("ADMIN");
      expect(inserted.body.data.limit_value).toBe(7);

      const audit = await waitForAuditRow({ action: "tenant.entitlement_overridden", tenantId });
      expect(audit).toBeTruthy();
    });
  });

  describe("suspension", () => {
    it("suspends the tenant", async () => {
      const res = await api
        .put(`/api/v1/operator/tenants/${tenantId}`)
        .set(auth(rootToken))
        .send({ status: "SUSPENDED" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("SUSPENDED");

      const detail = await api.get(`/api/v1/operator/tenants/${tenantId}`).set(auth(rootToken));
      expect(detail.body.data.tenant.status).toBe("SUSPENDED");

      const audit = await waitForAuditRow({ action: "tenant.updated", tenantId });
      expect(audit).toBeTruthy();
    });
  });
});

describe("metrics", () => {
  it("returns the overview shape from SQL aggregation", async () => {
    const res = await api.get("/api/v1/operator/metrics/overview").set(auth(rootToken));
    expect(res.status).toBe(200);
    const { tenants, planDistribution, totals } = res.body.data;
    expect(typeof tenants.total).toBe("number");
    expect(tenants.total).toBeGreaterThanOrEqual(2);
    expect(typeof tenants.byStatus).toBe("object");
    for (const value of Object.values(tenants.byStatus)) {
      expect(typeof value).toBe("number");
    }
    expect(Array.isArray(planDistribution)).toBe(true);
    expect(planDistribution.length).toBeGreaterThanOrEqual(1);
    for (const entry of planDistribution) {
      expect(typeof entry.plan_key).toBe("string");
      expect(typeof entry.count).toBe("number");
    }
    expect(typeof totals.users).toBe("number");
    expect(typeof totals.leads).toBe("number");
    expect(totals.users).toBeGreaterThanOrEqual(1);
  });
});

describe("audit listing", () => {
  it("filters by tenantId and returns latest first", async () => {
    const tenantId = createdTenantIds[0];
    const res = await api.get(`/api/v1/operator/audit?tenantId=${tenantId}`).set(auth(rootToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    const actions = res.body.data.map((r: { action: string }) => r.action);
    expect(actions).toContain("tenant.created");
    expect(actions).toContain("tenant.updated");
    expect(actions).toContain("tenant.entitlement_overridden");
    for (const row of res.body.data) expect(row.tenant_id).toBe(tenantId);

    const times = res.body.data.map((r: { created_at: string }) =>
      new Date(r.created_at).getTime()
    );
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  it("filters by action", async () => {
    const res = await api.get("/api/v1/operator/audit?action=tenant.created").set(auth(rootToken));
    expect(res.status).toBe(200);
    for (const row of res.body.data) expect(row.action).toBe("tenant.created");
  });
});

describe("operators and RBAC", () => {
  const operatorEmail = `qa-op-${marker}@example.com`;
  let operatorId: string;
  let operatorToken: string;

  it("SUPERADMIN creates an OPERATOR and hands back a usable temp password", async () => {
    const res = await api
      .post("/api/v1/operator/operators")
      .set(auth(rootToken))
      .send({ name: `QA Operator ${marker}`, email: operatorEmail, role: "OPERATOR" });
    expect(res.status).toBe(201);
    operatorId = res.body.data.id;
    createdOperatorIds.push(operatorId);
    expect(res.body.data.role).toBe("OPERATOR");
    expect(res.body.data).not.toHaveProperty("password_hash");

    // The shared `operator123` fallback was removed: a generated password is
    // emailed, and when mail is unconfigured (as under the test runner) it is
    // returned once so the superadmin can pass it on. Without that, a new
    // operator created on a mailless deployment could never sign in, so this
    // asserts the escape hatch really works, not just that creation returned 201.
    expect(res.body.data.emailed).toBe(false);
    const tempPassword = res.body.data.tempPassword as string;
    expect(typeof tempPassword).toBe("string");
    expect(tempPassword.length).toBeGreaterThan(8);

    operatorToken = await login(operatorEmail, tempPassword);
  });

  it("lists operators without password hashes", async () => {
    const res = await api.get("/api/v1/operator/operators").set(auth(operatorToken));
    expect(res.status).toBe(200);
    const emails = res.body.data.map((o: { email: string }) => o.email);
    expect(emails).toContain(operatorEmail);
    for (const operator of res.body.data) {
      expect(operator).not.toHaveProperty("password_hash");
    }
  });

  it("denies non-SUPERADMIN destructive operations with 403", async () => {
    const createTenant = await api
      .post("/api/v1/operator/tenants")
      .set(auth(operatorToken))
      .send({
        name: `Denied Tenant ${marker}`,
        plan_key: "GROWTH",
        admin: { name: "X", email: `qa-denied-${marker}@example.com` },
      });
    expect(createTenant.status).toBe(403);

    const createPlan = await api
      .post("/api/v1/operator/plans")
      .set(auth(operatorToken))
      .send({
        key: `QA_DENIED_${MARKER}`,
        name: "Denied",
        price_monthly: 0,
        modules: ["leads"],
        limits: { seats: 1, leads: 1, ai_credits_monthly: 1 },
      });
    expect(createPlan.status).toBe(403);

    const updateTenant = await api
      .put(`/api/v1/operator/tenants/${createdTenantIds[0]}`)
      .set(auth(operatorToken))
      .send({ name: "Hijacked" });
    expect(updateTenant.status).toBe(403);

    const createOperator = await api
      .post("/api/v1/operator/operators")
      .set(auth(operatorToken))
      .send({ name: "X", email: `qa-x-${marker}@example.com`, role: "OPERATOR" });
    expect(createOperator.status).toBe(403);

    // Read endpoints stay open to any operator.
    expect((await api.get("/api/v1/operator/tenants").set(auth(operatorToken))).status).toBe(200);
    expect((await api.get("/api/v1/operator/metrics/overview").set(auth(operatorToken))).status).toBe(200);
  });

  it("SUPERADMIN disables the operator, killing their access", async () => {
    const res = await api
      .put(`/api/v1/operator/operators/${operatorId}`)
      .set(auth(rootToken))
      .send({ status: "DISABLED" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("DISABLED");

    expect((await api.get("/api/v1/operator/auth/me").set(auth(operatorToken))).status).toBe(401);

    const audit = await waitForAuditRow({ action: "operator.updated", resourceId: operatorId });
    expect(audit).toBeTruthy();
  });
});
