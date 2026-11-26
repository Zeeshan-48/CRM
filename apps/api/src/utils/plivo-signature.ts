import crypto from "crypto";
import config from "../config";

/** Constant-time equality check that never throws on length mismatch. */
export const safeEqualString = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Deterministic, unguessable webhook path token for platform-tier Plivo webhooks.
 * Derived from JWT_SECRET + PLIVO_AUTH_ID so it survives restarts without DB state
 * and prevents unauthenticated hits against static predictable paths.
 */
export const getPlatformPlivoWebhookToken = (
  authId: string = config.PLIVO_AUTH_ID,
  secret: string = config.JWT_SECRET
): string => {
  const cleanId = authId.trim();
  const cleanSecret = secret.trim();
  if (!cleanId || !cleanSecret) return "";
  return crypto
    .createHmac("sha256", cleanSecret)
    .update(`plivo-webhook:${cleanId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
};

/**
 * Verifies Plivo's V2 HMAC-SHA256 webhook signature (`X-Plivo-Signature-V2` / `Ma-V2`):
 *   HMAC-SHA256(authToken, uriWithoutQuery + nonce) -> base64
 * Accepts comma-separated signatures (token rotation) and multiple candidate base URLs
 * to accommodate reverse proxies (Nginx / Cloudflare).
 */
export const verifyPlivoV2Signature = (params: {
  baseUrls: string[];
  pathName: string;
  nonce: string;
  signatureHeader: string;
  authTokens: string[];
}): boolean => {
  const nonce = params.nonce.trim();
  const rawSignatures = params.signatureHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tokens = params.authTokens.map((t) => t.trim()).filter(Boolean);

  if (!nonce || rawSignatures.length === 0 || tokens.length === 0) {
    return false;
  }

  const normalizedPath = params.pathName.startsWith("/")
    ? params.pathName
    : `/${params.pathName}`;

  const uris = new Set<string>();
  for (const base of params.baseUrls) {
    const cleanBase = base.trim().replace(/\/+$/, "");
    if (!cleanBase) continue;
    uris.add(`${cleanBase}${normalizedPath}`);
    if (normalizedPath.endsWith("/")) {
      uris.add(`${cleanBase}${normalizedPath.slice(0, -1)}`);
    }
  }

  for (const token of tokens) {
    for (const uri of uris) {
      const expected = crypto
        .createHmac("sha256", token)
        .update(`${uri}${nonce}`, "utf8")
        .digest("base64");
      if (rawSignatures.some((sig) => safeEqualString(sig, expected))) {
        return true;
      }
    }
  }

  return false;
};

/** Escapes XML meta-characters to prevent XML injection in Plivo responses. */
export const escapeXml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
