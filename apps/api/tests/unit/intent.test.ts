import { describe, expect, it } from "vitest";
import {
  INTENT_HALF_LIFE_DAYS,
  bandFor,
  blendLeadScore,
  computeIntent,
  decayFactor,
  type IntentEvent,
} from "../../src/services/ai/intent";
import {
  LIFECYCLE_TRANSITIONS,
  SEMANTIC_EVENTS,
  SEMANTIC_EVENT_NAMES,
  findSemanticEvent,
  nextLifecycleStage,
} from "../../src/constants/semantic-events.const";

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);

const ev = (event: string, weight: number, ago = 0): IntentEvent => ({
  event,
  weight,
  occurred_at: daysAgo(ago),
});

describe("decayFactor", () => {
  it("is full weight at zero age", () => {
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(-1000)).toBe(1);
  });

  it("halves at exactly one half-life", () => {
    expect(decayFactor(INTENT_HALF_LIFE_DAYS * 86_400_000)).toBeCloseTo(0.5, 6);
  });

  it("quarters at two half-lives", () => {
    expect(decayFactor(2 * INTENT_HALF_LIFE_DAYS * 86_400_000)).toBeCloseTo(0.25, 6);
  });

  it("decays smoothly rather than cliff-edging", () => {
    const a = decayFactor(13 * 86_400_000);
    const b = decayFactor(15 * 86_400_000);
    expect(a).toBeGreaterThan(b);
    expect(a - b).toBeLessThan(0.1);
  });
});

describe("computeIntent", () => {
  it("is zero and COLD with no events", () => {
    expect(computeIntent([], {}, NOW)).toEqual({ score: 0, band: "COLD", reasons: [] });
  });

  it("scores a fresh high-intent event well above a stale one", () => {
    const fresh = computeIntent([ev("checkout.started", 60, 0)], {}, NOW);
    const stale = computeIntent([ev("checkout.started", 60, 28)], {}, NOW);
    expect(fresh.score).toBeGreaterThan(stale.score);
    expect(fresh.score).toBeGreaterThan(30);
  });

  it("ignores events outside the 30-day window entirely", () => {
    expect(computeIntent([ev("checkout.started", 60, 45)], {}, NOW).score).toBe(0);
  });

  it("ignores events dated in the future", () => {
    // A producer with a skewed clock must not be able to inflate a score.
    const future: IntentEvent = {
      event: "checkout.started",
      weight: 60,
      occurred_at: new Date(NOW + 86_400_000),
    };
    expect(computeIntent([future], {}, NOW).score).toBe(0);
  });

  it("saturates rather than pegging at 100 from one huge day", () => {
    const many = Array.from({ length: 50 }, () => ev("pricing.viewed", 30, 0));
    const result = computeIntent(many, {}, NOW);
    expect(result.score).toBeGreaterThan(90);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("keeps more signal ranked above less", () => {
    const few = computeIntent([ev("pricing.viewed", 30, 0)], {}, NOW).score;
    const more = computeIntent(
      [ev("pricing.viewed", 30, 0), ev("checkout.started", 60, 0)],
      {},
      NOW
    ).score;
    expect(more).toBeGreaterThan(few);
  });

  it("floors a net-negative history at zero rather than going negative", () => {
    const result = computeIntent([ev("subscription.cancelled", -50, 1)], {}, NOW);
    expect(result.score).toBe(0);
    expect(result.band).toBe("COLD");
  });

  it("lets negative events pull a positive history down", () => {
    const withoutChurn = computeIntent([ev("trial.started", 40, 0)], {}, NOW).score;
    const withChurn = computeIntent(
      [ev("trial.started", 40, 0), ev("subscription.cancelled", -50, 0)],
      {},
      NOW
    ).score;
    expect(withChurn).toBeLessThan(withoutChurn);
  });

  it("groups repeated events into one reason with a count", () => {
    const result = computeIntent(
      [ev("pricing.viewed", 30, 0), ev("pricing.viewed", 30, 1), ev("pricing.viewed", 30, 2)],
      {},
      NOW
    );
    const pricing = result.reasons.find((r) => r.label.toLowerCase().includes("pricing"));
    expect(pricing?.count).toBe(3);
  });

  it("prefers the definition label over a derived one", () => {
    const result = computeIntent(
      [{ event: "limit.reached", label: "Hit a plan limit", weight: 55, occurred_at: daysAgo(0) }],
      {},
      NOW
    );
    expect(result.reasons[0].label).toBe("Hit a plan limit");
  });

  it("derives a readable label when the definition has none", () => {
    const result = computeIntent([ev("limit.reached", 55, 0)], {}, NOW);
    expect(result.reasons[0].label).toBe("Limit reached");
  });

  it("orders reasons by contribution, strongest first", () => {
    const result = computeIntent(
      [ev("page.viewed", 1, 0), ev("checkout.started", 60, 0), ev("feature.used", 5, 0)],
      {},
      NOW
    );
    expect(result.reasons[0].label.toLowerCase()).toContain("checkout");
  });

  it("never lists a negative contributor as a reason for a score", () => {
    const result = computeIntent(
      [ev("trial.started", 40, 0), ev("payment.failed", -15, 0)],
      {},
      NOW
    );
    expect(result.reasons.every((r) => r.weight > 0)).toBe(true);
  });

  it("adds the abandoned-checkout bonus with its own reason", () => {
    const without = computeIntent([ev("page.viewed", 1, 0)], {}, NOW);
    const withIt = computeIntent([ev("page.viewed", 1, 0)], { checkoutAbandoned: true }, NOW);
    expect(withIt.score).toBeGreaterThan(without.score);
    expect(withIt.reasons.some((r) => r.label.includes("did not finish"))).toBe(true);
  });

  it("skips zero-weight and malformed events without throwing", () => {
    const result = computeIntent(
      [
        ev("noise", 0, 0),
        { event: "bad", weight: Number.NaN, occurred_at: daysAgo(0) },
        { event: "worse", weight: 10, occurred_at: "not-a-date" },
      ],
      {},
      NOW
    );
    expect(result.score).toBe(0);
  });

  it("caps reasons at four so the panel stays readable", () => {
    const result = computeIntent(
      [
        ev("a.one", 10, 0),
        ev("b.two", 20, 0),
        ev("c.three", 30, 0),
        ev("d.four", 40, 0),
        ev("e.five", 50, 0),
        ev("f.six", 60, 0),
      ],
      {},
      NOW
    );
    expect(result.reasons).toHaveLength(4);
  });
});

describe("bandFor", () => {
  it("maps scores onto bands at the documented thresholds", () => {
    expect(bandFor(70)).toBe("HOT");
    expect(bandFor(69)).toBe("WARM");
    expect(bandFor(40)).toBe("WARM");
    expect(bandFor(39)).toBe("COLD");
    expect(bandFor(0)).toBe("COLD");
  });
});

describe("blendLeadScore", () => {
  const base = { interest: 60, intent: 50, engagement: 40, risk: 20 };
  const crmOnly = Math.round(60 * 0.3 + 50 * 0.4 + 40 * 0.3 - 20 * 0.15);

  it("reproduces the ORIGINAL formula exactly when there is no product data", () => {
    // Back-compat guarantee: a workspace with no integration must see the same
    // grades it saw before this feature existed.
    expect(blendLeadScore(base, null).total).toBe(crmOnly);
  });

  it("takes the higher of the two signals", () => {
    expect(blendLeadScore(base, 90).total).toBe(90);
    expect(blendLeadScore(base, 10).total).toBe(crmOnly);
  });

  it("never grades a product-hot lead below their product intent", () => {
    // The bug this prevents, seen in QA: a lead who viewed pricing three times
    // and abandoned a checkout scored 81 on product, had no CRM activity yet
    // (nobody had called them), and a weighted average graded them COLD, burying
    // the hottest person in the workspace.
    const untouched = { interest: 30, intent: 20, engagement: 15, risk: 35 };
    const result = blendLeadScore(untouched, 81);
    expect(result.total).toBe(81);
    expect(result.grade).toBe("HOT");
  });

  it("never punishes a sales-hot lead for being quiet in the product", () => {
    // The mirror case: someone deep in email conversations who has not logged
    // into the product must not be dragged down by a zero.
    const salesHot = { interest: 95, intent: 95, engagement: 90, risk: 5 };
    expect(blendLeadScore(salesHot, 0).total).toBe(blendLeadScore(salesHot, null).total);
  });

  it("clamps to 0-100 at both extremes", () => {
    const max = blendLeadScore({ interest: 100, intent: 100, engagement: 100, risk: 0 }, 100);
    expect(max.total).toBeLessThanOrEqual(100);
    const min = blendLeadScore({ interest: 0, intent: 0, engagement: 0, risk: 100 }, 0);
    expect(min.total).toBe(0);
  });

  it("keeps the existing HOT/WARM/COLD cutoffs", () => {
    expect(blendLeadScore({ interest: 100, intent: 100, engagement: 100, risk: 0 }, null).grade).toBe("HOT");
    expect(blendLeadScore({ interest: 0, intent: 0, engagement: 0, risk: 0 }, null).grade).toBe("COLD");
  });
});

// ---------------------------------------------------------------------------

describe("semantic events", () => {
  it("has unique names and in-range weights", () => {
    const names = SEMANTIC_EVENTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const e of SEMANTIC_EVENTS) {
      expect(e.intent_weight).toBeGreaterThanOrEqual(-100);
      expect(e.intent_weight).toBeLessThanOrEqual(100);
      expect(e.label).toBeTruthy();
    }
  });

  it("uses entity.action naming throughout", () => {
    for (const e of SEMANTIC_EVENTS) {
      expect(e.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("keeps the high-intent alert list short enough to stay meaningful", () => {
    const alerts = SEMANTIC_EVENTS.filter((e) => e.is_high_intent);
    expect(alerts.length).toBeGreaterThan(3);
    expect(alerts.length).toBeLessThanOrEqual(10);
  });

  it("scores buying signals above browsing signals", () => {
    const checkout = findSemanticEvent("checkout.started")!.intent_weight;
    const pageView = findSemanticEvent("page.viewed")!.intent_weight;
    expect(checkout).toBeGreaterThan(pageView * 10);
  });

  it("gives churn signals a negative weight", () => {
    expect(findSemanticEvent("subscription.cancelled")!.intent_weight).toBeLessThan(0);
    expect(findSemanticEvent("payment.failed")!.intent_weight).toBeLessThan(0);
  });

  it("only declares lifecycle transitions for known event names", () => {
    for (const name of Object.keys(LIFECYCLE_TRANSITIONS)) {
      expect(SEMANTIC_EVENT_NAMES.has(name)).toBe(true);
    }
  });
});

describe("nextLifecycleStage", () => {
  it("advances a visitor through the funnel", () => {
    expect(nextLifecycleStage("VISITOR", "signup.completed")).toBe("SIGNED_UP");
    expect(nextLifecycleStage("SIGNED_UP", "trial.started")).toBe("TRIAL");
    expect(nextLifecycleStage("TRIAL", "subscription.activated")).toBe("PAYING");
  });

  it("never demotes a paying customer on a redelivered earlier event", () => {
    // The bug this prevents: a webhook redelivery of signup.completed knocking
    // a paying customer back to SIGNED_UP, and with it their whole segmentation.
    expect(nextLifecycleStage("PAYING", "signup.completed")).toBeNull();
    expect(nextLifecycleStage("PAYING", "trial.started")).toBeNull();
  });

  it("allows the two explicit exits to move backwards", () => {
    expect(nextLifecycleStage("PAYING", "subscription.cancelled")).toBe("CHURNED");
    expect(nextLifecycleStage("TRIAL", "trial.expired")).toBe("SIGNED_UP");
  });

  it("lets a churned person re-enter the funnel", () => {
    expect(nextLifecycleStage("CHURNED", "trial.started")).toBe("TRIAL");
    expect(nextLifecycleStage("CHURNED", "subscription.activated")).toBe("PAYING");
  });

  it("returns null for a no-op and for an event with no transition", () => {
    expect(nextLifecycleStage("TRIAL", "trial.started")).toBeNull();
    expect(nextLifecycleStage("VISITOR", "page.viewed")).toBeNull();
  });

  it("treats an unknown or missing current stage as VISITOR", () => {
    expect(nextLifecycleStage(null, "signup.completed")).toBe("SIGNED_UP");
    expect(nextLifecycleStage("NONSENSE", "signup.completed")).toBe("SIGNED_UP");
  });
});
