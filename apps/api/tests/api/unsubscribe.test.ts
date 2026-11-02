import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { signUnsubToken } from "../../src/utils/unsubscribe";
import { api } from "../helpers";

let tenantId: string;
const email = `unsub-${Date.now()}@example.com`;

beforeAll(async () => {
  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
});

afterAll(async () => {
  await db
    .deleteFrom("email_suppressions")
    .where("tenant_id", "=", tenantId)
    .where("email", "=", email)
    .execute();
  await closeDB();
});

describe("public unsubscribe (no auth)", () => {
  it("one-click POST suppresses the recipient for MARKETING", async () => {
    const token = signUnsubToken({ tenantId, email });
    const res = await api.post("/api/v1/unsubscribe").send({ token });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await db
      .selectFrom("email_suppressions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("email", "=", email)
      .executeTakeFirst();
    expect(row?.reason).toBe("MANUAL_UNSUBSCRIBE");
    expect(row?.category_scope).toBe("MARKETING");
  });

  it("GET serves a confirmation page for a valid token", async () => {
    const token = signUnsubToken({ tenantId, email });
    const res = await api.get(`/api/v1/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("unsubscribed");
  });

  it("rejects an invalid token", async () => {
    const res = await api.post("/api/v1/unsubscribe").send({ token: "bad.token" });
    expect(res.status).toBe(400);
  });
});
