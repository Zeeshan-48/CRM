// Pure price and offer resolution for the product catalog.
//
// Everything here is a pure function of its inputs so it can be unit-tested
// without a database, and so the same logic can be reused by the agent panel,
// the deal line-item builder and the copilot without drifting.

import { DEFAULT_CURRENCY, normalizeCurrency } from "./money";

export const DISCOUNT_TYPES = ["PERCENT", "FLAT"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const BILLING_PERIODS = ["ONE_TIME", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export interface PriceLike {
  id?: string;
  currency: string;
  amount_minor: number;
  compare_at_minor: number | null;
  billing_period: string;
  is_default: boolean;
  price_book?: string;
}

export interface OfferLike {
  id?: string;
  code: string | null;
  name?: string;
  discount_type: string;
  discount_value: number;
  currency?: string | null;
  applies_to?: unknown;
  product_id?: string | null;
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  max_redemptions?: number | null;
  redemptions_used?: number;
  status?: string;
}

export interface ProductLike {
  id: string;
  category?: string | null;
}

// ---------------------------------------------------------------------------
// Price selection
// ---------------------------------------------------------------------------

/**
 * Picks the price to show for a requested currency.
 *
 * Order: exact currency match (preferring the row flagged default, then the
 * cheapest so a monthly plan does not outrank a one-time price by accident) ->
 * the tenant-default currency -> the row flagged default in any currency ->
 * the first row. Returns null only when the product has no prices at all,
 * which the UI renders as "price not published" rather than as free.
 */
export const resolvePrice = (
  prices: PriceLike[],
  requestedCurrency?: string | null
): PriceLike | null => {
  if (!prices.length) return null;

  const pickBest = (rows: PriceLike[]): PriceLike | undefined => {
    if (!rows.length) return undefined;
    const flagged = rows.find((p) => p.is_default);
    if (flagged) return flagged;
    return [...rows].sort((a, b) => a.amount_minor - b.amount_minor)[0];
  };

  const wanted = requestedCurrency ? normalizeCurrency(requestedCurrency) : null;
  if (wanted) {
    const exact = pickBest(prices.filter((p) => normalizeCurrency(p.currency) === wanted));
    if (exact) return exact;
  }

  const fallback = pickBest(
    prices.filter((p) => normalizeCurrency(p.currency) === DEFAULT_CURRENCY)
  );
  if (fallback) return fallback;

  return prices.find((p) => p.is_default) ?? prices[0];
};

/** Percentage off the list price, for the strike-through badge. 0 when none. */
export const savingsPercent = (price: PriceLike): number => {
  const list = price.compare_at_minor;
  if (!list || list <= price.amount_minor) return 0;
  return Math.round(((list - price.amount_minor) / list) * 100);
};

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

const toTime = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

const parseAppliesTo = (value: unknown): { product_ids: string[]; categories: string[] } => {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { product_ids: [], categories: [] };
    }
  }
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return { product_ids: arr(obj.product_ids), categories: arr(obj.categories) };
};

/**
 * Is this offer usable right now?
 *
 * DISABLED is always dead. Otherwise the window and the redemption cap decide,
 * NOT the stored `status` string: a row can sit at status ACTIVE while its
 * end date has passed, and an agent must never be shown a code that will be
 * rejected at checkout. The stored status is an admin intent; this is the truth.
 */
export const isOfferLive = (offer: OfferLike, now = Date.now()): boolean => {
  if (offer.status === "DISABLED") return false;

  const starts = toTime(offer.starts_at);
  if (starts !== null && now < starts) return false;

  const ends = toTime(offer.ends_at);
  if (ends !== null && now > ends) return false;

  const cap = offer.max_redemptions;
  if (typeof cap === "number" && cap > 0 && (offer.redemptions_used ?? 0) >= cap) return false;

  return true;
};

/** Offer starts in the future but is otherwise valid. Shown as "starts in Nd". */
export const isOfferScheduled = (offer: OfferLike, now = Date.now()): boolean => {
  if (offer.status === "DISABLED") return false;
  const starts = toTime(offer.starts_at);
  return starts !== null && now < starts;
};

/** Whole days until the offer expires, or null when it never does. */
export const daysUntilExpiry = (offer: OfferLike, now = Date.now()): number | null => {
  const ends = toTime(offer.ends_at);
  if (ends === null) return null;
  return Math.max(0, Math.ceil((ends - now) / 86_400_000));
};

/** Does this offer apply to this product at all (ignoring the time window)? */
export const offerAppliesToProduct = (offer: OfferLike, product: ProductLike): boolean => {
  if (offer.product_id) return offer.product_id === product.id;

  const { product_ids, categories } = parseAppliesTo(offer.applies_to);
  // Neither scoped to a product nor to categories: a workspace-wide offer.
  if (!product_ids.length && !categories.length) return true;

  if (product_ids.includes(product.id)) return true;
  if (product.category && categories.includes(product.category)) return true;
  return false;
};

/**
 * Discount in minor units this offer takes off a given amount.
 *
 * PERCENT: discount_value is 0-100, clamped, applied to the amount.
 * FLAT:    discount_value is already minor units, in the offer's own currency.
 *
 * A FLAT offer in a different currency than the price returns 0 rather than
 * subtracting rupees from dollars. Cross-currency flat discounts need an FX
 * decision the CRM has no business inventing at pitch time.
 */
export const discountFor = (
  amountMinor: number,
  offer: OfferLike,
  currency: string
): number => {
  if (amountMinor <= 0) return 0;
  const type = String(offer.discount_type || "").toUpperCase();
  const value = Number(offer.discount_value);
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (type === "PERCENT") {
    const pct = Math.min(100, Math.max(0, value));
    return Math.min(amountMinor, Math.round((amountMinor * pct) / 100));
  }

  if (type === "FLAT") {
    if (offer.currency && normalizeCurrency(offer.currency) !== normalizeCurrency(currency)) {
      return 0;
    }
    return Math.min(amountMinor, Math.round(value));
  }

  return 0;
};

/** Price after an offer. Never negative. */
export const applyOffer = (
  amountMinor: number,
  offer: OfferLike,
  currency: string
): number => Math.max(0, amountMinor - discountFor(amountMinor, offer, currency));

export interface ResolvedOffer {
  offer: OfferLike;
  discount_minor: number;
  final_minor: number;
  days_left: number | null;
}

/**
 * Every live offer that applies to a product, best discount first.
 *
 * Deliberately returns ALL of them rather than only the winner: an agent
 * negotiating needs to know a 20% code AND a flat welcome credit exist, and
 * which one to lead with. The caller takes [0] when it only wants the best.
 */
export const resolveOffersForProduct = (
  offers: OfferLike[],
  product: ProductLike,
  price: PriceLike | null,
  now = Date.now()
): ResolvedOffer[] => {
  if (!price) return [];
  const currency = normalizeCurrency(price.currency);

  return offers
    .filter((o) => isOfferLive(o, now) && offerAppliesToProduct(o, product))
    .map((offer) => {
      const discount = discountFor(price.amount_minor, offer, currency);
      return {
        offer,
        discount_minor: discount,
        final_minor: Math.max(0, price.amount_minor - discount),
        days_left: daysUntilExpiry(offer, now),
      };
    })
    // A cross-currency FLAT offer resolves to 0 off; showing it would give the
    // agent a code that changes nothing.
    .filter((r) => r.discount_minor > 0)
    .sort((a, b) => b.discount_minor - a.discount_minor);
};
