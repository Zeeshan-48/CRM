import { describe, expect, it } from "vitest";
import {
  MAX_TOP_PRODUCTS,
  MAX_USAGE_KEYS,
  emptyProfileState,
  foldEvent,
  toProfileState,
  type FoldInput,
  type ProfileState,
} from "../../src/services/engagement-fold";

const AT = "2026-08-17T12:00:00.000Z";
const LATER = "2026-08-18T12:00:00.000Z";

const input = (over: Partial<FoldInput> = {}): FoldInput => ({
  event: "feature.used",
  occurredAtIso: AT,
  properties: {},
  ...over,
});

const fold = (state: ProfileState, over: Partial<FoldInput> = {}) => foldEvent(state, input(over));

describe("foldEvent purity", () => {
  it("does not mutate the input state", () => {
    const before = emptyProfileState();
    const snapshot = JSON.stringify(before);
    fold(before, { event: "checkout.started" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("is deterministic", () => {
    const a = fold(emptyProfileState(), { event: "trial.started" });
    const b = fold(emptyProfileState(), { event: "trial.started" });
    expect(a).toEqual(b);
  });
});

describe("lifecycle", () => {
  it("advances through the funnel", () => {
    let s = emptyProfileState();
    expect(s.lifecycle_stage).toBe("VISITOR");
    s = fold(s, { event: "signup.completed" });
    expect(s.lifecycle_stage).toBe("SIGNED_UP");
    s = fold(s, { event: "trial.started" });
    expect(s.lifecycle_stage).toBe("TRIAL");
    s = fold(s, { event: "subscription.activated" });
    expect(s.lifecycle_stage).toBe("PAYING");
  });

  it("never demotes a paying customer on a redelivered earlier event", () => {
    let s = fold(emptyProfileState(), { event: "subscription.activated" });
    s = fold(s, { event: "signup.completed" });
    expect(s.lifecycle_stage).toBe("PAYING");
  });

  it("moves to CHURNED on cancellation", () => {
    let s = fold(emptyProfileState(), { event: "subscription.activated" });
    s = fold(s, { event: "subscription.cancelled" });
    expect(s.lifecycle_stage).toBe("CHURNED");
    expect(s.plan_status).toBe("cancelled");
  });
});

describe("checkout abandonment", () => {
  it("marks abandonment on start and captures the cart", () => {
    const s = fold(emptyProfileState(), {
      event: "checkout.started",
      properties: { value: 499900, currency: "INR", coupon: "AUG20" },
      product: { id: "p1", external_id: "course_712", name: "Advanced React" },
    });
    expect(s.checkout_abandoned_at).toBe(AT);
    expect(s.abandoned_cart).toMatchObject({
      product_id: "p1",
      name: "Advanced React",
      value_minor: 499900,
      currency: "INR",
      coupon: "AUG20",
    });
  });

  it("clears abandonment when the purchase completes", () => {
    // "Abandoned" is computed our side: the product never has to tell us it was
    // abandoned, it just has to tell us when it was completed.
    let s = fold(emptyProfileState(), { event: "checkout.started" });
    s = fold(s, { event: "checkout.completed", occurredAtIso: LATER });
    expect(s.checkout_abandoned_at).toBeNull();
    expect(s.abandoned_cart).toBeNull();
    expect(s.plan_status).toBe("active");
  });

  it("clears abandonment when a subscription activates instead", () => {
    let s = fold(emptyProfileState(), { event: "checkout.started" });
    s = fold(s, { event: "subscription.activated", occurredAtIso: LATER });
    expect(s.checkout_abandoned_at).toBeNull();
  });
});

describe("plan facts", () => {
  it("reads plan name from any of the accepted property spellings", () => {
    expect(fold(emptyProfileState(), { properties: { plan: "Growth" } }).plan_name).toBe("Growth");
    expect(fold(emptyProfileState(), { properties: { plan_name: "Pro" } }).plan_name).toBe("Pro");
    // resource_label is what the legacy LMS contract sent.
    expect(fold(emptyProfileState(), { properties: { resource_label: "Scale" } }).plan_name).toBe("Scale");
  });

  it("tracks MRR and currency", () => {
    const s = fold(emptyProfileState(), { properties: { mrr: 99900, currency: "usd" } });
    expect(s.mrr_minor).toBe(99900);
    expect(s.currency).toBe("USD");
  });

  it("maps payment failure to a plan status without touching lifecycle", () => {
    let s = fold(emptyProfileState(), { event: "subscription.activated" });
    s = fold(s, { event: "payment.failed" });
    expect(s.plan_status).toBe("payment_failed");
    expect(s.lifecycle_stage).toBe("PAYING");
  });

  it("keeps the earliest signup timestamp across redeliveries", () => {
    let s = fold(emptyProfileState(), { event: "signup.completed", occurredAtIso: LATER });
    s = fold(s, { event: "signup.completed", occurredAtIso: AT });
    expect(s.signup_at).toBe(AT);
  });
});

describe("usage bag", () => {
  it("counts every event by name, including product-specific ones", () => {
    // The point of the generic model: the CRM has never heard of
    // "invoice.exported" and still records it usefully.
    let s = fold(emptyProfileState(), { event: "invoice.exported" });
    s = fold(s, { event: "invoice.exported" });
    s = fold(s, { event: "feature.used" });
    expect(s.usage.counts).toEqual({ "invoice.exported": 2, "feature.used": 1 });
  });

  it("SETS product-reported counters rather than accumulating them", () => {
    // The product stating "12 seats used" is a fact about now, not an increment.
    let s = fold(emptyProfileState(), { properties: { counters: { seats_used: 12 } } });
    s = fold(s, { properties: { counters: { seats_used: 9 } } });
    expect(s.usage.reported).toEqual({ seats_used: 9 });
  });

  it("ignores non-numeric reported counters", () => {
    const s = fold(emptyProfileState(), { properties: { counters: { seats: "many", ok: 3 } } });
    expect(s.usage.reported).toEqual({ ok: 3 });
  });

  it("bounds the bag so a producer cannot grow one row without limit", () => {
    let s = emptyProfileState();
    for (let i = 0; i < MAX_USAGE_KEYS + 20; i += 1) {
      s = fold(s, { event: `custom.event_${i}` });
    }
    expect(Object.keys(s.usage.counts ?? {}).length).toBe(MAX_USAGE_KEYS);
  });

  it("keeps counting an already-tracked key after the cap is reached", () => {
    let s = emptyProfileState();
    for (let i = 0; i < MAX_USAGE_KEYS; i += 1) s = fold(s, { event: `custom.event_${i}` });
    s = fold(s, { event: "custom.event_0" });
    expect(s.usage.counts?.["custom.event_0"]).toBe(2);
  });
});

describe("top products", () => {
  it("tracks views per product and orders by most viewed", () => {
    let s = emptyProfileState();
    const react = { id: "p1", external_id: "c1", name: "React" };
    const vue = { id: "p2", external_id: "c2", name: "Vue" };
    s = fold(s, { event: "content.viewed", product: vue });
    s = fold(s, { event: "content.viewed", product: react });
    s = fold(s, { event: "content.viewed", product: react });
    expect(s.top_products[0]).toMatchObject({ product_id: "p1", views: 2 });
    expect(s.top_products[1]).toMatchObject({ product_id: "p2", views: 1 });
  });

  it("keeps the latest view timestamp and never regresses it", () => {
    let s = fold(emptyProfileState(), {
      product: { id: "p1", external_id: null, name: "X" },
      occurredAtIso: LATER,
    });
    s = fold(s, { product: { id: "p1", external_id: null, name: "X" }, occurredAtIso: AT });
    expect(s.top_products[0].last_at).toBe(LATER);
  });

  it("caps the list so the panel stays readable", () => {
    let s = emptyProfileState();
    for (let i = 0; i < MAX_TOP_PRODUCTS + 5; i += 1) {
      s = fold(s, { product: { id: `p${i}`, external_id: null, name: `P${i}` } });
    }
    expect(s.top_products).toHaveLength(MAX_TOP_PRODUCTS);
  });

  it("matches on external_id when the product is not in the catalog yet", () => {
    let s = fold(emptyProfileState(), { product: { id: null, external_id: "c9", name: "Unlisted" } });
    s = fold(s, { product: { id: null, external_id: "c9", name: "Unlisted" } });
    expect(s.top_products).toHaveLength(1);
    expect(s.top_products[0].views).toBe(2);
  });

  it("ignores an empty product reference", () => {
    const s = fold(emptyProfileState(), { product: { id: null, external_id: null, name: null } });
    expect(s.top_products).toHaveLength(0);
  });
});

describe("toProfileState", () => {
  const row = {
    lifecycle_stage: "TRIAL",
    plan_name: "Growth",
    plan_status: "trialing",
    mrr_minor: 99900,
    currency: "INR",
    signup_at: new Date(AT),
    trial_ends_at: null,
    checkout_abandoned_at: null,
    abandoned_cart: null,
    top_products: null,
    usage: null,
  };

  it("reads a stored row back into the pure state shape", () => {
    const state = toProfileState(row);
    expect(state.lifecycle_stage).toBe("TRIAL");
    expect(state.signup_at).toBe(AT);
    expect(state.top_products).toEqual([]);
    expect(state.usage).toEqual({});
  });

  it("parses JSON columns handed back as strings by the driver", () => {
    const state = toProfileState({
      ...row,
      usage: JSON.stringify({ counts: { "a.b": 2 } }),
      top_products: JSON.stringify([{ product_id: "p1", external_id: null, name: "X", views: 1, last_at: AT }]),
    });
    expect(state.usage.counts).toEqual({ "a.b": 2 });
    expect(state.top_products).toHaveLength(1);
  });

  it("falls back rather than throwing on malformed JSON", () => {
    const state = toProfileState({ ...row, usage: "{not json", top_products: "[[[" });
    expect(state.usage).toEqual({});
    expect(state.top_products).toEqual([]);
  });

  it("round-trips through a fold", () => {
    const restored = toProfileState({ ...row, usage: JSON.stringify({ counts: { "x.y": 1 } }) });
    const next = fold(restored, { event: "x.y" });
    expect(next.usage.counts).toEqual({ "x.y": 2 });
    expect(next.lifecycle_stage).toBe("TRIAL");
  });
});
