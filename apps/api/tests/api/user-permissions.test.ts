import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, login, NW_ADMIN, NW_MANAGER } from "../helpers";

// A per-user permission list replaces the role's modules, so it must be as
// guarded as a role change: admins only, real keys only, never "*".
const RUN = Date.now();
let adminToken: string;
let managerToken: string;
const created: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  managerToken = await login(NW_MANAGER.email, NW_MANAGER.password);
});

afterAll(async () => {
  if (created.length) await db.deleteFrom("users").where("id", "in", created).execute();
  await closeDB();
});

const invite = (token: string, body: Record<string, unknown>) =>
  api.post("/api/v1/users").set(auth(token)).send({
    name: "Permission Test",
    email: `perm-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    role: "SALES_AGENT",
    ...body,
  });

describe("per-user permission overrides", () => {
  it("a manager cannot grant a wildcard on invite", async () => {
    const res = await invite(managerToken, { permissions: ["*"] });
    expect(res.status).toBe(403);
  });

  it("a manager cannot add permissions to an existing user", async () => {
    const ok = await invite(managerToken, {});
    expect(ok.status).toBe(201);
    created.push(ok.body.data.id ?? ok.body.data.user?.id);
    const id = created[created.length - 1];
    const res = await api
      .put(`/api/v1/users/${id}`)
      .set(auth(managerToken))
      .send({ permissions: ["finance", "audit"] });
    expect(res.status).toBe(403);
  });

  it("an admin cannot set the wildcard either", async () => {
    const res = await invite(adminToken, { permissions: ["*"] });
    expect(res.status).toBe(400);
  });

  it("an admin can set real module keys", async () => {
    const res = await invite(adminToken, { permissions: ["leads", "contacts"] });
    expect(res.status).toBe(201);
    created.push(res.body.data.id ?? res.body.data.user?.id);
  });
});
