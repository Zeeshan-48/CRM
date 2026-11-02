import { describe, expect, it } from "vitest";
import {
  CatalogMappingError,
  MAX_HIGHLIGHTS,
  MAX_PRODUCTS_PER_SYNC,
  mapOffer,
  mapOffers,
  mapPrice,
  mapPrices,
  mapProduct,
  mapProducts,
} from "../../src/services/catalog-mapping";

const product = (over: Record<string, unknown> = {}) => ({
  external_id: "course_712",
  name: "Advanced React",
  ...over,
});

const offer = (over: Record<string, unknown> = {}) => ({
  name: "August cohort",
  discount_type: "PERCENT",
  discount_value: 20,
  ...over,
});

describe("mapPrice", () => {
  it("maps a well-formed price", () => {
    expect(
      mapPrice(
        { currency: "inr", amount_minor: 499900, compare_at_minor: 799900, is_default: true },
        0,
        "p"
      )
    ).toEqual({
      currency: "INR",
      amount_minor: 499900,
      compare_at_minor: 799900,
      billing_period: "ONE_TIME",
      price_book: "STANDARD",
      is_default: true,
    });
  });

  it("rejects a bare `amount` instead of guessing the unit", () => {
    // Guessing whether 4999 means 49.99 or 4999.00 misprices by 100x in a live
    // sales conversation. The error names the fix explicitly.
    expect(() => mapPrice({ amount: 4999, currency: "INR" }, 0, "p")).toThrow(CatalogMappingError);
    expect(() => mapPrice({ amount: 4999 }, 0, "p")).toThrow(/amount_minor/);
    expect(() => mapPrice({ price: 4999 }, 0, "p")).toThrow(/amount_minor/);
  });

  it("rejects a missing or negative amount", () => {
    expect(() => mapPrice({ currency: "INR" }, 0, "p")).toThrow(/non-negative whole number/);
    expect(() => mapPrice({ amount_minor: -1 }, 0, "p")).toThrow(CatalogMappingError);
  });

  it("accepts a genuinely free product", () => {
    expect(mapPrice({ amount_minor: 0 }, 0, "p").amount_minor).toBe(0);
  });

  it("drops a list price that is not actually higher", () => {
    expect(mapPrice({ amount_minor: 1000, compare_at_minor: 1000 }, 0, "p").compare_at_minor).toBeNull();
    expect(mapPrice({ amount_minor: 1000, compare_at_minor: 500 }, 0, "p").compare_at_minor).toBeNull();
  });

  it("rejects an unknown billing period", () => {
    expect(() => mapPrice({ amount_minor: 1, billing_period: "WEEKLY" }, 0, "p")).toThrow(/billing_period/);
  });

  it("falls back to INR for a junk currency code", () => {
    expect(mapPrice({ amount_minor: 1, currency: "rupees" }, 0, "p").currency).toBe("INR");
  });
});

describe("mapPrices", () => {
  it("returns an empty list when prices are omitted", () => {
    expect(mapPrices(undefined, "p")).toEqual([]);
    expect(mapPrices(null, "p")).toEqual([]);
  });

  it("rejects a non-array", () => {
    expect(() => mapPrices({ currency: "INR" }, "p")).toThrow(/must be an array/);
  });

  it("keeps only the first default per currency", () => {
    const result = mapPrices(
      [
        { currency: "INR", amount_minor: 100, is_default: true },
        { currency: "INR", amount_minor: 200, billing_period: "MONTHLY", is_default: true },
        { currency: "USD", amount_minor: 300, is_default: true },
      ],
      "p"
    );
    expect(result.filter((p) => p.currency === "INR" && p.is_default)).toHaveLength(1);
    expect(result.find((p) => p.currency === "USD")?.is_default).toBe(true);
  });

  it("drops rows that would collide on the database unique key", () => {
    // (price_book, currency, billing_period) is unique per product; two payload
    // entries on the same key would abort the whole insert.
    const result = mapPrices(
      [
        { currency: "INR", amount_minor: 100 },
        { currency: "INR", amount_minor: 999 },
      ],
      "p"
    );
    expect(result).toHaveLength(1);
    expect(result[0].amount_minor).toBe(100);
  });

  it("caps the number of prices per product", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ amount_minor: i, currency: "INR" }));
    expect(() => mapPrices(many, "p")).toThrow(/at most/i);
  });
});

describe("mapProduct", () => {
  it("requires an external id and a name", () => {
    expect(() => mapProduct({ name: "x" }, 0)).toThrow(/external_id is required/);
    expect(() => mapProduct({ external_id: "a" }, 0)).toThrow(/name is required/);
  });

  it("accepts `id` as an alias for external_id", () => {
    expect(mapProduct({ id: "course_1", name: "X" }, 0).external_id).toBe("course_1");
  });

  it("names the offending product in the error so a big feed is debuggable", () => {
    expect(() => mapProduct({ external_id: "course_712", prices: [{ amount: 10 }] }, 3)).toThrow(
      /name is required/
    );
    expect(() => mapProduct(product({ prices: [{ amount: 10 }] }), 3)).toThrow(/course_712/);
  });

  it("caps highlights in both count and length", () => {
    const result = mapProduct(
      product({ highlights: Array.from({ length: 25 }, () => "x".repeat(400)) }),
      0
    );
    expect(result.highlights).toHaveLength(MAX_HIGHLIGHTS);
    expect(result.highlights?.[0].length).toBe(160);
  });

  it("drops relative and non-http URLs rather than storing a broken link", () => {
    expect(mapProduct(product({ url: "/courses/react" }), 0).url).toBeNull();
    expect(mapProduct(product({ url: "javascript:alert(1)" }), 0).url).toBeNull();
    expect(mapProduct(product({ url: "https://a.example.com/x" }), 0).url).toBe(
      "https://a.example.com/x"
    );
  });

  it("collects media from nested and top-level shorthands", () => {
    expect(mapProduct(product({ thumbnail: "https://cdn.example.com/a.png" }), 0).media)
      .toMatchObject({ thumbnail: "https://cdn.example.com/a.png" });
    expect(
      mapProduct(product({ media: { images: ["https://cdn.example.com/b.png", "nope"] } }), 0).media
    ).toMatchObject({ images: ["https://cdn.example.com/b.png"] });
  });

  it("is null-media when nothing usable was supplied", () => {
    expect(mapProduct(product(), 0).media).toBeNull();
    expect(mapProduct(product({ media: { images: ["relative/x.png"] } }), 0).media).toBeNull();
  });

  it("rejects an unknown status", () => {
    expect(() => mapProduct(product({ status: "LIVE" }), 0)).toThrow(/status must be/);
  });

  it("keeps attributes as free-form product-defined data", () => {
    const attrs = { level: "Advanced", duration_weeks: 12, nested: { a: 1 } };
    expect(mapProduct(product({ attributes: attrs }), 0).attributes).toEqual(attrs);
  });

  it("defaults a non-numeric sort_order to 0", () => {
    expect(mapProduct(product({ sort_order: "abc" }), 0).sort_order).toBe(0);
    expect(mapProduct(product({ sort_order: "5" }), 0).sort_order).toBe(5);
  });
});

describe("mapProducts", () => {
  it("rejects a non-array and an oversized page", () => {
    expect(() => mapProducts({})).toThrow(/must be an array/);
    const many = Array.from({ length: MAX_PRODUCTS_PER_SYNC + 1 }, (_, i) =>
      product({ external_id: `c${i}` })
    );
    expect(() => mapProducts(many)).toThrow(/Send the catalog in pages/);
  });

  it("rejects a duplicated external_id rather than letting order pick a winner", () => {
    expect(() => mapProducts([product(), product({ name: "Other" })])).toThrow(/Duplicate external_id/);
  });

  it("maps a clean batch", () => {
    const result = mapProducts([product(), product({ external_id: "course_713", name: "Vue" })]);
    expect(result.map((p) => p.external_id)).toEqual(["course_712", "course_713"]);
  });
});

describe("mapOffer", () => {
  it("requires a name, a known type and a positive value", () => {
    expect(() => mapOffer({ discount_type: "PERCENT", discount_value: 10 }, 0)).toThrow(/name is required/);
    expect(() => mapOffer(offer({ discount_type: "BOGOF" }), 0)).toThrow(/discount_type/);
    expect(() => mapOffer(offer({ discount_value: 0 }), 0)).toThrow(/positive number/);
    expect(() => mapOffer(offer({ discount_value: -5 }), 0)).toThrow(/positive number/);
  });

  it("rejects a percentage above 100", () => {
    expect(() => mapOffer(offer({ discount_value: 120 }), 0)).toThrow(/cannot exceed 100/);
  });

  it("rejects a window that ends before it starts", () => {
    expect(() =>
      mapOffer(offer({ starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-08-01T00:00:00Z" }), 0)
    ).toThrow(/before starts_at/);
  });

  it("never stores a currency on a PERCENT offer", () => {
    // A percentage is currency-agnostic by definition; storing one would make
    // the cross-currency guard in discountFor reject a valid discount.
    expect(mapOffer(offer({ currency: "USD" }), 0).currency).toBeNull();
  });

  it("keeps the currency on a FLAT offer", () => {
    expect(
      mapOffer(offer({ discount_type: "FLAT", discount_value: 50000, currency: "usd" }), 0).currency
    ).toBe("USD");
  });

  it("separates external product ids from category scoping", () => {
    const result = mapOffer(
      offer({ applies_to: { product_ids: ["course_712"], categories: ["Frontend"] } }),
      0
    );
    // product_ids are the PRODUCT's ids and must be resolved to CRM ids by the
    // sync service, so they never land in applies_to directly.
    expect(result.external_product_ids).toEqual(["course_712"]);
    expect(result.applies_to).toEqual({ product_ids: [], categories: ["Frontend"] });
  });

  it("treats a non-positive redemption cap as unlimited", () => {
    expect(mapOffer(offer({ max_redemptions: 0 }), 0).max_redemptions).toBeNull();
    expect(mapOffer(offer({ max_redemptions: "abc" }), 0).max_redemptions).toBeNull();
    expect(mapOffer(offer({ max_redemptions: 200 }), 0).max_redemptions).toBe(200);
  });

  it("maps a plain offer with no code", () => {
    expect(mapOffer(offer(), 0).code).toBeNull();
  });
});

describe("mapOffers", () => {
  it("rejects duplicated coupon codes case-insensitively", () => {
    expect(() => mapOffers([offer({ code: "AUG20" }), offer({ code: "aug20" })])).toThrow(
      /Duplicate coupon code/
    );
  });

  it("allows several codeless offers", () => {
    expect(mapOffers([offer(), offer({ name: "Another" })])).toHaveLength(2);
  });
});
