import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import emailReputationRepository from "../../src/repositories/email-reputation.repository";
import { api, auth, NW_ADMIN, login } from "../helpers";

let adminToken: string;
let tenantId: string;

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
});

afterAll(async () => {
  // Always restore the tenant to ACTIVE so other suites are unaffected.
  await emailReputationRepository.setTenantStatus(tenantId, "ACTIVE");
  await db.deleteFrom("email_reputation_events").where("tenant_id", "=", tenantId).execute();
  await closeDB();
});

describe("reputation status transitions (repository)", () => {
  it("records a status change and reads tenant state", async () => {
    await emailReputationRepository.setTenantStatus(tenantId, "WARNING");
    await emailReputationRepository.recordEvent({
      tenantId,
      fromStatus: "ACTIVE",
      toStatus: "WARNING",
      trigger: "test",
      reason: "unit",
      ratesSnapshot: { sends: 200, bounceRate: 0.03 },
    });

    const state = await emailReputationRepository.getTenantState(tenantId);
    expect(state?.email_sending_status).toBe("WARNING");
    expect(state?.email_sending_status_changed_at).toBeTruthy();

    const recoverable = await emailReputationRepository.listRecoverable();
    expect(recoverable.some((t) => t.id === tenantId)).toBe(true);
  });
});

describe("GET /email-reputation", () => {
  it("returns status, rates and recent events", async () => {
    const res = await api.get("/api/v1/email-reputation").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(["ACTIVE", "WARNING", "THROTTLED", "PAUSED"]).toContain(res.body.data.status);
    // Redis is disabled under tests, so rolling rates are null.
    expect(res.body.data.rates).toBeNull();
    expect(Array.isArray(res.body.data.events)).toBe(true);
    expect(res.body.data.events.some((e: { trigger: string }) => e.trigger === "test")).toBe(true);
  });
});
