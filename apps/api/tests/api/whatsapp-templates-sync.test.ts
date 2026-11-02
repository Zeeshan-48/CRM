import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { encryptSecret } from "../../src/utils/crypto";
import { api, auth, NW_ADMIN, login } from "../helpers";

// "Sync from Meta" pulls the tenant's verified templates. Meta is simulated
// under the test runner (fetch returns []), so we assert the endpoint + config
// requirements (needs a connected account with a WABA id). Snapshots/restores
// the tenant's WhatsApp config.
let adminToken: string;
let tenantId: string;
let savedConfig: Record<string, unknown> | null = null;

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  savedConfig =
    ((await db
      .selectFrom("tenant_whatsapp")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
});

afterAll(async () => {
  await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
  if (savedConfig) {
    await db.insertInto("tenant_whatsapp").values(savedConfig as never).execute();
  }
  await closeDB();
});

// The old `PUT /whatsapp/config` is gone: connecting an account now goes through
// Meta's Embedded Signup (`POST /config/embedded-signup/exchange`), which needs a
// real Meta code exchange and cannot run here. So the connection row is written
// directly, which is what the exchange itself ultimately does.
const connect = async (wabaId: string | null): Promise<void> => {
  await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
  const now = new Date();
  await db
    .insertInto("tenant_whatsapp")
    .values({
      id: ulid(),
      tenant_id: tenantId,
      provider: "META",
      phone_number_id: "123456789012345",
      // Stored encrypted, exactly as the Embedded Signup exchange stores it, // the sync decrypts it and fails loudly on anything else.
      access_token_encrypted: encryptSecret("EAAtoken"),
      waba_id: wabaId,
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    })
    .execute();
};

describe("whatsapp template sync", () => {
  it("requires a connected WhatsApp account", async () => {
    const res = await api.post("/api/v1/whatsapp/templates/sync").set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("requires a WABA id", async () => {
    await connect(null);

    const res = await api.post("/api/v1/whatsapp/templates/sync").set(auth(adminToken));
    expect(res.status).toBe(400);
    expect(String(res.body.message || "")).toMatch(/WABA/i);
  });

  it("syncs (0 under the simulated test runner) once a WABA id is set", async () => {
    await connect("WABA-TEST-0001");

    const res = await api.post("/api/v1/whatsapp/templates/sync").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(0);
  });
});
