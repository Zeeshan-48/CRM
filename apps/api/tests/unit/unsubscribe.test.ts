import { describe, expect, it } from "vitest";
import { signUnsubToken, verifyUnsubToken } from "../../src/utils/unsubscribe";

describe("unsubscribe token", () => {
  it("round-trips a signed token", () => {
    const token = signUnsubToken({ tenantId: "t_1", email: "a@b.example.com" });
    expect(verifyUnsubToken(token)).toEqual({ tenantId: "t_1", email: "a@b.example.com" });
  });

  it("rejects a tampered token", () => {
    const token = signUnsubToken({ tenantId: "t_1", email: "a@b.example.com" });
    expect(verifyUnsubToken(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyUnsubToken("")).toBeNull();
    expect(verifyUnsubToken("nope")).toBeNull();
    expect(verifyUnsubToken("a.b.c")).toBeNull();
  });
});
