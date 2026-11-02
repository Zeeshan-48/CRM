import { describe, expect, it } from "vitest";
import {
  applyOffer,
  daysUntilExpiry,
  discountFor,
  isOfferLive,
  isOfferScheduled,
  offerAppliesToProduct,
  resolveOffersForProduct,
  resolvePrice,
  savingsPercent,
  type OfferLike,
  type PriceLike,
} from "../../src/utils/catalog-pricing";
import {
  currencyDecimals,
  formatMoney,
  majorToMinor,
  minorToMajor,
  normalizeCurrency,
  toMinorUnits,
} from "../../src/utils/money";

const price = (over: Partial<PriceLike> = {}): PriceLike => ({
  currency: "INR",
  amount_minor: 499900,
  compare_at_minor: null,
  billing_period: "ONE_TIME",
  is_default: false,
  ...over,
});

const offer = (over: Partial<OfferLike> = {}): OfferLike => ({
  code: "AUG20",
  discount_type: "PERCENT",
  discount_value: 20,
  status: "ACTIVE",
  redemptions_used: 0,
  ...over,
});

// ---------------------------------------------------------------------------

describe("money", () => {
  it("knows non-two-decimal currencies", () => {
    expect(currencyDecimals("INR")).toBe(2);
    expect(currencyDecimals("usd")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("KWD")).toBe(3);
    expect(currencyDecimals("ZZZ")).toBe(2);
  });

  it("round-trips major and minor units", () => {
    expect(majorToMinor(4999, "INR")).toBe(499900);
    expect(minorToMajor(499900, "INR")).toBe(4999);
    expect(majorToMinor(4999, "JPY")).toBe(4999);
    expect(minorToMajor(4999, "JPY")).toBe(4999);
  });

  it("rounds half-up at the deals.value boundary, the one lossy conversion", () => {
    expect(minorToMajor(199950, "INR")).toBe(2000);
    expect(minorToMajor(199949, "INR")).toBe(1999);
  });

  it("coerces producer input without ever producing NaN", () => {
    expect(toMinorUnits(499900)).toBe(499900);
    expect(toMinorUnits("499900")).toBe(499900);
    expect(toMinorUnits("4,999 00")).toBe(499900);
    expect(toMinorUnits(499900.4)).toBe(499900);
    expect(toMinorUnits("free")).toBeNull();
    expect(toMinorUnits(-5)).toBeNull();
    expect(toMinorUnits(null)).toBeNull();
    expect(toMinorUnits("")).toBeNull();
    expect(toMinorUnits(0)).toBe(0);
  });

  it("normalizes currency codes and falls back for junk", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency(" inr ")).toBe("INR");
    expect(normalizeCurrency("rupees")).toBe("INR");
    expect(normalizeCurrency(null)).toBe("INR");
  });

  it("never throws on an unusual currency code", () => {
    expect(() => formatMoney(1000, "ZZZ")).not.toThrow();
    expect(formatMoney(499900, "INR")).toContain("4,999");
  });

  it("shows a fractional amount at FULL precision, never one decimal digit", () => {
    // A 20% offer on ₹9,999 is ₹1,999.80. Rendering it as "₹1,999.8" reads as a
    // bug, and this exact string is what a sales agent quotes to a customer.
    expect(formatMoney(199980, "INR")).toBe("₹1,999.80");
    expect(formatMoney(799920, "INR")).toBe("₹7,999.20");
    // A single leftover paise still shows both digits.
    expect(formatMoney(100001, "INR")).toBe("₹1,000.01");
  });

  it("omits the fraction entirely for whole amounts", () => {
    // A catalog of round prices should not read as "₹9,999.00".
    expect(formatMoney(999900, "INR")).toBe("₹9,999");
    expect(formatMoney(0, "INR")).toBe("₹0");
  });

  it("respects a currency's own minor-unit exponent", () => {
    // JPY has no minor unit, so 5000 minor units is ¥5,000 and never ¥50.00.
    expect(formatMoney(5000, "JPY")).toContain("5,000");
    expect(formatMoney(5000, "JPY")).not.toContain(".");
    // KWD has three, so a remainder shows all three digits.
    expect(formatMoney(1234567, "KWD")).toContain("1,234.567");
  });
});

// ---------------------------------------------------------------------------

describe("resolvePrice", () => {
  it("returns null when a product has no published price", () => {
    // Must be null, not 0: "unpriced" and "free" are different things.
    expect(resolvePrice([], "INR")).toBeNull();
  });

  it("prefers an exact currency match", () => {
    const rows = [price({ currency: "INR" }), price({ currency: "USD", amount_minor: 5900 })];
    expect(resolvePrice(rows, "USD")?.currency).toBe("USD");
  });

  it("prefers the default-flagged row within the matched currency", () => {
    const rows = [
      price({ currency: "INR", amount_minor: 99900, billing_period: "MONTHLY" }),
      price({ currency: "INR", amount_minor: 499900, is_default: true }),
    ];
    expect(resolvePrice(rows, "INR")?.amount_minor).toBe(499900);
  });

  it("falls back to the cheapest when nothing is flagged default", () => {
    const rows = [
      price({ currency: "INR", amount_minor: 499900 }),
      price({ currency: "INR", amount_minor: 99900 }),
    ];
    expect(resolvePrice(rows, "INR")?.amount_minor).toBe(99900);
  });

  it("falls back to the tenant default currency when the requested one is absent", () => {
    const rows = [price({ currency: "INR" }), price({ currency: "EUR", amount_minor: 4900 })];
    expect(resolvePrice(rows, "GBP")?.currency).toBe("INR");
  });

  it("still returns something when neither requested nor default currency exists", () => {
    const rows = [price({ currency: "EUR", amount_minor: 4900 })];
    expect(resolvePrice(rows, "GBP")?.currency).toBe("EUR");
  });
});

describe("savingsPercent", () => {
  it("computes the strike-through discount", () => {
    expect(savingsPercent(price({ amount_minor: 499900, compare_at_minor: 799900 }))).toBe(38);
  });

  it("is zero without a list price or when list is not higher", () => {
    expect(savingsPercent(price({ compare_at_minor: null }))).toBe(0);
    expect(savingsPercent(price({ amount_minor: 499900, compare_at_minor: 499900 }))).toBe(0);
    expect(savingsPercent(price({ amount_minor: 499900, compare_at_minor: 100000 }))).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("isOfferLive", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);

  it("accepts an offer with no window at all", () => {
    expect(isOfferLive(offer(), now)).toBe(true);
  });

  it("rejects a DISABLED offer regardless of window", () => {
    expect(isOfferLive(offer({ status: "DISABLED" }), now)).toBe(false);
  });

  it("rejects before the start and after the end", () => {
    expect(isOfferLive(offer({ starts_at: new Date(now + 1000) }), now)).toBe(false);
    expect(isOfferLive(offer({ ends_at: new Date(now - 1000) }), now)).toBe(false);
  });

  it("trusts the window over a stale ACTIVE status", () => {
    // The whole point: a row can sit at ACTIVE with an expired end date. An
    // agent must never be handed a code that will bounce at checkout.
    const expired = offer({ status: "ACTIVE", ends_at: new Date(now - 86_400_000) });
    expect(isOfferLive(expired, now)).toBe(false);
  });

  it("rejects once the redemption cap is reached", () => {
    expect(isOfferLive(offer({ max_redemptions: 100, redemptions_used: 100 }), now)).toBe(false);
    expect(isOfferLive(offer({ max_redemptions: 100, redemptions_used: 99 }), now)).toBe(true);
  });

  it("treats a zero or absent cap as unlimited", () => {
    expect(isOfferLive(offer({ max_redemptions: 0, redemptions_used: 5000 }), now)).toBe(true);
    expect(isOfferLive(offer({ max_redemptions: null, redemptions_used: 5000 }), now)).toBe(true);
  });

  it("flags a future offer as scheduled rather than live", () => {
    const future = offer({ starts_at: new Date(now + 86_400_000) });
    expect(isOfferLive(future, now)).toBe(false);
    expect(isOfferScheduled(future, now)).toBe(true);
  });
});

describe("daysUntilExpiry", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);

  it("is null for an open-ended offer", () => {
    expect(daysUntilExpiry(offer(), now)).toBeNull();
  });

  it("rounds up so 'expires today' never reads as 0 days early", () => {
    expect(daysUntilExpiry(offer({ ends_at: new Date(now + 90_000_000) }), now)).toBe(2);
    expect(daysUntilExpiry(offer({ ends_at: new Date(now + 3_600_000) }), now)).toBe(1);
  });

  it("clamps a past expiry to zero", () => {
    expect(daysUntilExpiry(offer({ ends_at: new Date(now - 86_400_000) }), now)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("offerAppliesToProduct", () => {
  const product = { id: "p1", category: "Frontend" };

  it("matches a directly scoped offer and rejects other products", () => {
    expect(offerAppliesToProduct(offer({ product_id: "p1" }), product)).toBe(true);
    expect(offerAppliesToProduct(offer({ product_id: "p2" }), product)).toBe(false);
  });

  it("treats an unscoped offer as workspace-wide", () => {
    expect(offerAppliesToProduct(offer(), product)).toBe(true);
    expect(
      offerAppliesToProduct(offer({ applies_to: { product_ids: [], categories: [] } }), product)
    ).toBe(true);
  });

  it("matches by explicit product id list and by category", () => {
    expect(offerAppliesToProduct(offer({ applies_to: { product_ids: ["p1"] } }), product)).toBe(true);
    expect(offerAppliesToProduct(offer({ applies_to: { categories: ["Frontend"] } }), product)).toBe(true);
    expect(offerAppliesToProduct(offer({ applies_to: { categories: ["Backend"] } }), product)).toBe(false);
  });

  it("reads applies_to when the driver hands it back as a JSON string", () => {
    const o = offer({ applies_to: JSON.stringify({ categories: ["Frontend"] }) });
    expect(offerAppliesToProduct(o, product)).toBe(true);
  });

  it("does not match a category offer against a product with no category", () => {
    const o = offer({ applies_to: { categories: ["Frontend"] } });
    expect(offerAppliesToProduct(o, { id: "p9", category: null })).toBe(false);
  });
});

describe("discountFor", () => {
  it("applies a percentage", () => {
    expect(discountFor(499900, offer({ discount_type: "PERCENT", discount_value: 20 }), "INR")).toBe(99980);
  });

  it("clamps a percentage above 100 and ignores a non-positive one", () => {
    expect(discountFor(1000, offer({ discount_type: "PERCENT", discount_value: 150 }), "INR")).toBe(1000);
    expect(discountFor(1000, offer({ discount_type: "PERCENT", discount_value: 0 }), "INR")).toBe(0);
    expect(discountFor(1000, offer({ discount_type: "PERCENT", discount_value: -20 }), "INR")).toBe(0);
  });

  it("applies a flat amount and never exceeds the price", () => {
    const flat = offer({ discount_type: "FLAT", discount_value: 50000, currency: "INR" });
    expect(discountFor(499900, flat, "INR")).toBe(50000);
    expect(discountFor(20000, flat, "INR")).toBe(20000);
  });

  it("refuses a flat discount in a different currency instead of guessing FX", () => {
    // Subtracting 500 USD-cents from an INR price would be a silent, wrong sale.
    const usdFlat = offer({ discount_type: "FLAT", discount_value: 50000, currency: "USD" });
    expect(discountFor(499900, usdFlat, "INR")).toBe(0);
  });

  it("applies a flat offer with no declared currency to any price", () => {
    const flat = offer({ discount_type: "FLAT", discount_value: 10000, currency: null });
    expect(discountFor(499900, flat, "INR")).toBe(10000);
  });

  it("ignores an unknown discount type and a zero-amount price", () => {
    expect(discountFor(1000, offer({ discount_type: "BOGOF" }), "INR")).toBe(0);
    expect(discountFor(0, offer(), "INR")).toBe(0);
  });
});

describe("applyOffer", () => {
  it("never returns a negative price", () => {
    const huge = offer({ discount_type: "FLAT", discount_value: 999999999, currency: "INR" });
    expect(applyOffer(499900, huge, "INR")).toBe(0);
  });
});

describe("resolveOffersForProduct", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const product = { id: "p1", category: "Frontend" };
  const p = price({ amount_minor: 499900, currency: "INR" });

  it("returns nothing when the product has no price to discount", () => {
    expect(resolveOffersForProduct([offer()], product, null, now)).toEqual([]);
  });

  it("orders by best discount so the agent leads with the strongest", () => {
    const offers = [
      offer({ code: "TEN", discount_type: "PERCENT", discount_value: 10 }),
      offer({ code: "FLAT2K", discount_type: "FLAT", discount_value: 200000, currency: "INR" }),
      offer({ code: "TWENTY", discount_type: "PERCENT", discount_value: 20 }),
    ];
    const result = resolveOffersForProduct(offers, product, p, now);
    expect(result.map((r) => r.offer.code)).toEqual(["FLAT2K", "TWENTY", "TEN"]);
    expect(result[0].final_minor).toBe(299900);
  });

  it("drops expired, disabled, non-applicable and zero-value offers", () => {
    const offers = [
      offer({ code: "GOOD" }),
      offer({ code: "EXPIRED", ends_at: new Date(now - 1) }),
      offer({ code: "OFF", status: "DISABLED" }),
      offer({ code: "OTHER", product_id: "p2" }),
      // Cross-currency flat: applies, but resolves to nothing off. Showing it
      // would hand the agent a code that changes no number.
      offer({ code: "USDFLAT", discount_type: "FLAT", discount_value: 5000, currency: "USD" }),
    ];
    const result = resolveOffersForProduct(offers, product, p, now);
    expect(result.map((r) => r.offer.code)).toEqual(["GOOD"]);
  });

  it("carries days_left through for the countdown badge", () => {
    const result = resolveOffersForProduct(
      [offer({ ends_at: new Date(now + 3 * 86_400_000) })],
      product,
      p,
      now
    );
    expect(result[0].days_left).toBe(3);
  });
});
