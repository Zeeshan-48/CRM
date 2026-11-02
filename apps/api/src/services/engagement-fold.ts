// Folds one product event into a person's engagement profile.
//
// This is the generic replacement for the old `applyEventToSnapshot`, whose
// fields were LMS domain concepts (plan_status, content_published,
// published_by_type). Nothing here knows what a course, a seat or a workspace
// is. Product-specific counters live in `usage`, NAMED BY THE PRODUCT, and are
// rendered generically from the event definitions. That is what lets a new
// product integrate with zero CRM code change.
//
// Pure: same inputs, same output, no I/O. Double-counting is prevented upstream
// by the idempotency key, so counters here only ever advance once per real event.

import { canonicalEventName, nextLifecycleStage } from "../constants/semantic-events.const";
import { normalizeCurrency, toMinorUnits } from "../utils/money";

export const MAX_TOP_PRODUCTS = 5;
export const MAX_USAGE_KEYS = 40;

export interface UsageBag {
  /** How many times each event name has been seen. Counted by us. */
  counts?: Record<string, number>;
  /** Values the PRODUCT reported directly, e.g. { seats_used: 12 }. */
  reported?: Record<string, number>;
}

export interface TopProduct {
  product_id: string | null;
  external_id: string | null;
  name: string | null;
  views: number;
  last_at: string;
}

export interface ProfileState {
  lifecycle_stage: string;
  plan_name: string | null;
  plan_status: string | null;
  mrr_minor: number | null;
  currency: string | null;
  signup_at: string | null;
  trial_ends_at: string | null;
  checkout_abandoned_at: string | null;
  abandoned_cart: Record<string, unknown> | null;
  top_products: TopProduct[];
  usage: UsageBag;
}

export interface FoldInput {
  event: string;
  occurredAtIso: string;
  properties: Record<string, unknown>;
  /** Catalog product this event referenced, once resolved. */
  product?: { id: string | null; external_id: string | null; name: string | null } | null;
}

export const emptyProfileState = (): ProfileState => ({
  lifecycle_stage: "VISITOR",
  plan_name: null,
  plan_status: null,
  mrr_minor: null,
  currency: null,
  signup_at: null,
  trial_ends_at: null,
  checkout_abandoned_at: null,
  abandoned_cart: null,
  top_products: [],
  usage: {},
});

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

const isoOrNull = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// Keeps the earliest of two ISO timestamps, tolerating either being absent.
const earliest = (current: string | null, incoming: string): string =>
  !current || incoming < current ? incoming : current;

/**
 * Folds one event into the profile and returns the next state.
 *
 * Every rule here is deliberately generic. The only event names it reacts to are
 * the reserved semantic ones; anything else contributes to `usage.counts` and to
 * `top_products`, which is enough for the UI to render it meaningfully.
 */
export const foldEvent = (existing: ProfileState, input: FoldInput): ProfileState => {
  const next: ProfileState = {
    ...existing,
    usage: {
      counts: { ...(existing.usage?.counts ?? {}) },
      reported: { ...(existing.usage?.reported ?? {}) },
    },
    top_products: [...(existing.top_products ?? [])],
  };
  const { occurredAtIso, properties } = input;

  // Legacy producers speak their own vocabulary (plan.activated, ...). Resolving
  // to the canonical semantic name here means the rules below stay generic and
  // the old contract keeps behaving identically, with no LMS names in this file.
  const event = canonicalEventName(input.event);

  // ---- Lifecycle. Forward-only except the two explicit exits, so a redelivered
  // signup event can never demote a paying customer. ----
  const stage = nextLifecycleStage(next.lifecycle_stage, event);
  if (stage) next.lifecycle_stage = stage;

  // ---- Plan facts the product reports, whatever the event. ----
  const plan = str(properties.plan) || str(properties.plan_name) || str(properties.resource_label);
  if (plan) next.plan_name = plan.slice(0, 200);

  // A product may state its own plan status outright. Applied BEFORE the
  // semantic switch so an explicit lifecycle event still wins, and so a product
  // with a status the CRM has no event for (grace period, paused, dunning) can
  // still surface it to the agent.
  const reportedStatus = str(properties.plan_status);
  if (reportedStatus) next.plan_status = reportedStatus.slice(0, 60);

  const currency = properties.currency ? normalizeCurrency(properties.currency) : null;
  if (currency) next.currency = currency;

  const mrr = toMinorUnits(properties.mrr_minor ?? properties.mrr);
  if (mrr !== null) next.mrr_minor = mrr;

  const trialEnds = isoOrNull(properties.trial_ends_at);
  if (trialEnds) next.trial_ends_at = trialEnds;

  // ---- Counters ----
  const counts = next.usage.counts as Record<string, number>;
  // Counted under the RAW name, not the canonical alias: the usage bag is what
  // the UI renders back to the admin, and it must show the vocabulary their
  // product actually sends, not our internal normalization of it.
  // Bounded so a producer emitting a unique event name per request cannot grow
  // one row without limit.
  const countKey = input.event;
  if (counts[countKey] !== undefined || Object.keys(counts).length < MAX_USAGE_KEYS) {
    counts[countKey] = (counts[countKey] ?? 0) + 1;
  }

  // Values the product states outright ("this account has 12 seats used") beat
  // anything we could infer, so they are SET rather than accumulated.
  const reportedRaw = properties.counters;
  if (reportedRaw && typeof reportedRaw === "object" && !Array.isArray(reportedRaw)) {
    const reported = next.usage.reported as Record<string, number>;
    for (const [key, value] of Object.entries(reportedRaw as Record<string, unknown>)) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (reported[key] === undefined && Object.keys(reported).length >= MAX_USAGE_KEYS) continue;
      reported[key] = n;
    }
  }

  // ---- Semantic reactions ----
  switch (event) {
    case "signup.completed":
      next.signup_at = earliest(next.signup_at, occurredAtIso);
      break;

    case "trial.started":
      next.plan_status = "trialing";
      break;

    case "trial.expired":
      next.plan_status = "trial_expired";
      break;

    case "checkout.started":
      // "Abandoned" is computed on our side: set on start, cleared on completion.
      // The product does not have to tell us; it just has to stop telling us.
      next.checkout_abandoned_at = occurredAtIso;
      next.abandoned_cart = {
        product_id: input.product?.id ?? null,
        external_id: input.product?.external_id ?? null,
        name: input.product?.name ?? str(properties.name) ?? null,
        value_minor: toMinorUnits(properties.value ?? properties.value_minor),
        currency: currency ?? next.currency,
        coupon: str(properties.coupon) || null,
      };
      break;

    case "checkout.abandoned":
      next.checkout_abandoned_at = occurredAtIso;
      break;

    case "checkout.completed":
    case "subscription.activated":
      next.checkout_abandoned_at = null;
      next.abandoned_cart = null;
      next.plan_status = "active";
      break;

    case "subscription.renewed":
      next.plan_status = "active";
      break;

    case "subscription.cancelled":
      next.plan_status = "cancelled";
      break;

    case "payment.failed":
      next.plan_status = "payment_failed";
      break;

    default:
      break;
  }

  // ---- Most-viewed catalog items, so an agent knows what to talk about ----
  const ref = input.product;
  if (ref && (ref.id || ref.external_id)) {
    const key = ref.id ?? ref.external_id;
    const idx = next.top_products.findIndex((p) => (p.product_id ?? p.external_id) === key);
    if (idx >= 0) {
      const current = next.top_products[idx];
      next.top_products[idx] = {
        ...current,
        name: ref.name ?? current.name,
        views: current.views + 1,
        last_at: occurredAtIso > current.last_at ? occurredAtIso : current.last_at,
      };
    } else {
      next.top_products.push({
        product_id: ref.id,
        external_id: ref.external_id,
        name: ref.name,
        views: 1,
        last_at: occurredAtIso,
      });
    }
    next.top_products.sort((a, b) => b.views - a.views || b.last_at.localeCompare(a.last_at));
    next.top_products = next.top_products.slice(0, MAX_TOP_PRODUCTS);
  }

  return next;
};

/** Reads a stored profile row back into the pure state shape. */
export const toProfileState = (row: {
  lifecycle_stage: string;
  plan_name: string | null;
  plan_status: string | null;
  mrr_minor: number | null;
  currency: string | null;
  signup_at: Date | null;
  trial_ends_at: Date | null;
  checkout_abandoned_at: Date | null;
  abandoned_cart: unknown;
  top_products: unknown;
  usage: unknown;
}): ProfileState => {
  const parse = <T>(value: unknown, fallback: T): T => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
    return value as T;
  };

  return {
    lifecycle_stage: row.lifecycle_stage || "VISITOR",
    plan_name: row.plan_name,
    plan_status: row.plan_status,
    mrr_minor: row.mrr_minor,
    currency: row.currency,
    signup_at: row.signup_at ? new Date(row.signup_at).toISOString() : null,
    trial_ends_at: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    checkout_abandoned_at: row.checkout_abandoned_at
      ? new Date(row.checkout_abandoned_at).toISOString()
      : null,
    abandoned_cart: parse<Record<string, unknown> | null>(row.abandoned_cart, null),
    top_products: parse<TopProduct[]>(row.top_products, []),
    usage: parse<UsageBag>(row.usage, {}),
  };
};
