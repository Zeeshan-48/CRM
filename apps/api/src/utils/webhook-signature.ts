import crypto from "crypto";

// HMAC signing for outbound calls (webhooks and product actions).
//
// Stripe's scheme, deliberately: `t=<unix>,v1=<hex>` over `"<t>.<body>"`. It is
// the format most integrating teams have already implemented once, it is
// verifiable in any language with a standard library, and including the
// timestamp inside the signed payload is what makes replay detection possible.
//
// Pure and dependency-free so it can be unit-tested and so the same code can be
// handed to an integrating team as reference.

export const SIGNATURE_HEADER = "X-CRM-Signature";
export const EVENT_HEADER = "X-CRM-Event";
export const DELIVERY_HEADER = "X-CRM-Delivery";

/** How far a delivery's timestamp may drift before we treat it as a replay. */
export const DEFAULT_TOLERANCE_SEC = 5 * 60;

/**
 * Signs a request body. `timestampSec` is injectable so tests are deterministic
 * and so a caller can sign a batch with one timestamp.
 */
export const signPayload = (
  secret: string,
  body: string,
  timestampSec = Math.floor(Date.now() / 1000)
): string => {
  const signed = `${timestampSec}.${body}`;
  const mac = crypto.createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  return `t=${timestampSec},v1=${mac}`;
};

interface ParsedSignature {
  timestamp: number | null;
  signatures: string[];
}

/**
 * Parses a signature header, tolerating multiple v1 values so a secret can be
 * rotated without a flag day: the sender emits both the old and new signature
 * for a window, and either verifies.
 */
export const parseSignature = (header: string): ParsedSignature => {
  const out: ParsedSignature = { timestamp: null, signatures: [] };
  for (const part of String(header || "").split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s?.trim());
    if (!key || !value) continue;
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) out.timestamp = n;
    } else if (key === "v1") {
      out.signatures.push(value);
    }
  }
  return out;
};

/** Constant-time compare that never throws on length mismatch. */
const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths, and its throw would itself leak
  // length information through an exception path.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verifies a signature header against a body.
 *
 * Both halves matter: the HMAC proves the payload was not tampered with, and the
 * timestamp window proves it is not an old valid request being replayed.
 */
export const verifySignature = (
  secret: string,
  header: string,
  body: string,
  options: { toleranceSec?: number; nowSec?: number } = {}
): boolean => {
  const parsed = parseSignature(header);
  if (parsed.timestamp === null || !parsed.signatures.length) return false;

  const tolerance = options.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  const now = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${body}`, "utf8")
    .digest("hex");

  return parsed.signatures.some((candidate) => safeEqual(candidate, expected));
};

/**
 * Retry ladder for a failed delivery, in milliseconds from now.
 *
 * Spread wide on purpose: a receiver that is down is usually down for minutes,
 * not milliseconds, and hammering it makes the outage worse. Returns null when
 * the attempts are exhausted.
 */
export const RETRY_DELAYS_MS = [
  30_000, // 30s
  120_000, // 2m
  600_000, // 10m
  3_600_000, // 1h
  21_600_000, // 6h
];

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

export const nextRetryDelay = (attempt: number): number | null => {
  if (attempt < 1 || attempt > RETRY_DELAYS_MS.length) return null;
  return RETRY_DELAYS_MS[attempt - 1];
};
