import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, NW_FINANCE, login } from "../helpers";

// BYO Stripe connection + default-gateway selection + collection via Stripe.
// Stripe is simulated under the test runner (cs_sim_ sessions), so nothing is
// charged. Snapshots/restores the tenant's stripe config + config JSON.
let adminToken: string;
let financeToken: string;
let tenantId: string;
let savedStripe: Record<string, unknown> | null = null;
let savedConfig: unknown = null;
const createdInvoiceIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id", "config"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  savedConfig = tenant.config;
  savedStripe =
    ((await db
      .selectFrom("tenant_stripe")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_stripe").where("tenant_id", "=", tenantId).execute();

  // Establish the starting state instead of assuming it. This suite switches the
  // tenant's default gateway to Stripe and restores it in afterAll, but a run
  // killed midway leaves the workspace on Stripe forever, and the next run's
  // "defaults to Razorpay" then fails for a reason that has nothing to do with
  // the code. Clearing the key makes the suite idempotent from any prior state.
  const startConfig = { ...((savedConfig as Record<string, unknown> | null) ?? {}) };
  delete startConfig.paymentGateway;
  await db
    .updateTable("tenants")
    .set({ config: JSON.stringify(startConfig), updated_at: new Date() })
    .where("id", "=", tenantId)
    .execute();
});

afterAll(async () => {
  if (createdInvoiceIds.length) {
    await db.deleteFrom("payments").where("invoice_id", "in", createdInvoiceIds).execute();
    await db.deleteFrom("invoices").where("id", "in", createdInvoiceIds).execute();
  }
  await db.deleteFrom("tenant_stripe").where("tenant_id", "=", tenantId).execute();
  if (savedStripe) {
    await db.insertInto("tenant_stripe").values(savedStripe as never).execute();
  }
  // Restore tenants.config so the default gateway isn't left on Stripe.
  await db
    .updateTable("tenants")
    .set({ config: (savedConfig ?? null) as never, updated_at: new Date() })
    .where("id", "=", tenantId)
    .execute();
  await closeDB();
});

describe("stripe config", () => {
  it("reports not-configured initially", async () => {
    const res = await api.get("/api/v1/finance/stripe/config").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.secret_key_set).toBe(false);
  });

  it("denies saving config to non-admins", async () => {
    const res = await api
      .put("/api/v1/finance/stripe/config")
      .set(auth(financeToken))
      .send({ secretKey: "sk_test_x" });
    expect(res.status).toBe(403);
  });

  it("saves the key (never returns it) and validates to ACTIVE (simulated)", async () => {
    const save = await api
      .put("/api/v1/finance/stripe/config")
      .set(auth(adminToken))
      .send({ secretKey: "sk_test_secretvalue123" });
    expect(save.status).toBe(200);
    expect(save.body.data.configured).toBe(true);
    expect(save.body.data.secret_key_set).toBe(true);
    expect(JSON.stringify(save.body.data)).not.toContain("sk_test_secretvalue123");

    const validate = await api.post("/api/v1/finance/stripe/config/validate").set(auth(adminToken));
    expect(validate.status).toBe(200);
    expect(validate.body.data.status).toBe("ACTIVE");
  });

  it("keeps the key write-only: no reveal endpoint, never in the config", async () => {
    const reveal = await api.get("/api/v1/finance/stripe/config/secrets").set(auth(adminToken));
    expect(reveal.status).toBe(404);
    const cfg = await api.get("/api/v1/finance/stripe/config").set(auth(adminToken));
    expect(cfg.status).toBe(200);
    expect(JSON.stringify(cfg.body)).not.toContain("sk_test_secretvalue123");
  });
});

describe("default gateway", () => {
  it("defaults to Razorpay and can switch to Stripe", async () => {
    const initial = await api.get("/api/v1/finance/gateway-default").set(auth(adminToken));
    expect(initial.status).toBe(200);
    expect(initial.body.data.gateway).toBe("Razorpay");

    const denied = await api
      .put("/api/v1/finance/gateway-default")
      .set(auth(financeToken))
      .send({ gateway: "Stripe" });
    expect(denied.status).toBe(403);

    const set = await api
      .put("/api/v1/finance/gateway-default")
      .set(auth(adminToken))
      .send({ gateway: "Stripe" });
    expect(set.status).toBe(200);
    expect(set.body.data.gateway).toBe("Stripe");

    const rejected = await api
      .put("/api/v1/finance/gateway-default")
      .set(auth(adminToken))
      .send({ gateway: "Paypal" });
    expect(rejected.status).toBe(400);
  });

  it("creates a Stripe payment link when Stripe is the default gateway", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 12000 });
    expect(created.status).toBe(201);
    const invoiceId = created.body.data.id;
    createdInvoiceIds.push(invoiceId);

    const link = await api
      .post(`/api/v1/finance/invoices/${invoiceId}/payment-link`)
      .set(auth(financeToken));
    expect(link.status).toBe(201);
    expect(link.body.data.gateway).toBe("Stripe");
    expect(link.body.data.simulated).toBe(true);
    expect(link.body.data.payment.status).toBe("PENDING");
    expect(link.body.data.payment.gateway).toBe("Stripe");
  });
});
