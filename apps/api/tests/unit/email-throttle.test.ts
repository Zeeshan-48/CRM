import { describe, expect, it } from "vitest";
import { categoryMultiplier, readEmailTps } from "../../src/services/mailer.service";

describe("categoryMultiplier", () => {
  it("never throttles or blocks TRANSACTIONAL", () => {
    for (const status of ["ACTIVE", "WARNING", "THROTTLED", "PAUSED"]) {
      expect(categoryMultiplier(status, "TRANSACTIONAL")).toBe(1);
    }
  });

  it("ACTIVE sends everything at full rate", () => {
    expect(categoryMultiplier("ACTIVE", "NOTIFICATION")).toBe(1);
    expect(categoryMultiplier("ACTIVE", "MARKETING")).toBe(1);
  });

  it("WARNING halves marketing only", () => {
    expect(categoryMultiplier("WARNING", "NOTIFICATION")).toBe(1);
    expect(categoryMultiplier("WARNING", "MARKETING")).toBe(0.5);
  });

  it("THROTTLED slows notifications and heavily throttles marketing", () => {
    expect(categoryMultiplier("THROTTLED", "NOTIFICATION")).toBe(0.5);
    expect(categoryMultiplier("THROTTLED", "MARKETING")).toBe(0.1);
  });

  it("PAUSED blocks marketing but still trickles notifications", () => {
    expect(categoryMultiplier("PAUSED", "MARKETING")).toBe(0);
    expect(categoryMultiplier("PAUSED", "NOTIFICATION")).toBe(0.5);
  });
});

describe("readEmailTps", () => {
  it("reads a numeric override from a config object", () => {
    expect(readEmailTps({ emailTps: 10 })).toBe(10);
  });

  it("reads from a JSON string config", () => {
    expect(readEmailTps('{"emailTps": 8}')).toBe(8);
  });

  it("falls back to the default for missing / invalid / non-positive values", () => {
    expect(readEmailTps(null)).toBe(5);
    expect(readEmailTps(undefined)).toBe(5);
    expect(readEmailTps({})).toBe(5);
    expect(readEmailTps({ emailTps: 0 })).toBe(5);
    expect(readEmailTps({ emailTps: "abc" })).toBe(5);
    expect(readEmailTps("not json")).toBe(5);
  });
});
