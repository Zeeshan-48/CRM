import { describe, expect, it } from "vitest";
import { MIN_SENDS_FOR_ACTION, tierFor } from "../../src/services/reputation.service";

const rates = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
function base() {
  return { sends: 1000, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 };
}

describe("reputation tierFor", () => {
  it("stays ACTIVE below the action volume regardless of rates", () => {
    expect(tierFor(rates({ sends: MIN_SENDS_FOR_ACTION - 1, bounceRate: 0.5 }))).toBe("ACTIVE");
  });

  it("stays ACTIVE when rates are clean", () => {
    expect(tierFor(rates())).toBe("ACTIVE");
  });

  it("maps bounce rate to tiers", () => {
    expect(tierFor(rates({ bounceRate: 0.03 }))).toBe("WARNING");
    expect(tierFor(rates({ bounceRate: 0.05 }))).toBe("THROTTLED");
    expect(tierFor(rates({ bounceRate: 0.08 }))).toBe("PAUSED");
  });

  it("maps complaint rate to tiers", () => {
    expect(tierFor(rates({ complaintRate: 0.0005 }))).toBe("WARNING");
    expect(tierFor(rates({ complaintRate: 0.001 }))).toBe("THROTTLED");
    expect(tierFor(rates({ complaintRate: 0.003 }))).toBe("PAUSED");
  });

  it("takes the worst of bounce vs complaint", () => {
    expect(tierFor(rates({ bounceRate: 0.03, complaintRate: 0.003 }))).toBe("PAUSED");
  });
});
