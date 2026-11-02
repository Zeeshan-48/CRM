import { z } from "zod";
import { BILLING_PERIODS, DISCOUNT_TYPES } from "../utils/catalog-pricing";
import { optNumeric, optRecord, optStr, optStrArray, reqStr } from "./common";

const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;

// Deliberately permissive on shape and strict on the one thing that silently
// ruins a catalog: the money unit. `amount_minor` is required here rather than
// coerced from a bare `amount`, so a 100x mispricing is impossible.
const priceSchema = z.object({
  currency: optStr,
  amount_minor: z.union([z.number(), z.string()]),
  compare_at_minor: optNumeric,
  billing_period: z.enum(BILLING_PERIODS).nullish(),
  price_book: optStr,
  is_default: z.boolean().nullish(),
});

export const createProductSchema = z.object({
  name: reqStr("Product name"),
  sku: optStr,
  description: optStr,
  category: optStr,
  family: optStr,
  url: optStr,
  media: optRecord,
  attributes: optRecord,
  highlights: optStrArray,
  status: z.enum(PRODUCT_STATUSES).nullish(),
  sort_order: optNumeric,
  prices: z.array(priceSchema).nullish(),
});

export const updateProductSchema = z.object({
  name: optStr,
  sku: optStr,
  description: optStr,
  category: optStr,
  family: optStr,
  url: optStr,
  media: optRecord,
  attributes: optRecord,
  highlights: optStrArray,
  status: z.enum(PRODUCT_STATUSES).nullish(),
  sort_order: optNumeric,
  prices: z.array(priceSchema).nullish(),
});

export const setPricesSchema = z.object({
  prices: z.array(priceSchema),
});

export const createOfferSchema = z.object({
  name: reqStr("Offer name"),
  code: optStr,
  description: optStr,
  terms: optStr,
  discount_type: z.enum(DISCOUNT_TYPES),
  discount_value: z.union([z.number(), z.string()]),
  currency: optStr,
  product_id: optStr,
  applies_to: optRecord,
  starts_at: optStr,
  ends_at: optStr,
  max_redemptions: optNumeric,
  status: optStr,
});

export const updateOfferSchema = z.object({
  name: optStr,
  code: optStr,
  description: optStr,
  terms: optStr,
  discount_type: z.enum(DISCOUNT_TYPES).nullish(),
  discount_value: optNumeric,
  currency: optStr,
  applies_to: optRecord,
  starts_at: optStr,
  ends_at: optStr,
  max_redemptions: optNumeric,
  status: optStr,
});

export const validateCouponSchema = z.object({
  product_id: reqStr("product_id"),
  code: reqStr("Coupon code"),
  currency: optStr,
});

// ---- Ingest-side catalog payloads ----
// Kept loose on purpose: the detailed, field-naming errors that make an
// integration debuggable come from services/catalog-mapping, which can say
// 'products[3] (course_712) price[0]: use "amount_minor"'. A zod error here
// would replace that with a path and lose the guidance.

export const syncCatalogSchema = z.object({
  mode: z.enum(["UPSERT", "REPLACE"]).nullish(),
  products: z.array(z.unknown()),
});

export const syncOffersSchema = z.object({
  offers: z.array(z.unknown()),
});
