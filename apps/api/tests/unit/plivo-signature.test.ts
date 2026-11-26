import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  escapeXml,
  getPlatformPlivoWebhookToken,
  verifyPlivoV2Signature,
} from "../../src/utils/plivo-signature";

describe("plivo security helpers", () => {
  it("derives a deterministic non-predictable platform webhook token", () => {
    const t1 = getPlatformPlivoWebhookToken("AUTH_123", "super_secret_jwt_key_12345678901234");
    const t2 = getPlatformPlivoWebhookToken("AUTH_123", "super_secret_jwt_key_12345678901234");
    const t3 = getPlatformPlivoWebhookToken("AUTH_999", "super_secret_jwt_key_12345678901234");

    expect(t1).toMatch(/^[a-f0-9]{32}$/);
    expect(t1).toBe(t2);
    expect(t1).not.toBe(t3);
    expect(getPlatformPlivoWebhookToken("", "secret")).toBe("");
  });

  it("verifies valid Plivo V2 signatures and rejects tampered or wrong-token signatures", () => {
    const authToken = "plivo_test_auth_token_abc";
    const baseUrl = "https://crm.example.com";
    const pathName = "/api/v1/telephony/webhooks/plivo/answer";
    const nonce = "1234567890";
    const validSig = crypto
      .createHmac("sha256", authToken)
      .update(`${baseUrl}${pathName}${nonce}`, "utf8")
      .digest("base64");

    expect(
      verifyPlivoV2Signature({
        baseUrls: [baseUrl],
        pathName,
        nonce,
        signatureHeader: validSig,
        authTokens: [authToken],
      })
    ).toBe(true);

    // Supports comma-separated signatures during token rotation
    expect(
      verifyPlivoV2Signature({
        baseUrls: ["https://proxy.example.com", baseUrl],
        pathName,
        nonce,
        signatureHeader: `stale_sig,${validSig}`,
        authTokens: ["old_token", authToken],
      })
    ).toBe(true);

    // Rejects wrong token or modified URL/nonce
    expect(
      verifyPlivoV2Signature({
        baseUrls: [baseUrl],
        pathName,
        nonce,
        signatureHeader: validSig,
        authTokens: ["wrong_token"],
      })
    ).toBe(false);
    expect(
      verifyPlivoV2Signature({
        baseUrls: [baseUrl],
        pathName: "/api/v1/telephony/webhooks/plivo/hangup",
        nonce,
        signatureHeader: validSig,
        authTokens: [authToken],
      })
    ).toBe(false);
  });

  it("escapes XML meta-characters to prevent injection", () => {
    expect(escapeXml('+91999"</Number><Speak>pwn</Speak>&\'')).toBe(
      "+91999&quot;&lt;/Number&gt;&lt;Speak&gt;pwn&lt;/Speak&gt;&amp;&apos;"
    );
  });
});
