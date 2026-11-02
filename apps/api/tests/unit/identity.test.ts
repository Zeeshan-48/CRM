import { describe, expect, it } from "vitest";
import { deriveNameFromEmail, normalizeIdentities } from "../../src/services/identity.service";

describe("normalizeIdentities", () => {
  it("orders identities by evidence strength, strongest first", () => {
    // This order is load-bearing: resolving anonymous-first would let one shared
    // browser merge two different people into a single lead.
    const result = normalizeIdentities({
      anonymous_id: "anon_1",
      email: "a@b.example.com",
      phone: "+919876543210",
      user_id: "usr_1",
    });
    expect(result.map((i) => i.type)).toEqual([
      "EXTERNAL_USER_ID",
      "EMAIL",
      "PHONE",
      "ANONYMOUS_ID",
    ]);
  });

  it("returns nothing for an empty or absent block", () => {
    expect(normalizeIdentities(undefined)).toEqual([]);
    expect(normalizeIdentities(null)).toEqual([]);
    expect(normalizeIdentities({})).toEqual([]);
    expect(normalizeIdentities({ email: "   " })).toEqual([]);
  });

  it("lowercases email so casing never splits one person into two", () => {
    expect(normalizeIdentities({ email: "  Priya@ACME.example.com " })[0]).toEqual({
      type: "EMAIL",
      value: "priya@acme.example.com",
    });
  });

  it("accepts external_id as an alias for user_id", () => {
    expect(normalizeIdentities({ external_id: "usr_9" })[0]).toEqual({
      type: "EXTERNAL_USER_ID",
      value: "usr_9",
    });
  });

  it("normalizes phones so formatting differences do not split a person", () => {
    const a = normalizeIdentities({ phone: "+91 98765 43210" });
    const b = normalizeIdentities({ phone: "9876543210" });
    expect(a[0].value).toBe(b[0].value);
  });

  it("drops a phone that normalizes to nothing", () => {
    expect(normalizeIdentities({ phone: "abc" }).some((i) => i.type === "PHONE")).toBe(false);
  });

  it("truncates absurd values rather than rejecting the whole call", () => {
    const long = "x".repeat(5000);
    const result = normalizeIdentities({ user_id: long, anonymous_id: long });
    expect(result.find((i) => i.type === "EXTERNAL_USER_ID")?.value.length).toBe(200);
    expect(result.find((i) => i.type === "ANONYMOUS_ID")?.value.length).toBe(200);
  });

  it("coerces non-string identifiers instead of dropping them", () => {
    // Producers routinely send numeric user ids.
    expect(normalizeIdentities({ user_id: 8842 })[0]).toEqual({
      type: "EXTERNAL_USER_ID",
      value: "8842",
    });
  });

  it("handles an anonymous-only visitor, the pre-signup case", () => {
    const result = normalizeIdentities({ anonymous_id: "anon_01J" });
    expect(result).toEqual([{ type: "ANONYMOUS_ID", value: "anon_01J" }]);
  });
});

describe("deriveNameFromEmail", () => {
  it("turns a dotted local part into a readable name", () => {
    // Without this every product-sourced lead is called "Unknown", and the
    // Signals feed becomes a list of identical rows nobody can act on.
    expect(deriveNameFromEmail("priya.sharma@acme.example.com")).toBe("Priya Sharma");
  });

  it("handles underscores and hyphens", () => {
    expect(deriveNameFromEmail("rahul_verma@acme.example.com")).toBe("Rahul Verma");
    expect(deriveNameFromEmail("anne-marie.dupont@acme.example.com")).toBe("Anne Marie Dupont");
  });

  it("drops a plus tag", () => {
    expect(deriveNameFromEmail("priya+crm@acme.example.com")).toBe("Priya");
  });

  it("drops numeric segments, which are ids and not names", () => {
    expect(deriveNameFromEmail("john.1987@acme.example.com")).toBe("John");
  });

  it("falls back to the address when nothing name-like survives", () => {
    // Still better than "Unknown": it at least identifies the person.
    expect(deriveNameFromEmail("12345@acme.example.com")).toBe("12345@acme.example.com");
  });

  it("handles a single-word local part", () => {
    expect(deriveNameFromEmail("priya@acme.example.com")).toBe("Priya");
  });

  it("does not throw on junk input", () => {
    expect(() => deriveNameFromEmail("")).not.toThrow();
    expect(() => deriveNameFromEmail("no-at-sign")).not.toThrow();
  });

  it("caps absurd lengths", () => {
    expect(deriveNameFromEmail(`${"a".repeat(500)}@x.com`).length).toBeLessThanOrEqual(200);
  });
});
