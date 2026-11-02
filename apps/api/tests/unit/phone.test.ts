import { describe, expect, it } from "vitest";
import { isE164, normalizePhone, normalizePhoneForStore } from "../../src/utils/phone";

describe("normalizePhone", () => {
  it("adds +91 to a bare 10-digit Indian number", () => {
    expect(normalizePhone("9876500001")).toBe("+919876500001");
  });

  it("strips spaces, dashes and brackets", () => {
    expect(normalizePhone("98765 00001")).toBe("+919876500001");
    expect(normalizePhone("98765-00001")).toBe("+919876500001");
    expect(normalizePhone("(987) 650-0001")).toBe("+919876500001");
  });

  it("keeps an already-international number", () => {
    expect(normalizePhone("+14155550123")).toBe("+14155550123");
    expect(normalizePhone("+91 98765 00001")).toBe("+919876500001");
  });

  it("handles the 00 international prefix", () => {
    expect(normalizePhone("0091 9876500001")).toBe("+919876500001");
  });

  it("drops a national trunk zero", () => {
    expect(normalizePhone("098765 00001")).toBe("+919876500001");
  });

  it("adds + when the number already carries the country code", () => {
    expect(normalizePhone("919876500001")).toBe("+919876500001");
  });

  it("respects a custom country code", () => {
    expect(normalizePhone("4155550123", "1")).toBe("+14155550123");
  });

  it("returns empty string for empty / null input", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });

  it("produces valid E.164 for typical inputs", () => {
    expect(isE164(normalizePhone("98765 00001"))).toBe(true);
    expect(isE164(normalizePhone("+14155550123"))).toBe(true);
  });
});

describe("normalizePhoneForStore", () => {
  it("normalizes a non-empty value", () => {
    expect(normalizePhoneForStore("98765 00001")).toBe("+919876500001");
  });

  it("preserves falsy values unchanged (save semantics)", () => {
    expect(normalizePhoneForStore("")).toBe("");
    expect(normalizePhoneForStore(null)).toBe(null);
    expect(normalizePhoneForStore(undefined)).toBe(undefined);
  });
});
