import { openSecret } from "../../src/utils/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let esAdminToken: string;
let nwTenantId: string;
const createdWebhookIds: string[] = [];
const createdApiKeyIds: string[] = [];
const connectedIntegrationKeys: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
  const me = await api.get("/api/v1/tenant/me").set(auth(adminToken));
  nwTenantId = me.body.data.tenant.id as string;
});

afterAll(async () => {
  // Fire-and-forget audit writes from the requests above may still be in flight.
  await sleep(300);
  for (const id of createdWebhookIds) {
    // Delivery rows now exist for any webhook that was test-fired, and nothing
    // cascades them, so clear them before the subscription they point at.
    await db.deleteFrom("webhook_deliveries").where("webhook_id", "=", id).execute();
    await db.deleteFrom("webhooks").where("id", "=", id).execute();
    await db.deleteFrom("audit_logs").where("entity_id", "=", id).execute();
  }
  for (const id of createdApiKeyIds) {
    await db.deleteFrom("api_keys").where("id", "=", id).execute();
    await db.deleteFrom("audit_logs").where("entity_id", "=", id).execute();
  }
  for (const key of connectedIntegrationKeys) {
    await db
      .deleteFrom("integrations")
      .where("tenant_id", "=", nwTenantId)
      .where("key", "=", key)
      .execute();
    await db
      .deleteFrom("audit_logs")
      .where("tenant_id", "=", nwTenantId)
      .where("entity_type", "=", "integration")
      .where("entity_id", "=", key)
      .execute();
  }
  await db
    .deleteFrom("audit_logs")
    .where("tenant_id", "=", nwTenantId)
    .where("action", "=", "security.updated")
    .execute();
  await closeDB();
});

describe("integrations catalogue", () => {
  it("returns the catalogue merged with connected status", async () => {
    const res = await api.get("/api/v1/integrations").set(auth(adminToken));
    expect(res.status).toBe(200);
    const cat = res.body.data;

    expect(cat.erp.map((i: { key: string }) => i.key)).toEqual([
      "sap",
      "oracle",
      "zoho",
      "tally",
    ]);
    expect(cat.ecommerce.map((i: { key: string }) => i.key)).toEqual([
      "shopify",
      "woocommerce",
      "magento",
    ]);
    expect(cat.calendar.map((i: { key: string }) => i.key)).toEqual(["google", "outlook"]);
    expect(cat.payments.map((i: { key: string }) => i.key)).toEqual([
      "razorpay",
      "stripe",
      "cashfree",
    ]);
    expect(cat.communication.map((i: { key: string }) => i.key)).toEqual([
      "whatsapp",
      "telegram",
      "gmail",
    ]);

    // Seeded connections: razorpay/whatsapp/google/zoho are connected.
    const razorpay = cat.payments.find((i: { key: string }) => i.key === "razorpay");
    expect(razorpay.connected).toBe(true);
    const sap = cat.erp.find((i: { key: string }) => i.key === "sap");
    expect(sap.connected).toBe(false);
  });

  it("connects an integration, storing credentials without ever returning them", async () => {
    const res = await api
      .post("/api/v1/integrations/stripe/connect")
      .set(auth(adminToken))
      .send({ apiKey: "sk_test_abc", accountId: "acct_1" });
    expect(res.status).toBe(200);
    connectedIntegrationKeys.push("stripe");
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.connected_at).toBeTruthy();
    expect(res.body.data.credentials).toBeUndefined();

    // Credentials are persisted on the row, sealed: the plaintext never touches
    // the database, and the sealed value opens back to what was sent.
    const row = await db
      .selectFrom("integrations")
      .selectAll()
      .where("tenant_id", "=", nwTenantId)
      .where("key", "=", "stripe")
      .executeTakeFirst();
    expect(row).toBeTruthy();
    expect(JSON.stringify(row?.credentials)).not.toContain("sk_test_abc");
    const sealed = (row?.credentials as { sealed?: string } | null)?.sealed ?? "";
    expect(openSecret(sealed)).toContain("sk_test_abc");

    const cat = await api.get("/api/v1/integrations").set(auth(adminToken));
    const stripe = cat.body.data.payments.find((i: { key: string }) => i.key === "stripe");
    expect(stripe.connected).toBe(true);
  });

  it("rejects unknown integration keys with 400", async () => {
    const res = await api
      .post("/api/v1/integrations/doesnotexist/connect")
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(400);
  });

  it("disconnects a connected integration and 404s on a never-connected one", async () => {
    const res = await api
      .post("/api/v1/integrations/stripe/disconnect")
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);
    expect(res.body.data.credentials).toBeUndefined();

    const missing = await api
      .post("/api/v1/integrations/magento/disconnect")
      .set(auth(adminToken))
      .send({});
    expect(missing.status).toBe(404);
  });

  it("blocks roles without the integrations module", async () => {
    const res = await api.get("/api/v1/integrations").set(auth(salesToken));
    expect(res.status).toBe(403);
  });
});

describe("connection status dashboard", () => {
  const STATES = [
    "connected",
    "pending",
    "default",
    "simulated",
    "not_connected",
    "unavailable",
  ];

  it("aggregates real per-service connection statuses", async () => {
    const res = await api.get("/api/v1/integrations/connections").set(auth(adminToken));
    expect(res.status).toBe(200);
    const list = res.body.data as Array<{
      key: string;
      name: string;
      category: string;
      scope: string;
      state: string;
      detail: string | null;
      managePath: string | null;
    }>;
    expect(Array.isArray(list)).toBe(true);

    // Every real integration surface is represented.
    const keys = list.map((i) => i.key);
    for (const key of [
      "whatsapp",
      "email",
      "razorpay",
      "stripe",
      "google_calendar",
      "telephony",
      "platform_llm",
    ]) {
      expect(keys).toContain(key);
    }

    // Each item is well-formed and carries a valid state.
    for (const item of list) {
      expect(typeof item.name).toBe("string");
      expect(typeof item.category).toBe("string");
      expect(["tenant", "user", "platform"]).toContain(item.scope);
      expect(STATES).toContain(item.state);
    }

    // The platform LLM has no tenant page to manage and, under test, runs the
    // deterministic simulator.
    const llm = list.find((i) => i.key === "platform_llm");
    expect(llm?.scope).toBe("platform");
    expect(llm?.managePath).toBeNull();
    expect(llm?.state).toBe("simulated");
  });

  it("blocks roles without the integrations module", async () => {
    const res = await api.get("/api/v1/integrations/connections").set(auth(salesToken));
    expect(res.status).toBe(403);
  });
});

describe("webhooks", () => {
  it("lists webhooks with the event catalogue and without secrets", async () => {
    const res = await api.get("/api/v1/integrations/webhooks").set(auth(adminToken));
    expect(res.status).toBe(200);
    // Asserted as a superset, not an exact list: the catalogue grows as the CRM
    // learns to emit more, and pinning it exactly makes every addition a test
    // failure in a file that has nothing to do with the change.
    for (const event of [
      "lead.created",
      "deal.won",
      "ticket.created",
      "payment.success",
      "meeting.scheduled",
    ]) {
      expect(res.body.data.events).toContain(event);
    }
    expect(res.body.data.webhooks.length).toBeGreaterThanOrEqual(1);
    for (const w of res.body.data.webhooks) {
      expect(w.secret).toBeUndefined();
    }
  });

  it("creates a webhook returning the secret exactly once", async () => {
    const res = await api
      .post("/api/v1/integrations/webhooks")
      .set(auth(adminToken))
      .send({ url: "https://example.com/qa-hook", event: "lead.created" });
    expect(res.status).toBe(201);
    const webhook = res.body.data;
    createdWebhookIds.push(webhook.id);
    expect(webhook.secret).toMatch(/^whsec_/);
    expect(webhook.deliveries).toBe(0);
    const stored = await db
      .selectFrom("webhooks")
      .select(["secret"])
      .where("id", "=", webhook.id)
      .executeTakeFirstOrThrow();
    expect(stored.secret).not.toBe(webhook.secret);
    expect(openSecret(stored.secret)).toBe(webhook.secret);

    const list = await api.get("/api/v1/integrations/webhooks").set(auth(adminToken));
    const listed = list.body.data.webhooks.find((w: { id: string }) => w.id === webhook.id);
    expect(listed).toBeTruthy();
    expect(listed.secret).toBeUndefined();
  });

  it("requires url and event", async () => {
    const res = await api
      .post("/api/v1/integrations/webhooks")
      .set(auth(adminToken))
      .send({ url: "https://example.com/only-url" });
    expect(res.status).toBe(400);
  });

  it("test-fires a REAL signed delivery and reports what actually happened", async () => {
    // This used to increment a counter and return a hardcoded { id: "demo" }
    // without making any request, so "Test" always looked successful even
    // against an endpoint that did not exist. It now really sends.
    const created = await api
      .post("/api/v1/integrations/webhooks")
      .set(auth(adminToken))
      .send({
        // A domain that cannot resolve, so the outcome is deterministic and no
        // third party is contacted by the test suite.
        url: "https://qa-unreachable.invalid/hook",
        event: "lead.created",
      });
    const id = created.body.data.id as string;
    createdWebhookIds.push(id);

    const res = await api
      .post(`/api/v1/integrations/webhooks/${id}/test`)
      .set(auth(adminToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.delivery.event).toBe("lead.created");
    expect(res.body.data.delivery.error).toBeTruthy();

    // The attempt is recorded with its payload so it can be inspected and replayed.
    const log = await api
      .get("/api/v1/integrations/webhook-deliveries")
      .set(auth(adminToken));
    const entry = log.body.data.find(
      (d: { id: string }) => d.id === res.body.data.delivery.id
    );
    expect(entry).toBeTruthy();
    expect(entry.error).toBeTruthy();

    // The success counter must NOT move for a delivery that never landed.
    const list = await api.get("/api/v1/integrations/webhooks").set(auth(adminToken));
    const listed = list.body.data.webhooks.find((w: { id: string }) => w.id === id);
    expect(listed.deliveries).toBe(0);
  });

  it("cross-tenant webhook access returns 404", async () => {
    const id = createdWebhookIds[0];
    const test = await api
      .post(`/api/v1/integrations/webhooks/${id}/test`)
      .set(auth(esAdminToken))
      .send({});
    expect(test.status).toBe(404);
    const del = await api.delete(`/api/v1/integrations/webhooks/${id}`).set(auth(esAdminToken));
    expect(del.status).toBe(404);
  });

  it("deletes a webhook", async () => {
    const id = createdWebhookIds[0];
    const res = await api.delete(`/api/v1/integrations/webhooks/${id}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const list = await api.get("/api/v1/integrations/webhooks").set(auth(adminToken));
    expect(list.body.data.webhooks.find((w: { id: string }) => w.id === id)).toBeUndefined();
  });
});

describe("api keys", () => {
  it("lists keys masked: prefix only, never hash or raw key", async () => {
    const res = await api.get("/api/v1/integrations/api-keys").set(auth(adminToken));
    expect(res.status).toBe(200);
    const seeded = res.body.data.find((k: { name: string }) => k.name === "Production key");
    expect(seeded).toBeTruthy();
    expect(seeded.key_prefix).toBe("crm_sk_northwi");
    expect(seeded.key).toBeUndefined();
    expect(seeded.key_hash).toBeUndefined();
    expect(seeded).toHaveProperty("last_used_at");
  });

  it("creates a key returning the raw value exactly once", async () => {
    const res = await api
      .post("/api/v1/integrations/api-keys")
      .set(auth(adminToken))
      .send({ name: "QA temp key" });
    expect(res.status).toBe(201);
    const created = res.body.data;
    createdApiKeyIds.push(created.id);
    expect(created.key).toMatch(/^crm_sk_[0-9a-f]{32}$/);
    expect(created.key_prefix).toBe(created.key.slice(0, 14));
    expect(created.note).toContain("Save this key now");

    // Stored hashed; raw key never persisted or listed again.
    const row = await db
      .selectFrom("api_keys")
      .selectAll()
      .where("id", "=", created.id)
      .executeTakeFirst();
    expect(row?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.key_hash).not.toBe(created.key);

    const list = await api.get("/api/v1/integrations/api-keys").set(auth(adminToken));
    const listed = list.body.data.find((k: { id: string }) => k.id === created.id);
    expect(listed.key).toBeUndefined();
    expect(listed.key_prefix).toBe(created.key_prefix);
  });

  it("revokes a key (soft delete) and hides it from the listing", async () => {
    const id = createdApiKeyIds[0];
    const res = await api.delete(`/api/v1/integrations/api-keys/${id}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const row = await db
      .selectFrom("api_keys")
      .select(["revoked_at"])
      .where("id", "=", id)
      .executeTakeFirst();
    expect(row?.revoked_at).toBeTruthy();

    const list = await api.get("/api/v1/integrations/api-keys").set(auth(adminToken));
    expect(list.body.data.find((k: { id: string }) => k.id === id)).toBeUndefined();

    const again = await api.delete(`/api/v1/integrations/api-keys/${id}`).set(auth(adminToken));
    expect(again.status).toBe(404);
  });
});

describe("security settings", () => {
  it("reads tenant security config with defaults applied", async () => {
    const res = await api.get("/api/v1/integrations/security").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      mfa: true,
      ssoGoogle: true,
      ssoMicrosoft: true,
      saml: false,
      deviceControl: true,
      ipRestrictions: [],
    });
  });

  it("merges updates into config.security, ADMIN only", async () => {
    const denied = await api
      .put("/api/v1/integrations/security")
      .set(auth(salesToken))
      .send({ mfa: false });
    expect(denied.status).toBe(403);

    const updated = await api
      .put("/api/v1/integrations/security")
      .set(auth(adminToken))
      .send({ deviceControl: false, ipRestrictions: ["10.0.0.0/8"] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.deviceControl).toBe(false);
    expect(updated.body.data.ipRestrictions).toEqual(["10.0.0.0/8"]);
    expect(updated.body.data.mfa).toBe(true); // untouched keys survive the merge

    const fresh = await api.get("/api/v1/integrations/security").set(auth(adminToken));
    expect(fresh.body.data.deviceControl).toBe(false);

    // Restore the seeded values.
    const restored = await api
      .put("/api/v1/integrations/security")
      .set(auth(adminToken))
      .send({ deviceControl: true, ipRestrictions: [] });
    expect(restored.status).toBe(200);
    expect(restored.body.data.deviceControl).toBe(true);
  });
});
