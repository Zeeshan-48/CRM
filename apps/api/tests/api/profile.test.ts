import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB } from "../../src/db/connection";
import { api, auth, NW_SALES, login } from "../helpers";

let salesToken: string;

beforeAll(async () => {
  salesToken = await login(NW_SALES.email, NW_SALES.password);
});

afterAll(async () => {
  // Reset to no number so other suites are unaffected.
  await api.patch("/api/v1/users/me").set(auth(salesToken)).send({ phone: "" });
  await closeDB();
});

describe("self-service profile (PATCH /users/me)", () => {
  it("lets a non-admin set their own callback number", async () => {
    const res = await api
      .patch("/api/v1/users/me")
      .set(auth(salesToken))
      .send({ phone: "+14155550133" });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe("+14155550133");
  });

  it("reflects the number in /auth/me", async () => {
    const res = await api.get("/api/v1/auth/me").set(auth(salesToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.phone).toBe("+14155550133");
  });

  it("normalizes a bare national number to the default country code", async () => {
    // The CRM is India-first: a bare 10-digit number is assumed +91 rather than
    // rejected, because that is what agents type. Only input that cannot become
    // a valid E.164 number at all is refused (next test).
    const res = await api
      .patch("/api/v1/users/me")
      .set(auth(salesToken))
      .send({ phone: "4155550133" });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe("+914155550133");
  });

  it("rejects a number that cannot normalize to E.164", async () => {
    const res = await api.patch("/api/v1/users/me").set(auth(salesToken)).send({ phone: "+12" });
    expect(res.status).toBe(400);
  });

  it("clears the number with an empty string", async () => {
    const res = await api.patch("/api/v1/users/me").set(auth(salesToken)).send({ phone: "" });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBeNull();
  });
});

describe("self-service password (PATCH /users/me/password)", () => {
  const NEW_PASSWORD = "New-Passw0rd";

  it("rejects a wrong current password", async () => {
    const res = await api
      .patch("/api/v1/users/me/password")
      .set(auth(salesToken))
      .send({ currentPassword: "definitely-wrong", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it("rejects a too-short new password", async () => {
    const res = await api
      .patch("/api/v1/users/me/password")
      .set(auth(salesToken))
      .send({ currentPassword: NW_SALES.password, newPassword: "short" });
    expect(res.status).toBe(400);
  });

  it("changes the password, lets the user sign in with it, then restores the original", async () => {
    const change = await api
      .patch("/api/v1/users/me/password")
      .set(auth(salesToken))
      .send({ currentPassword: NW_SALES.password, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);

    // The new password works for a fresh sign-in.
    const newToken = await login(NW_SALES.email, NEW_PASSWORD);
    expect(newToken).toBeTruthy();

    // The old password no longer works.
    const oldLogin = await api
      .post("/api/v1/auth/login")
      .send({ email: NW_SALES.email, password: NW_SALES.password });
    expect(oldLogin.status).toBe(401);

    // Restore the seeded password so other suites keep signing in.
    const restore = await api
      .patch("/api/v1/users/me/password")
      .set(auth(newToken))
      .send({ currentPassword: NEW_PASSWORD, newPassword: NW_SALES.password });
    expect(restore.status).toBe(200);
  });
});
