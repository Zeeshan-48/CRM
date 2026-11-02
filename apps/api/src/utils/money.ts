// Minor-unit money helpers for the product catalog.
//
// Catalog amounts are stored in MINOR units (paise, cents) because every
// payment provider an integrating product is likely to use speaks minor units,
// and because sub-unit precision is real for non-INR currencies.
//
// The rest of the CRM (deals.value, invoices.amount) predates this and stores
// MAJOR units. There is exactly one conversion boundary, at the deal line-item
// bridge, and it goes through `minorToMajor` below so the rounding is visible
// in one place rather than scattered.

// ISO 4217 minor-unit exponents. Only currencies that are not 2 need listing;
// everything else defaults to 2. Kept deliberately small: this is a lookup for
// formatting and conversion, not a currency registry.
const DECIMALS: Record<string, number> = {
  BHD: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

export const DEFAULT_CURRENCY = "INR";

/** ISO 4217 minor-unit exponent for a currency code. Unknown codes assume 2. */
export const currencyDecimals = (currency: string): number => {
  const code = String(currency || "").trim().toUpperCase();
  return DECIMALS[code] ?? 2;
};

/**
 * Minor units to major units, rounded half-up.
 *
 * This is the ONLY place catalog money crosses into the CRM's major-unit world
 * (deals.value). It rounds, and that rounding is intentional and lossy: a deal
 * worth 1999.50 is recorded as 2000. Migrating deals.value to minor units would
 * remove the loss and is tracked as a known seam in
 * docs/product-integration-plan.md.
 */
export const minorToMajor = (amountMinor: number, currency = DEFAULT_CURRENCY): number => {
  const factor = 10 ** currencyDecimals(currency);
  return Math.round(amountMinor / factor);
};

/** Major units to minor units. Used when an admin types a price into the UI. */
export const majorToMinor = (amountMajor: number, currency = DEFAULT_CURRENCY): number => {
  const factor = 10 ** currencyDecimals(currency);
  return Math.round(amountMajor * factor);
};

/**
 * Coerces whatever a producer sent into a non-negative integer of minor units.
 * Producers send numbers, numeric strings, and occasionally floats; none of
 * those should become NaN in the database.
 */
export const toMinorUnits = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[, ]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
};

/**
 * Human-readable amount for the agent panel. Uses Intl when the runtime knows
 * the currency and falls back to a plain formatted number, because a thrown
 * RangeError from an unusual currency code must not blank out a product card.
 */
export const formatMoney = (amountMinor: number, currency = DEFAULT_CURRENCY): string => {
  const code = String(currency || DEFAULT_CURRENCY).trim().toUpperCase();
  const decimals = currencyDecimals(code);
  const major = amountMinor / 10 ** decimals;

  // All-or-nothing on the fraction: a whole amount shows none (a catalog of
  // round prices reads better as "₹9,999" than "₹9,999.00"), and anything with
  // a remainder shows the currency's FULL precision.
  //
  // Asking Intl for min 0 / max `decimals` instead lets it drop a trailing zero,
  // which turns a ₹1,999.80 discount into "₹1,999.8", money with one decimal
  // digit reads as a bug to anyone looking at it, and this string is quoted to
  // customers by sales agents.
  const fractionDigits = amountMinor % 10 ** decimals === 0 ? 0 : decimals;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major);
  } catch {
    return `${code} ${major.toFixed(fractionDigits)}`;
  }
};

/** Normalizes a currency code, falling back to the tenant default. */
export const normalizeCurrency = (value: unknown): string => {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
};
