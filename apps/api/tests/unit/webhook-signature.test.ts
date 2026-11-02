import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOLERANCE_SEC,
  MAX_ATTEMPTS,
  nextRetryDelay,
  parseSignature,
  signPayload,
  verifySignature,
} from "../../src/utils/webhook-signature";

const SECRET = "whsec_test_abc123";
const BODY = JSON.stringify({ event: "deal.won", data: { id: "d1" } });
const NOW = 1_755_417_600;

describe("signPayload", () => {
  it("emits the t=,v1= format", () => {
    const sig = signPayload(SECRET, BODY, NOW);
    expect(sig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(sig.startsWith(`t=${NOW},`)).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    expect(signPayload(SECRET, BODY, NOW)).toBe(signPayload(SECRET, BODY, NOW));
  });

  it("changes when the body changes", () => {
    expect(signPayload(SECRET, BODY, NOW)).not.toBe(signPayload(SECRET, `${BODY} `, NOW));
  });

  it("changes when the timestamp changes, which is what stops replay", () => {
    expect(signPayload(SECRET, BODY, NOW)).not.toBe(signPayload(SECRET, BODY, NOW + 1));
  });

  it("changes when the secret changes", () => {
    expect(signPayload(SECRET, BODY, NOW)).not.toBe(signPayload("other", BODY, NOW));
  });
});

describe("parseSignature", () => {
  it("reads timestamp and signature", () => {
    expect(parseSignature("t=123,v1=abc")).toEqual({ timestamp: 123, signatures: ["abc"] });
  });

  it("collects multiple v1 values for secret rotation", () => {
    expect(parseSignature("t=1,v1=a,v1=b").signatures).toEqual(["a", "b"]);
  });

  it("tolerates whitespace and unknown keys", () => {
    expect(parseSignature("t=5, v1=x , v0=legacy")).toEqual({ timestamp: 5, signatures: ["x"] });
  });

  it("degrades rather than throwing on junk", () => {
    expect(parseSignature("")).toEqual({ timestamp: null, signatures: [] });
    expect(parseSignature("garbage")).toEqual({ timestamp: null, signatures: [] });
    expect(parseSignature("t=notanumber,v1=x").timestamp).toBeNull();
  });
});

describe("verifySignature", () => {
  it("accepts a signature it just produced", () => {
    const sig = signPayload(SECRET, BODY, NOW);
    expect(verifySignature(SECRET, sig, BODY, { nowSec: NOW })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = signPayload(SECRET, BODY, NOW);
    const tampered = JSON.stringify({ event: "deal.won", data: { id: "ATTACKER" } });
    expect(verifySignature(SECRET, sig, tampered, { nowSec: NOW })).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const sig = signPayload(SECRET, BODY, NOW);
    expect(verifySignature("wrong", sig, BODY, { nowSec: NOW })).toBe(false);
  });

  it("accepts within the tolerance window", () => {
    const sig = signPayload(SECRET, BODY, NOW);
    expect(
      verifySignature(SECRET, sig, BODY, { nowSec: NOW + DEFAULT_TOLERANCE_SEC - 1 })
    ).toBe(true);
  });

  it("rejects a replayed request outside the window", () => {
    // The whole reason the timestamp is inside the signed payload: a captured
    // request stays cryptographically valid forever without this check.
    const sig = signPayload(SECRET, BODY, NOW);
    expect(
      verifySignature(SECRET, sig, BODY, { nowSec: NOW + DEFAULT_TOLERANCE_SEC + 1 })
    ).toBe(false);
  });

  it("rejects a timestamp too far in the future", () => {
    const sig = signPayload(SECRET, BODY, NOW + 10_000);
    expect(verifySignature(SECRET, sig, BODY, { nowSec: NOW })).toBe(false);
  });

  it("accepts either signature during a secret rotation", () => {
    const oldSig = signPayload("old_secret", BODY, NOW);
    const newSig = signPayload("new_secret", BODY, NOW);
    const combined = `t=${NOW},v1=${oldSig.split("v1=")[1]},v1=${newSig.split("v1=")[1]}`;
    expect(verifySignature("old_secret", combined, BODY, { nowSec: NOW })).toBe(true);
    expect(verifySignature("new_secret", combined, BODY, { nowSec: NOW })).toBe(true);
    expect(verifySignature("third_secret", combined, BODY, { nowSec: NOW })).toBe(false);
  });

  it("rejects a malformed or empty header without throwing", () => {
    expect(verifySignature(SECRET, "", BODY, { nowSec: NOW })).toBe(false);
    expect(verifySignature(SECRET, "v1=abc", BODY, { nowSec: NOW })).toBe(false);
    expect(verifySignature(SECRET, `t=${NOW}`, BODY, { nowSec: NOW })).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // A naive timingSafeEqual would throw here, and the exception path itself
    // would leak that the lengths differ.
    expect(() => verifySignature(SECRET, `t=${NOW},v1=short`, BODY, { nowSec: NOW })).not.toThrow();
    expect(verifySignature(SECRET, `t=${NOW},v1=short`, BODY, { nowSec: NOW })).toBe(false);
  });
});

describe("retry ladder", () => {
  it("escalates and then gives up", () => {
    expect(nextRetryDelay(1)).toBe(30_000);
    expect(nextRetryDelay(MAX_ATTEMPTS)).toBe(21_600_000);
    expect(nextRetryDelay(MAX_ATTEMPTS + 1)).toBeNull();
    expect(nextRetryDelay(0)).toBeNull();
  });

  it("is strictly increasing so a struggling receiver gets more room each time", () => {
    for (let i = 2; i <= MAX_ATTEMPTS; i += 1) {
      expect(nextRetryDelay(i)!).toBeGreaterThan(nextRetryDelay(i - 1)!);
    }
  });
});
