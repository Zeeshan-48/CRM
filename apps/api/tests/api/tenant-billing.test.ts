import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB } from "../../src/db/connection";
import { api, auth, login, NW_ADMIN, NW_SALES } from "../helpers";

// Tenant self-service billing endpoints (/api/v1/billing). Read-only assertions
// against the seeded tenants (which are GRANDFATHERED), no mutation of seed data.

let adminToken: string;
let salesToken: string;

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
});

afterAll(async () => {
  await closeDB();
});

describe("tenant self-service billing", () => {
  it("admin reads their own subscription + plan", async () => {
    const res = await api.get("/api/v1/billing").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("subscription");
    expect(res.body.data).toHaveProperty("plan");
  });

  it("admin reads their transactions", async () => {
    const res = await api.get("/api/v1/billing/transactions").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("blocks non-admin roles with 403", async () => {
    expect((await api.get("/api/v1/billing").set(auth(salesToken))).status).toBe(403);
    expect((await api.post("/api/v1/billing/pay").set(auth(salesToken))).status).toBe(403);
  });

  it("rejects paying a complimentary (grandfathered) subscription with 400", async () => {
    const res = await api.post("/api/v1/billing/pay").set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    expect((await api.get("/api/v1/billing")).status).toBe(401);
  });
});
