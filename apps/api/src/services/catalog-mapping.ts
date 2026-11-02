// Pure mapping from an external product's catalog payload to CRM row shapes.
//
// Producer payloads are untrusted and messy. Everything here is a pure function
// so the mapping rules are unit-testable without a database, and so a producer
// integrating at 2am gets a precise error instead of a 500.

import { BILLING_PERIODS, DISCOUNT_TYPES } from "../utils/catalog-pricing";
import { normalizeCurrency, toMinorUnits } from "../utils/money";

// Caps. Without these a single request can write unbounded JSON into every row
// of the catalog and make the agent panel unusable.
export const MAX_PRODUCTS_PER_SYNC = 500;
export const MAX_OFFERS_PER_SYNC = 500;
export const MAX_HIGHLIGHTS = 10;
export const MAX_HIGHLIGHT_LEN = 160;
export const MAX_ATTRIBUTE_KEYS = 30;
export const MAX_PRICES_PER_PRODUCT = 20;
export const MAX_DESCRIPTION_LEN = 8000;

export class CatalogMappingError extends Error {}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

const strOrNull = (v: unknown, max = 500): string | null => {
  const s = str(v);
  return s ? s.slice(0, max) : null;
};

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Only absolute http(s) URLs are stored. A relative path would render as a
// broken link on a CRM record, which is worse than showing no link at all.
const urlOrNull = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

const parseDate = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface MappedPrice {
  currency: string;
  amount_minor: number;
  compare_at_minor: number | null;
  billing_period: string;
  price_book: string;
  is_default: boolean;
}

/**
 * Maps one price entry.
 *
 * Amounts are accepted ONLY as `amount_minor`. A bare `amount` is rejected with
 * an explicit message rather than guessed at: there is no safe way to tell
 * whether 4999 means 49.99 or 4999.00, and guessing wrong misprices a product
 * by 100x in a live sales conversation.
 */
export const mapPrice = (raw: unknown, index: number, productRef: string): MappedPrice => {
  const p = asObject(raw);

  if (p.amount_minor === undefined && (p.amount !== undefined || p.price !== undefined)) {
    throw new CatalogMappingError(
      `${productRef} price[${index}]: use "amount_minor" (paise/cents), not "amount". ` +
        `For example 4999.00 INR is amount_minor: 499900.`
    );
  }

  const amount = toMinorUnits(p.amount_minor);
  if (amount === null) {
    throw new CatalogMappingError(
      `${productRef} price[${index}]: amount_minor must be a non-negative whole number`
    );
  }

  const period = str(p.billing_period).toUpperCase() || "ONE_TIME";
  if (!(BILLING_PERIODS as readonly string[]).includes(period)) {
    throw new CatalogMappingError(
      `${productRef} price[${index}]: billing_period must be one of ${BILLING_PERIODS.join(", ")}`
    );
  }

  const compareAt = toMinorUnits(p.compare_at_minor);

  return {
    currency: normalizeCurrency(p.currency),
    amount_minor: amount,
    // A list price at or below the selling price is not a discount, it is a
    // data error. Drop it rather than render a nonsensical strike-through.
    compare_at_minor: compareAt !== null && compareAt > amount ? compareAt : null,
    billing_period: period,
    price_book: str(p.price_book).toUpperCase() || "STANDARD",
    is_default: p.is_default === true,
  };
};

/**
 * Maps a product's price list and enforces at most one default per currency.
 * Later duplicates are demoted rather than rejected: a producer flagging two
 * defaults is sloppy, not malicious, and blocking the whole sync over it would
 * be a poor trade.
 */
export const mapPrices = (raw: unknown, productRef: string): MappedPrice[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new CatalogMappingError(`${productRef}: prices must be an array`);
  }
  if (raw.length > MAX_PRICES_PER_PRODUCT) {
    throw new CatalogMappingError(
      `${productRef}: at most ${MAX_PRICES_PER_PRODUCT} prices per product`
    );
  }

  const mapped = raw.map((p, i) => mapPrice(p, i, productRef));

  const seenDefault = new Set<string>();
  const deduped: MappedPrice[] = [];
  const seenKeys = new Set<string>();

  for (const price of mapped) {
    // The DB unique is (product, price_book, currency, billing_period). Two
    // payload entries colliding on that would abort the insert, so keep first.
    const key = `${price.price_book}|${price.currency}|${price.billing_period}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    if (price.is_default) {
      if (seenDefault.has(price.currency)) {
        deduped.push({ ...price, is_default: false });
        continue;
      }
      seenDefault.add(price.currency);
    }
    deduped.push(price);
  }

  return deduped;
};

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface MappedProduct {
  external_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  family: string | null;
  url: string | null;
  media: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
  highlights: string[] | null;
  status: string;
  sort_order: number;
  prices: MappedPrice[];
}

export const mapProduct = (raw: unknown, index: number): MappedProduct => {
  const p = asObject(raw);
  const ref = `products[${index}]`;

  const externalId = str(p.external_id) || str(p.id);
  if (!externalId) {
    throw new CatalogMappingError(`${ref}: external_id is required (it is the upsert key)`);
  }
  const name = str(p.name);
  if (!name) throw new CatalogMappingError(`${ref} (${externalId}): name is required`);

  const status = str(p.status).toUpperCase() || "ACTIVE";
  if (!["ACTIVE", "DRAFT", "ARCHIVED"].includes(status)) {
    throw new CatalogMappingError(`${ref} (${externalId}): status must be ACTIVE, DRAFT or ARCHIVED`);
  }

  const highlightsRaw = Array.isArray(p.highlights) ? p.highlights : null;
  const highlights = highlightsRaw
    ? highlightsRaw
        .map((h) => str(h).slice(0, MAX_HIGHLIGHT_LEN))
        .filter(Boolean)
        .slice(0, MAX_HIGHLIGHTS)
    : null;

  // Attributes are product-defined and rendered generically, so cap the key
  // count instead of validating shape. Nested objects are preserved as-is.
  const attrsRaw = asObject(p.attributes);
  const attrKeys = Object.keys(attrsRaw).slice(0, MAX_ATTRIBUTE_KEYS);
  const attributes = attrKeys.length
    ? attrKeys.reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = attrsRaw[k];
        return acc;
      }, {})
    : null;

  const mediaRaw = asObject(p.media);
  const thumbnail = urlOrNull(mediaRaw.thumbnail ?? p.thumbnail ?? p.image);
  const images = Array.isArray(mediaRaw.images)
    ? mediaRaw.images.map(urlOrNull).filter((u): u is string => !!u).slice(0, 10)
    : [];
  const media = thumbnail || images.length ? { thumbnail, images } : null;

  const sortOrder = Number(p.sort_order);

  return {
    external_id: externalId.slice(0, 200),
    sku: strOrNull(p.sku, 120),
    name: name.slice(0, 300),
    description: strOrNull(p.description, MAX_DESCRIPTION_LEN),
    category: strOrNull(p.category, 120),
    family: strOrNull(p.family, 120),
    url: urlOrNull(p.url),
    media,
    attributes,
    highlights: highlights && highlights.length ? highlights : null,
    status,
    sort_order: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    prices: mapPrices(p.prices, `${ref} (${externalId})`),
  };
};

export const mapProducts = (raw: unknown): MappedProduct[] => {
  if (!Array.isArray(raw)) {
    throw new CatalogMappingError("products must be an array");
  }
  if (raw.length > MAX_PRODUCTS_PER_SYNC) {
    throw new CatalogMappingError(
      `At most ${MAX_PRODUCTS_PER_SYNC} products per request. Send the catalog in pages.`
    );
  }

  const mapped = raw.map(mapProduct);

  // A payload repeating an external_id would make the upsert order decide the
  // winner, which is a coin flip. Reject so the producer fixes their feed.
  const seen = new Set<string>();
  for (const p of mapped) {
    if (seen.has(p.external_id)) {
      throw new CatalogMappingError(`Duplicate external_id "${p.external_id}" in the same payload`);
    }
    seen.add(p.external_id);
  }

  return mapped;
};

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export interface MappedOffer {
  code: string | null;
  name: string;
  description: string | null;
  terms: string | null;
  discount_type: string;
  discount_value: number;
  currency: string | null;
  applies_to: { product_ids: string[]; categories: string[] } | null;
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  status: string;
  // External product ids, resolved to CRM product ids by the sync service.
  external_product_ids: string[];
}

export const mapOffer = (raw: unknown, index: number): MappedOffer => {
  const o = asObject(raw);
  const ref = `offers[${index}]`;

  const name = str(o.name);
  if (!name) throw new CatalogMappingError(`${ref}: name is required`);

  const type = str(o.discount_type).toUpperCase();
  if (!(DISCOUNT_TYPES as readonly string[]).includes(type)) {
    throw new CatalogMappingError(`${ref}: discount_type must be one of ${DISCOUNT_TYPES.join(", ")}`);
  }

  const rawValue = Number(o.discount_value);
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    throw new CatalogMappingError(`${ref}: discount_value must be a positive number`);
  }
  if (type === "PERCENT" && rawValue > 100) {
    throw new CatalogMappingError(`${ref}: a PERCENT discount cannot exceed 100`);
  }
  const value = Math.round(rawValue);

  const startsAt = parseDate(o.starts_at);
  const endsAt = parseDate(o.ends_at);
  if (startsAt && endsAt && endsAt < startsAt) {
    throw new CatalogMappingError(`${ref}: ends_at is before starts_at`);
  }

  const appliesRaw = asObject(o.applies_to);
  const externalProductIds = Array.isArray(appliesRaw.product_ids)
    ? appliesRaw.product_ids.map(str).filter(Boolean)
    : [];
  const categories = Array.isArray(appliesRaw.categories)
    ? appliesRaw.categories.map(str).filter(Boolean)
    : [];

  const cap = Number(o.max_redemptions);

  return {
    code: strOrNull(o.code, 60),
    name: name.slice(0, 200),
    description: strOrNull(o.description, 2000),
    terms: strOrNull(o.terms, 2000),
    discount_type: type,
    discount_value: value,
    // A FLAT discount with no currency applies to any price; a PERCENT one is
    // currency-agnostic by definition, so never store a currency for it.
    currency: type === "FLAT" ? (o.currency ? normalizeCurrency(o.currency) : null) : null,
    applies_to: categories.length ? { product_ids: [], categories } : null,
    starts_at: startsAt,
    ends_at: endsAt,
    max_redemptions: Number.isFinite(cap) && cap > 0 ? Math.trunc(cap) : null,
    status: str(o.status).toUpperCase() === "DISABLED" ? "DISABLED" : "ACTIVE",
    external_product_ids: externalProductIds,
  };
};

export const mapOffers = (raw: unknown): MappedOffer[] => {
  if (!Array.isArray(raw)) throw new CatalogMappingError("offers must be an array");
  if (raw.length > MAX_OFFERS_PER_SYNC) {
    throw new CatalogMappingError(`At most ${MAX_OFFERS_PER_SYNC} offers per request`);
  }

  const mapped = raw.map(mapOffer);

  const seen = new Set<string>();
  for (const o of mapped) {
    if (!o.code) continue;
    const key = o.code.toLowerCase();
    if (seen.has(key)) {
      throw new CatalogMappingError(`Duplicate coupon code "${o.code}" in the same payload`);
    }
    seen.add(key);
  }

  return mapped;
};
