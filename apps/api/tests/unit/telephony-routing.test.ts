import { describe, expect, it } from "vitest";
import telephonyRoutingService from "../../src/services/telephony-routing.service";

// The TRAI window is pure (a function of the instant), so it tests without a
// database. The pickNextAgent priority order needs seeded rows and lives in
// tests/api/exotel-webhook.test.ts where a real tenant exists.

// Builds a Date that is the given IST wall-clock time (IST = UTC+5:30, no DST).
const istDate = (hour: number, minute: number): Date =>
  new Date(Date.UTC(2026, 7, 20, hour - 5, minute - 30));

describe("isWithinTraiWindow", () => {
  it("rejects just before the window opens", () => {
    expect(telephonyRoutingService.isWithinTraiWindow(istDate(8, 59))).toBe(false);
  });

  it("accepts at exactly 09:00 IST", () => {
    expect(telephonyRoutingService.isWithinTraiWindow(istDate(9, 0))).toBe(true);
  });

  it("accepts at 20:59 IST", () => {
    expect(telephonyRoutingService.isWithinTraiWindow(istDate(20, 59))).toBe(true);
  });

  it("rejects at exactly 21:00 IST", () => {
    expect(telephonyRoutingService.isWithinTraiWindow(istDate(21, 0))).toBe(false);
  });

  it("rejects in the middle of the night", () => {
    expect(telephonyRoutingService.isWithinTraiWindow(istDate(2, 30))).toBe(false);
  });

  it("accepts a mid-afternoon call", () => {
    expect(telephonyRoutingService.isWithinTraiWindow(istDate(15, 0))).toBe(true);
  });
});
