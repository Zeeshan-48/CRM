import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_FINANCE,
  NW_SALES,
  login,
} from "../helpers";

let adminToken: string;
let salesToken: string;
let financeToken: string;
let esAdminToken: string;
const createdInvoiceIds: string[] = [];

const suffixOf = (number: string): number => Number(number.replace(/^INV-/, ""));

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
});

afterAll(async () => {
  if (createdInvoiceIds.length) {
    await db.deleteFrom("payments").where("invoice_id", "in", createdInvoiceIds).execute();
    await db.deleteFrom("invoices").where("id", "in", createdInvoiceIds).execute();
  }
  await closeDB();
});

describe("gateways", () => {
  it("lists the supported gateways with live flags", async () => {
    const res = await api.get("/api/v1/finance/gateways").set(auth(financeToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: "razorpay", name: "Razorpay", live: true },
      { id: "stripe", name: "Stripe", live: true },
    ]);
  });
});

describe("summary, invoices and payments", () => {
  it("summarises revenue, counts and tax for the tenant", async () => {
    const res = await api.get("/api/v1/finance/summary").set(auth(financeToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    // Seeded Northwind: INV-1000 PAID (130000 + 23400) and INV-2000 OVERDUE.
    expect(d.invoiced).toBeGreaterThanOrEqual(2);
    expect(d.paid).toBeGreaterThanOrEqual(1);
    expect(d.pending).toBeGreaterThanOrEqual(1);
    expect(d.revenue).toBeGreaterThanOrEqual(153400);
    expect(d.tax).toBeGreaterThanOrEqual(23400);
  });

  it("lists invoices latest first with account name and total", async () => {
    const res = await api.get("/api/v1/finance/invoices").set(auth(financeToken));
    expect(res.status).toBe(200);
    const invoices = res.body.data;
    expect(invoices.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < invoices.length; i++) {
      const prev = new Date(invoices[i - 1].issued_at ?? 0).getTime();
      const curr = new Date(invoices[i].issued_at ?? 0).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
    const seeded = invoices.find((inv: { number: string }) => inv.number === "INV-1000");
    expect(seeded).toBeTruthy();
    expect(typeof seeded.account).toBe("string");
    expect(seeded.total).toBe(seeded.amount + seeded.tax);
  });

  it("lists payments latest first", async () => {
    const res = await api.get("/api/v1/finance/payments").set(auth(financeToken));
    expect(res.status).toBe(200);
    const payments = res.body.data;
    expect(payments.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < payments.length; i++) {
      const prev = new Date(payments[i - 1].at).getTime();
      const curr = new Date(payments[i].at).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe("invoice creation", () => {
  it("requires amount and rejects non-integer amounts", async () => {
    const missing = await api.post("/api/v1/finance/invoices").set(auth(financeToken)).send({});
    expect(missing.status).toBe(400);

    const fractional = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 99.5 });
    expect(fractional.status).toBe(400);
  });

  it("creates a SENT invoice with default 18% tax and sequential number", async () => {
    const first = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 10000 });
    expect(first.status).toBe(201);
    const inv = first.body.data;
    createdInvoiceIds.push(inv.id);
    expect(inv.number).toMatch(/^INV-\d+$/);
    expect(inv.amount).toBe(10000);
    expect(inv.tax).toBe(1800);
    expect(inv.total).toBe(11800);
    expect(inv.status).toBe("SENT");
    expect(inv.gateway).toBe("Razorpay");
    expect(inv.issued_at).toBeTruthy();
    expect(inv.paid_at).toBeNull();

    const second = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 5000, tax: 0, dueAt: new Date(Date.now() + 7 * 86400000).toISOString() });
    expect(second.status).toBe(201);
    const inv2 = second.body.data;
    createdInvoiceIds.push(inv2.id);
    expect(inv2.tax).toBe(0);
    expect(inv2.total).toBe(5000);
    expect(inv2.due_at).toBeTruthy();
    expect(suffixOf(inv2.number)).toBe(suffixOf(inv.number) + 1);
  });

  it("rejects linked records from another tenant", async () => {
    const nwInvoices = await api.get("/api/v1/finance/invoices").set(auth(financeToken));
    const linkedAccount = nwInvoices.body.data.find(
      (inv: { account_id: string | null }) => inv.account_id
    );
    expect(linkedAccount).toBeTruthy();

    const res = await api
      .post("/api/v1/finance/invoices")
      .set(auth(esAdminToken))
      .send({ amount: 1000, accountId: linkedAccount.account_id });
    expect(res.status).toBe(404);
  });
});

describe("pay and refund", () => {
  it("pays an invoice and records a SUCCESS payment for amount plus tax", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 20000 });
    expect(created.status).toBe(201);
    createdInvoiceIds.push(created.body.data.id);

    const paid = await api
      .post(`/api/v1/finance/invoices/${created.body.data.id}/pay`)
      .set(auth(financeToken));
    expect(paid.status).toBe(200);
    const { invoice, payment } = paid.body.data;
    expect(invoice.status).toBe("PAID");
    expect(invoice.paid_at).toBeTruthy();
    expect(payment.amount).toBe(20000 + 3600);
    expect(payment.status).toBe("SUCCESS");
    expect(payment.reference).toMatch(/^pay_/);
    expect(payment.invoice_id).toBe(invoice.id);
  });

  it("refunds only PAID invoices and records a negative REFUNDED payment", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 8000 });
    expect(created.status).toBe(201);
    const invoiceId = created.body.data.id;
    createdInvoiceIds.push(invoiceId);

    const early = await api
      .post(`/api/v1/finance/invoices/${invoiceId}/refund`)
      .set(auth(financeToken));
    expect(early.status).toBe(400);

    await api.post(`/api/v1/finance/invoices/${invoiceId}/pay`).set(auth(financeToken));
    const refunded = await api
      .post(`/api/v1/finance/invoices/${invoiceId}/refund`)
      .set(auth(financeToken));
    expect(refunded.status).toBe(200);
    const { invoice, payment } = refunded.body.data;
    expect(invoice.status).toBe("REFUNDED");
    expect(payment.status).toBe("REFUNDED");
    expect(payment.amount).toBe(-(8000 + 1440));
    expect(payment.reference).toMatch(/^rfnd_/);
  });
});

describe("invoice edit and delete", () => {
  it("edits an unpaid invoice's amount, tax and due date", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 12000 });
    expect(created.status).toBe(201);
    const invoiceId = created.body.data.id;
    createdInvoiceIds.push(invoiceId);

    const updated = await api
      .put(`/api/v1/finance/invoices/${invoiceId}`)
      .set(auth(financeToken))
      .send({ amount: 15000, tax: 2700, dueAt: new Date(Date.now() + 3 * 86400000).toISOString() });
    expect(updated.status).toBe(200);
    expect(updated.body.data.amount).toBe(15000);
    expect(updated.body.data.tax).toBe(2700);
    expect(updated.body.data.total).toBe(17700);
    expect(updated.body.data.due_at).toBeTruthy();
  });

  it("rejects editing a PAID invoice", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 9000 });
    const invoiceId = created.body.data.id;
    createdInvoiceIds.push(invoiceId);
    await api.post(`/api/v1/finance/invoices/${invoiceId}/pay`).set(auth(financeToken));

    const res = await api
      .put(`/api/v1/finance/invoices/${invoiceId}`)
      .set(auth(financeToken))
      .send({ amount: 1 });
    expect(res.status).toBe(400);
  });

  it("deletes an unpaid invoice but blocks deleting a PAID one", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 4000 });
    const invoiceId = created.body.data.id;

    const del = await api
      .delete(`/api/v1/finance/invoices/${invoiceId}`)
      .set(auth(financeToken));
    expect(del.status).toBe(200);
    const gone = await db
      .selectFrom("invoices")
      .select("id")
      .where("id", "=", invoiceId)
      .executeTakeFirst();
    expect(gone).toBeUndefined();

    const paid = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 6000 });
    const paidId = paid.body.data.id;
    createdInvoiceIds.push(paidId);
    await api.post(`/api/v1/finance/invoices/${paidId}/pay`).set(auth(financeToken));
    const blocked = await api
      .delete(`/api/v1/finance/invoices/${paidId}`)
      .set(auth(financeToken));
    expect(blocked.status).toBe(400);
  });

  it("cross-tenant invoice edit returns 404", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(financeToken))
      .send({ amount: 2500 });
    createdInvoiceIds.push(created.body.data.id);
    const res = await api
      .put(`/api/v1/finance/invoices/${created.body.data.id}`)
      .set(auth(esAdminToken))
      .send({ amount: 1 });
    expect(res.status).toBe(404);
  });
});

describe("finance isolation and RBAC", () => {
  it("cross-tenant invoice pay returns 404", async () => {
    const created = await api
      .post("/api/v1/finance/invoices")
      .set(auth(adminToken))
      .send({ amount: 3000 });
    expect(created.status).toBe(201);
    createdInvoiceIds.push(created.body.data.id);

    const res = await api
      .post(`/api/v1/finance/invoices/${created.body.data.id}/pay`)
      .set(auth(esAdminToken));
    expect(res.status).toBe(404);
  });

  it("SALES_AGENT is denied the finance module", async () => {
    const res = await api.get("/api/v1/finance/summary").set(auth(salesToken));
    expect(res.status).toBe(403);
  });
});
