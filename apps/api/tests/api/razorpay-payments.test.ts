import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, NW_FINANCE, login } from "../helpers";

// BYO Razorpay connection + online payment-link collection. Razorpay is
// simulated under the test runner, so links are fake (plink_sim_…) and nothing
// is charged. Snapshots/restores the tenant's razorpay config so a run never
// wipes saved credentials.
let adminToken: string;
let financeToken: string;
let tenantId: string;
let savedConfig: Record<string, unknown> | null = null;
const createdInvoiceIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  savedConfig =
    ((await db
      .selectFrom("tenant_razorpay")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_razorpay").where("tenant_id", "=", tenantId).execute();
});

afterAll(async () => {
  if (createdInvoiceIds.length) {
    await db.deleteFrom("payments").where("invoice_id", "in", createdInvoiceIds).execute();
    await db.deleteFrom("invoices").where("id", "in", createdInvoiceIds).execute();
  }
  await db.deleteFrom("tenant_razorpay").where("tenant_id", "=", tenantId).execute();
  if (savedConfig) {
    await db.insertInto("tenant_razorpay").values(savedConfig as never).execute();
  }
  await closeDB();
});

describe("razorpay config", () => {
  it("reports not-configured initially", async () => {
    const res = await api.get("/api/v1/finance/razorpay/config").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.key_secret_set).toBe(false);
  });

  it("denies saving config to non-admins", async () => {
    const res = await api
      .put("/api/v1/finance/razorpay/config")
      .set(auth(financeToken))
      .send({ keyId: "rzp_test_x", keySecret: "secret" });
    expect(res.status).toBe(403);
  });

  it("saves credentials and masks the key id (secret never returned)", async () => {
    const res = await api
      .put("/api/v1/finance/razorpay/config")
      .set(auth(adminToken))
      .send({ keyId: "rzp_test_abcdef123456", keySecret: "supersecretvalue" });
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.key_secret_set).toBe(true);
    expect(JSON.stringify(res.body.data)).not.toContain("supersecretvalue");
  });

  it("validates the credentials to ACTIVE (simulated under test)", async () => {
    const res = await api.post("/api/v1/finance/razorpay/config/validate").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");
  });

  it("keeps the secret write-only: no reveal endpoint, never in the config", async () => {
    const reveal = await api.get("/api/v1/finance/razorpay/config/secrets").set(auth(adminToken));
    expect(reveal.status).toBe(404);
    const cfg = await api.get("/api/v1/finance/razorpay/config").set(auth(adminToken));
    expect(cfg.status).toBe(200);
    expect(JSON.stringify(cfg.body)).not.toContain("supersecretvalue");
  });
});

describe("online payment links", () => {
  it("creates a PENDING payment with a hosted link for a SENT invoice", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 15000 });
    expect(created.status).toBe(201);
    const invoiceId = created.body.data.id;
    createdInvoiceIds.push(invoiceId);

    const link = await api
      .post(`/api/v1/finance/invoices/${invoiceId}/payment-link`)
      .set(auth(financeToken));
    expect(link.status).toBe(201);
    expect(link.body.data.pay_url).toBeTruthy();
    expect(link.body.data.simulated).toBe(true);
    expect(link.body.data.payment.status).toBe("PENDING");
    expect(link.body.data.payment.amount).toBe(15000 + 2700);

    // Invoice stays SENT until the link is paid (confirmed by the poll job).
    const invoice = await db
      .selectFrom("invoices")
      .select(["status"])
      .where("id", "=", invoiceId)
      .executeTakeFirstOrThrow();
    expect(invoice.status).toBe("SENT");
  });

  it("rejects a payment link for a non-collectible (DRAFT/PAID) invoice", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 5000 });
    const invoiceId = created.body.data.id;
    createdInvoiceIds.push(invoiceId);

    await api.post(`/api/v1/finance/invoices/${invoiceId}/pay`).set(auth(financeToken));
    const link = await api
      .post(`/api/v1/finance/invoices/${invoiceId}/payment-link`)
      .set(auth(financeToken));
    expect(link.status).toBe(400);
  });
});
