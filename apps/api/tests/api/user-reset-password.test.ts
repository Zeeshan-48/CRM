import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, NW_SALES, login } from "../helpers";

// Admin-initiated password reset. Runs against the seeded `northwind` tenant: it
// resets the sales agent (asha), then restores her original password hash in
// afterAll so other suites can still log in as agent123.

let adminToken: string;
let salesToken: string;
let adminId: string;
let salesId: string;
let salesPasswordHash: string;

const RESET = (id: string) => `/api/v1/users/${id}/reset-password`;
const LOGIN = "/api/v1/auth/login";

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);

  const admin = await db
    .selectFrom("users")
    .select(["id"])
    .where("email", "=", NW_ADMIN.email)
    .executeTakeFirstOrThrow();
  adminId = admin.id;

  const sales = await db
    .selectFrom("users")
    .select(["id", "password_hash"])
    .where("email", "=", NW_SALES.email)
    .executeTakeFirstOrThrow();
  salesId = sales.id;
  salesPasswordHash = sales.password_hash;
});

afterAll(async () => {
  await db
    .updateTable("users")
    .set({ password_hash: salesPasswordHash })
    .where("id", "=", salesId)
    .execute();
  await closeDB();
});

describe("admin password reset (POST /users/:id/reset-password)", () => {
  it("forbids non-admins", async () => {
    const res = await api.post(RESET(adminId)).set(auth(salesToken));
    expect(res.status).toBe(403);
  });

  it("rejects resetting your own password", async () => {
    const res = await api.post(RESET(adminId)).set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("404s for an unknown user", async () => {
    const res = await api.post(RESET("usr_does_not_exist")).set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it("resets a member's password and invalidates the old one", async () => {
    // Sanity: the old password works before the reset.
    const before = await api
      .post(LOGIN)
      .send({ email: NW_SALES.email, password: NW_SALES.password });
    expect(before.status).toBe(200);

    const res = await api.post(RESET(salesId)).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.email).toBe(NW_SALES.email);
    expect(typeof res.body.data.emailed).toBe("boolean");
    // The plaintext password must never be returned by the API.
    expect(JSON.stringify(res.body.data)).not.toContain(NW_SALES.password);

    // The old password no longer works.
    const after = await api
      .post(LOGIN)
      .send({ email: NW_SALES.email, password: NW_SALES.password });
    expect(after.status).toBe(401);

    // The stored hash actually changed and no longer matches the old password.
    const row = await db
      .selectFrom("users")
      .select(["password_hash"])
      .where("id", "=", salesId)
      .executeTakeFirstOrThrow();
    expect(row.password_hash).not.toBe(salesPasswordHash);
    expect(await bcrypt.compare(NW_SALES.password, row.password_hash)).toBe(false);
  });
});
