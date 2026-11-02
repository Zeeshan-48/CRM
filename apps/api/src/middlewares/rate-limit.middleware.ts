import { NextFunction, Request, RequestHandler, Response } from "express";
import config from "../config";
import { TooManyRequestError } from "../errors";
import rateLimitService from "../services/rate-limit.service";

// A key builder returns the identifier to rate-limit on, or null to skip this
// request entirely (e.g. no email in the body yet, or an unauthenticated call
// where a per-user limiter doesn't apply). Skipping never counts against a bucket.
type KeyBuilder = (req: Request) => string | null;

interface RateLimitOptions {
  // Namespace for the counter; keep distinct per bucket so limiters don't share
  // windows (e.g. "login-ip" vs "login-email").
  id: string;
  windowSec: number;
  max: number;
  key: KeyBuilder;
  // Optional custom 429 message.
  message?: string;
}

// Limiting is a no-op under tests (deterministic suites) and when the master
// switch is off. Mirrors the Redis client's own test guard.
const underTest = process.env.VITEST === "true" || config.NODE_ENV === "test";
const DISABLED = underTest || !config.RATE_LIMIT_ENABLED;

const clientIp = (req: Request): string =>
  req.ip || req.socket.remoteAddress || "unknown";

// ---- Key builders ---------------------------------------------------------

export const byIp =
  (prefix: string): KeyBuilder =>
  (req) =>
    `${prefix}:ip:${clientIp(req)}`;

// Keys on the submitted email (lowercased). Skips when absent so a malformed
// request never trips, the per-IP limiter still covers those.
export const byEmail =
  (prefix: string): KeyBuilder =>
  (req) => {
    const email = (req.body?.email as string | undefined)?.trim().toLowerCase();
    return email ? `${prefix}:email:${email}` : null;
  };

// Keys on the authenticated tenant user, falling back to IP if somehow unset.
export const byUser =
  (prefix: string): KeyBuilder =>
  (req) => {
    const id = req.authUser?.id;
    return id ? `${prefix}:user:${id}` : `${prefix}:ip:${clientIp(req)}`;
  };

// Keys on the inbound API key (set by authenticateApiKey), else the URL token
// param (no-code ingest), else the caller IP. Keeps one noisy source from
// exhausting a shared bucket.
export const byApiKeyOrIp =
  (prefix: string): KeyBuilder =>
  (req) => {
    const keyId = req.apiKey?.id;
    if (keyId) return `${prefix}:key:${keyId}`;
    const token = (req.params?.token as string | undefined)?.trim();
    if (token) return `${prefix}:token:${token}`;
    return `${prefix}:ip:${clientIp(req)}`;
  };

// Keys on the API key AND the caller IP together. Used for the browser tracker,
// where ONE publishable key legitimately serves thousands of visitors: keying on
// the key alone would let a single busy page exhaust the whole tenant's bucket,
// and keying on IP alone would pool unrelated tenants behind a shared NAT.
export const byApiKeyAndIp =
  (prefix: string): KeyBuilder =>
  (req) => {
    const keyId = req.apiKey?.id ?? "anon";
    return `${prefix}:key:${keyId}:ip:${clientIp(req)}`;
  };

// Keys on the authenticated operator, falling back to IP.
export const byOperator =
  (prefix: string): KeyBuilder =>
  (req) => {
    const id = req.operatorUser?.id;
    return id ? `${prefix}:op:${id}` : `${prefix}:ip:${clientIp(req)}`;
  };

// ---- Factory --------------------------------------------------------------

/**
 * Build an Express middleware that enforces a fixed-window rate limit. Emits the
 * standard RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset headers on
 * every request and a Retry-After header + 429 on rejection.
 */
export const rateLimit = (options: RateLimitOptions): RequestHandler => {
  const { id, windowSec, max, key, message } = options;

  // Self-contained: catches its own errors and forwards via next(err), so it
  // works unwrapped in both app.use() and route chains (no asyncHandler needed).
  return (req: Request, res: Response, next: NextFunction): void => {
    if (DISABLED) return next();

    const identifier = key(req);
    if (identifier === null) return next();

    void rateLimitService
      .consume(`${id}:${identifier}`, windowSec, max)
      .then((result) => {
        res.setHeader("RateLimit-Limit", result.limit);
        res.setHeader("RateLimit-Remaining", result.remaining);
        res.setHeader("RateLimit-Reset", result.resetSec);

        if (!result.allowed) {
          res.setHeader("Retry-After", result.resetSec);
          next(
            new TooManyRequestError(
              message ?? "Too many requests. Please wait a moment and try again."
            )
          );
          return;
        }
        next();
      })
      .catch(next);
  };
};

// ---- Tier presets ---------------------------------------------------------
// Central, reviewable map of every limit in the app. Windows in seconds.

const MIN = 60;

/** Broad per-IP backstop for the whole API surface (DoS / runaway client). */
export const globalApiLimiter = rateLimit({
  id: "global",
  windowSec: MIN,
  max: 600,
  key: byIp("global"),
  message: "Too many requests. Slow down and try again shortly.",
});

/** Login brute-force guard: per IP AND per email (chain both on the route). */
export const loginIpLimiter = rateLimit({
  id: "login-ip",
  windowSec: 5 * MIN,
  max: 10,
  key: byIp("login"),
  message: "Too many sign-in attempts. Please wait a few minutes and try again.",
});
export const loginEmailLimiter = rateLimit({
  id: "login-email",
  windowSec: 5 * MIN,
  max: 5,
  key: byEmail("login"),
  message: "Too many sign-in attempts for this account. Please wait and try again.",
});

/** Forgot-password email-flood guard: per IP AND per email. */
export const forgotIpLimiter = rateLimit({
  id: "forgot-ip",
  windowSec: 15 * MIN,
  max: 5,
  key: byIp("forgot"),
  message: "Too many reset requests. Please wait a while before trying again.",
});
export const forgotEmailLimiter = rateLimit({
  id: "forgot-email",
  windowSec: 15 * MIN,
  max: 3,
  key: byEmail("forgot"),
  message: "A reset link was already requested recently. Please check your inbox.",
});

/** Reset-password token-guessing guard (per IP). */
export const resetPasswordLimiter = rateLimit({
  id: "reset",
  windowSec: 15 * MIN,
  max: 10,
  key: byIp("reset"),
  message: "Too many attempts. Please request a fresh reset link.",
});

/** Authenticated operator changing their own password. */
export const changePasswordLimiter = rateLimit({
  id: "change-pw",
  windowSec: 15 * MIN,
  max: 10,
  key: byOperator("change-pw"),
  message: "Too many password changes. Please wait a few minutes.",
});

/** Public self-service booking (unauth, creates a lead), spam guard per IP. */
export const publicBookingLimiter = rateLimit({
  id: "booking",
  windowSec: 60 * MIN,
  max: 10,
  key: byIp("booking"),
  message: "Too many booking attempts. Please try again later.",
});

/** Public inbound lead ingestion (unauth by JWT; API key or token). Spam guard
 * per key/token, tighter than the global per-IP backstop. */
export const leadIngestLimiter = rateLimit({
  id: "ingest",
  windowSec: MIN,
  max: 120,
  key: byApiKeyOrIp("ingest"),
  message: "Too many lead submissions. Please slow down.",
});

/** Public inbound platform-activity events. Separate bucket (distinct Redis
 * namespace) so a burst of events can never starve lead ingestion. */
export const activityEventsLimiter = rateLimit({
  id: "events",
  windowSec: MIN,
  max: 120,
  key: byApiKeyOrIp("events"),
  message: "Too many activity events. Please slow down.",
});

/** Catalog sync. Its own bucket because a sync is far heavier than an event
 * (up to 500 products with prices in one transaction) and a producer looping on
 * it must never be able to starve lead ingestion or event ingestion. */
export const catalogSyncLimiter = rateLimit({
  id: "catalog",
  windowSec: MIN,
  max: 30,
  key: byApiKeyOrIp("catalog"),
  message: "Too many catalog syncs. Send the catalog in fewer, larger pages.",
});

/** Browser tracker (publishable keys). Keyed per key AND per IP: one page's
 * visitors must not exhaust the tenant's budget, and a shared NAT must not pool
 * unrelated visitors together. Generous, because page views are high volume. */
export const trackerLimiter = rateLimit({
  id: "tracker",
  windowSec: MIN,
  max: 240,
  key: byApiKeyAndIp("tracker"),
  message: "Too many events from this browser. Please slow down.",
});

/** Per-user cost guard for LLM-backed endpoints (copilot, agents). */
export const llmLimiter = rateLimit({
  id: "llm",
  windowSec: MIN,
  max: 20,
  key: byUser("llm"),
  message: "You're sending AI requests too quickly. Please pause a moment.",
});
