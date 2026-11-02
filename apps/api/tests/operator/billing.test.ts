import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../src/config";
import { closeDB, db } from "../../src/db/connection";
import billingService from "../../src/services/operator/billing.service";
import { api, auth, login, ROOT_OPERATOR } from "./helpers";

// Platform billing runs in simulate mode under tests (BILLING_SIMULATE + VITEST):
// gateway calls return canned subscriptions, but webhook signature verification
// is real crypto, we sign synthetic events with the configured webhook secrets.

const marker = Date.now().toString(36);
const suiteStart = new Date(Date.now() - 1000);

let rootToken: string;
const createdTenantIds: string[] = [];
const createdEventIds: string[] = [];

function razorpaySig(rawBody: string): string {
  return crypto.createHmac("sha256", config.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

function stripeSig(rawBody: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", config.STRIPE_WEBHOOK_SECRET)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  return `t=${t},v1=${v1}`;
}

async function onboardWithBilling(gateway: "RAZORPAY" | "STRIPE", tag: string) {
  const res = await api
    .post("/api/v1/operator/tenants")
    .set(auth(rootToken))
    .send({
      name: `QA Billing ${tag} ${marker}`,
      plan_key: "GROWTH",
      gateway,
      admin: { name: "QA Admin", email: `qa-billing-${tag}-${marker}@example.com` },
    });
  if (res.status === 201) createdTenantIds.push(res.body.data.tenant.id);
  return res;
}

const subRow = (tenantId: string) =>
  db
    .selectFrom("tenant_subscriptions")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .executeTakeFirst();

const tenantStatus = async (tenantId: string) =>
  (
    await db
      .selectFrom("tenants")
      .select("status")
      .where("id", "=", tenantId)
      .executeTakeFirstOrThrow()
  ).status;

beforeAll(async () => {
  rootToken = await login(ROOT_OPERATOR.email, ROOT_OPERATOR.password);
  // Ensure GROWTH is billable on both gateways (self-contained, idempotent).
  for (const gateway of ["RAZORPAY", "STRIPE"] as const) {
    await db
      .insertInto("plan_gateway_refs")
      .values({
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 26),
        plan_key: "GROWTH",
        gateway,
        billing_interval: "MONTHLY",
        external_plan_id: gateway === "RAZORPAY" ? "rzp_plan_growth" : "price_growth",
        amount: 499900,
        currency: "INR",
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) => oc.columns(["plan_key", "gateway", "billing_interval"]).doNothing())
      .execute();
  }
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  for (const id of createdTenantIds) {
    await db.deleteFrom("tenants").where("id", "=", id).execute(); // cascades subs + txns
  }
  if (createdEventIds.length) {
    await db.deleteFrom("platform_webhook_events").where("event_id", "in", createdEventIds).execute();
  }
  // Idempotency keys are now derived from the signed body (rzp_<hash>), so also
  // clear anything this suite produced by time window.
  await db.deleteFrom("platform_webhook_events").where("created_at", ">=", suiteStart).execute();
  await db.deleteFrom("operator_audit_logs").where("created_at", ">=", suiteStart).execute();
  await closeDB();
});

describe("onboarding with upfront payment", () => {
  it("creates the tenant SUSPENDED with a PENDING subscription and a checkout url", async () => {
    const res = await onboardWithBilling("RAZORPAY", "onb");
    expect(res.status).toBe(201);
    expect(res.body.data.tenant.status).toBe("SUSPENDED");
    expect(res.body.data.checkoutUrl).toBeTruthy();
    expect(res.body.data.subscription.status).toBe("PENDING");
    expect(res.body.data.subscription.gateway).toBe("RAZORPAY");

    const sub = await subRow(res.body.data.tenant.id);
    expect(sub?.status).toBe("PENDING");
    expect(sub?.gateway_subscription_id).toBeTruthy();
  });

  it("rejects onboarding on a gateway with no plan ref (400)", async () => {
    const res = await api
      .post("/api/v1/operator/tenants")
      .set(auth(rootToken))
      .send({
        name: `QA NoRef ${marker}`,
        plan_key: "STARTER",
        gateway: "NOPEPAY",
        admin: { name: "X", email: `qa-noref-${marker}@example.com` },
      });
    expect(res.status).toBe(400);
  });

  it("still onboards WITHOUT a gateway as an active tenant (legacy path)", async () => {
    const res = await api
      .post("/api/v1/operator/tenants")
      .set(auth(rootToken))
      .send({
        name: `QA Legacy ${marker}`,
        plan_key: "GROWTH",
        admin: { name: "X", email: `qa-legacy-${marker}@example.com` },
      });
    expect(res.status).toBe(201);
    if (res.status === 201) createdTenantIds.push(res.body.data.tenant.id);
    expect(res.body.data.tenant.status).toBe("ACTIVE");
    expect(res.body.data.subscription).toBeNull();
    expect(res.body.data.checkoutUrl).toBeNull();
  });
});

describe("razorpay webhook lifecycle", () => {
  let tenantId: string;
  let gatewaySubId: string;

  beforeAll(async () => {
    const res = await onboardWithBilling("RAZORPAY", "rzp");
    tenantId = res.body.data.tenant.id;
    gatewaySubId = res.body.data.subscription.gateway_subscription_id;
  });

  const chargedBody = (invoiceId: string) =>
    JSON.stringify({
      event: "subscription.charged",
      payload: {
        subscription: {
          entity: { id: gatewaySubId, current_end: Math.floor(Date.now() / 1000) + 30 * 86400 },
        },
        payment: { entity: { id: "pay_" + invoiceId, amount: 499900, currency: "INR", invoice_id: invoiceId } },
      },
    });

  it("rejects a bad signature with 401 and no state change", async () => {
    const body = chargedBody(`inv_bad_${marker}`);
    const res = await api
      .post("/api/v1/operator/webhooks/razorpay")
      .set("x-razorpay-signature", "deadbeef")
      .set("x-razorpay-event-id", `evt_bad_${marker}`)
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(401);
    expect(await tenantStatus(tenantId)).toBe("SUSPENDED");
  });

  it("activates the subscription + tenant and records a PAID transaction", async () => {
    const eventId = `evt_charged_${marker}`;
    createdEventIds.push(eventId);
    const body = chargedBody(`inv_ok_${marker}`);
    const res = await api
      .post("/api/v1/operator/webhooks/razorpay")
      .set("x-razorpay-signature", razorpaySig(body))
      .set("x-razorpay-event-id", eventId)
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(200);

    const sub = await subRow(tenantId);
    expect(sub?.status).toBe("ACTIVE");
    expect(await tenantStatus(tenantId)).toBe("ACTIVE");

    const txns = await db
      .selectFrom("platform_transactions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .execute();
    expect(txns.length).toBe(1);
    expect(txns[0].status).toBe("PAID");
    expect(txns[0].amount).toBe(499900);
  });

  it("is idempotent: replaying the same event id records no duplicate txn", async () => {
    const eventId = `evt_charged_${marker}`; // same id as above
    const body = chargedBody(`inv_ok_${marker}`);
    const res = await api
      .post("/api/v1/operator/webhooks/razorpay")
      .set("x-razorpay-signature", razorpaySig(body))
      .set("x-razorpay-event-id", eventId)
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(200);
    const txns = await db
      .selectFrom("platform_transactions")
      .select(db.fn.countAll().as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow();
    expect(Number(txns.n)).toBe(1);
  });

  it("payment_failed moves it to PAST_DUE with a grace window", async () => {
    const eventId = `evt_failed_${marker}`;
    createdEventIds.push(eventId);
    const body = JSON.stringify({
      event: "subscription.pending",
      payload: { subscription: { entity: { id: gatewaySubId } } },
    });
    const res = await api
      .post("/api/v1/operator/webhooks/razorpay")
      .set("x-razorpay-signature", razorpaySig(body))
      .set("x-razorpay-event-id", eventId)
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(200);
    const sub = await subRow(tenantId);
    expect(sub?.status).toBe("PAST_DUE");
    expect(sub?.grace_until).toBeTruthy();
    // Still live during grace.
    expect(await tenantStatus(tenantId)).toBe("ACTIVE");
  });
});

describe("enforcement sweep (dunning -> suspend)", () => {
  it("expires a PAST_DUE subscription past its grace window and suspends the tenant", async () => {
    const res = await onboardWithBilling("RAZORPAY", "sweep");
    const tenantId = res.body.data.tenant.id;
    const sub = await subRow(tenantId);

    // Force an expired grace window and an active workspace, then sweep.
    await db
      .updateTable("tenant_subscriptions")
      .set({ status: "PAST_DUE", grace_until: new Date(Date.now() - 86400000) })
      .where("id", "=", sub!.id)
      .execute();
    await db.updateTable("tenants").set({ status: "ACTIVE" }).where("id", "=", tenantId).execute();

    const result = await billingService.sweep();
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const after = await subRow(tenantId);
    expect(after?.status).toBe("EXPIRED");
    expect(await tenantStatus(tenantId)).toBe("SUSPENDED");
  });

  it("moves an ACTIVE subscription past its period end to PAST_DUE", async () => {
    const res = await onboardWithBilling("RAZORPAY", "lapse");
    const tenantId = res.body.data.tenant.id;
    const sub = await subRow(tenantId);
    await db
      .updateTable("tenant_subscriptions")
      .set({ status: "ACTIVE", grace_until: null, current_period_end: new Date(Date.now() - 86400000) })
      .where("id", "=", sub!.id)
      .execute();

    await billingService.sweep();
    const after = await subRow(tenantId);
    expect(after?.status).toBe("PAST_DUE");
    expect(after?.grace_until).toBeTruthy();
  });
});

describe("stripe webhook activation", () => {
  it("activates via invoice.paid", async () => {
    const res = await onboardWithBilling("STRIPE", "stripe");
    const tenantId = res.body.data.tenant.id;
    const gatewaySubId = res.body.data.subscription.gateway_subscription_id;

    const eventId = `evt_stripe_${marker}`;
    createdEventIds.push(eventId);
    const body = JSON.stringify({
      id: eventId,
      type: "invoice.paid",
      data: {
        object: {
          id: `in_${marker}`,
          subscription: gatewaySubId,
          amount_paid: 499900,
          currency: "inr",
          period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          hosted_invoice_url: "https://pay.stripe.test/inv",
          payment_intent: "pi_1",
        },
      },
    });
    const resp = await api
      .post("/api/v1/operator/webhooks/stripe")
      .set("stripe-signature", stripeSig(body))
      .set("Content-Type", "application/json")
      .send(body);
    expect(resp.status).toBe(200);

    const sub = await subRow(tenantId);
    expect(sub?.status).toBe("ACTIVE");
    expect(await tenantStatus(tenantId)).toBe("ACTIVE");
  });
});

describe("manual (non-auto) billing", () => {
  it("onboards MANUAL, activates via payment_link.paid, and renews", async () => {
    // Start a MANUAL subscription directly via the operator API.
    const onboard = await onboardWithBilling("RAZORPAY", "man");
    const tenantId = onboard.body.data.tenant.id;
    // Switch it to MANUAL by re-creating in manual mode.
    const created = await api
      .post(`/api/v1/operator/tenants/${tenantId}/subscription`)
      .set(auth(rootToken))
      .send({ gateway: "RAZORPAY", billingMode: "MANUAL" });
    expect(created.status).toBe(201);
    expect(created.body.data.subscription.billing_mode).toBe("MANUAL");
    expect(created.body.data.checkoutUrl).toBeTruthy();

    const sub = await subRow(tenantId);
    expect(sub?.status).toBe("PENDING");

    // Pay the one-time link → payment_link.paid webhook.
    const eventId = `evt_plink_${marker}`;
    createdEventIds.push(eventId);
    const body = JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: { entity: { reference_id: `pmsub_${sub!.id}` } },
        payment: { entity: { id: `pay_man_${marker}`, amount: 499900, currency: "INR", invoice_id: `inv_man_${marker}` } },
      },
    });
    const res = await api
      .post("/api/v1/operator/webhooks/razorpay")
      .set("x-razorpay-signature", razorpaySig(body))
      .set("x-razorpay-event-id", eventId)
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(200);

    const after = await subRow(tenantId);
    expect(after?.status).toBe("ACTIVE");
    expect(after?.current_period_end).toBeTruthy();
    expect(await tenantStatus(tenantId)).toBe("ACTIVE");
  });

  it("does not extend the period when the same manual payment is replayed", async () => {
    const res = await onboardWithBilling("RAZORPAY", "idem");
    const tenantId = res.body.data.tenant.id;
    const sub = await subRow(tenantId);
    const invoiceId = `inv_idem_${marker}`;
    // Same payment/invoice id, different body each time → different signed-body
    // idempotency key (bypasses the webhook-event ledger) so we actually exercise
    // the payment-level idempotency in manualRenewByRef.
    const mk = (nonce: string) =>
      JSON.stringify({
        event: "payment_link.paid",
        nonce,
        payload: {
          payment_link: { entity: { reference_id: `pmsub_${sub!.id}` } },
          payment: {
            entity: { id: `pay_idem_${marker}`, amount: 499900, currency: "INR", invoice_id: invoiceId },
          },
        },
      });
    const send = (b: string) =>
      api
        .post("/api/v1/operator/webhooks/razorpay")
        .set("x-razorpay-signature", razorpaySig(b))
        .set("Content-Type", "application/json")
        .send(b);

    expect((await send(mk("a"))).status).toBe(200);
    const firstEnd = (await subRow(tenantId))?.current_period_end;

    expect((await send(mk("b"))).status).toBe(200);
    const secondEnd = (await subRow(tenantId))?.current_period_end;

    expect(secondEnd).toEqual(firstEnd); // replay must NOT extend the period again
    const txns = await db
      .selectFrom("platform_transactions")
      .select(db.fn.countAll().as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow();
    expect(Number(txns.n)).toBe(1); // exactly one PAID row for the one payment
  });

  it("tenant can turn auto-renew OFF then back ON", async () => {
    const onboard = await onboardWithBilling("RAZORPAY", "mode");
    const tenantId = onboard.body.data.tenant.id;
    // Activate it first.
    const sub = await subRow(tenantId);
    await db.updateTable("tenant_subscriptions").set({ status: "ACTIVE" }).where("id", "=", sub!.id).execute();
    await db.updateTable("tenants").set({ status: "ACTIVE" }).where("id", "=", tenantId).execute();

    const off = await api
      .post(`/api/v1/operator/tenants/${tenantId}/subscription`)
      .set(auth(rootToken))
      .send({ gateway: "RAZORPAY", billingMode: "AUTO" }); // reset to a clean AUTO live sub
    expect(off.status).toBe(201);
    const liveSub = await subRow(tenantId);
    await db.updateTable("tenant_subscriptions").set({ status: "ACTIVE" }).where("id", "=", liveSub!.id).execute();

    // Operator/tenant service: switch to MANUAL then AUTO via the service layer.
    const manual = await billingService.setMode({ id: "op", email: "op@test" }, tenantId, "MANUAL");
    expect(manual.subscription.billing_mode).toBe("MANUAL");
    const auto = await billingService.setMode({ id: "op", email: "op@test" }, tenantId, "AUTO");
    expect(auto.subscription.billing_mode).toBe("AUTO");
  });
});

describe("cancel + metrics + reads", () => {
  it("immediate cancel suspends the workspace", async () => {
    const res = await onboardWithBilling("RAZORPAY", "cancel");
    const tenantId = res.body.data.tenant.id;
    // Activate first so there is a live subscription to cancel.
    const sub = await subRow(tenantId);
    await db.updateTable("tenant_subscriptions").set({ status: "ACTIVE" }).where("id", "=", sub!.id).execute();
    await db.updateTable("tenants").set({ status: "ACTIVE" }).where("id", "=", tenantId).execute();

    const cancel = await api
      .post(`/api/v1/operator/tenants/${tenantId}/subscription/cancel`)
      .set(auth(rootToken))
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELED");
    expect(await tenantStatus(tenantId)).toBe("SUSPENDED");
  });

  it("reads the subscription and transactions for a tenant", async () => {
    const tenantId = createdTenantIds[0];
    const sub = await api.get(`/api/v1/operator/tenants/${tenantId}/subscription`).set(auth(rootToken));
    expect(sub.status).toBe(200);
    expect(sub.body.data.subscription).toBeTruthy();

    const txns = await api.get(`/api/v1/operator/tenants/${tenantId}/transactions`).set(auth(rootToken));
    expect(txns.status).toBe(200);
    expect(Array.isArray(txns.body.data)).toBe(true);
  });

  it("returns billing metrics", async () => {
    const res = await api.get("/api/v1/operator/billing/metrics").set(auth(rootToken));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.mrr).toBe("number");
    expect(typeof res.body.data.byStatus).toBe("object");
    expect(Array.isArray(res.body.data.upcomingRenewals)).toBe(true);
  });
});
