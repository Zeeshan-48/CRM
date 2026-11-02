import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../../src/utils/crypto";

describe("secret encryption", () => {
  it("round-trips a secret", () => {
    const secret = "twilio-auth-token-abc123";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("produces a fresh IV each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("secret");
    expect(() => decryptSecret(enc.slice(0, -2) + "xx")).toThrow();
    expect(() => decryptSecret("garbage")).toThrow();
  });
});
