import crypto from "crypto";
import config from "../config";

export interface UnsubPayload {
  tenantId: string;
  email: string;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");
const sign = (body: string): string =>
  b64url(crypto.createHmac("sha256", config.JWT_SECRET).update(body).digest());

// Stateless HMAC-signed token (no DB lookup) carrying the tenant + recipient so
// the public unsubscribe endpoint can suppress without authentication.
export const signUnsubToken = (payload: UnsubPayload): string => {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
};

export const verifyUnsubToken = (token: string): UnsubPayload | null => {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as UnsubPayload;
    if (parsed.tenantId && parsed.email) return parsed;
    return null;
  } catch {
    return null;
  }
};
