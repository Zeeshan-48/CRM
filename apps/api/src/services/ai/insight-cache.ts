import crypto from "node:crypto";
import { getRedis } from "../../db/redis";
import { HEURISTIC_GENERATED_BY } from "./heuristics";

// Bump when an assessment prompt or its response shape changes, so entries
// written under the old contract can never be served under the new one.
const VERSION = "v1";
const TTL_SECONDS = 12 * 60 * 60;

// `daysSinceActivity` derives from Date.now() and drifts every request. Floor it
// to whole days for the key or the cache would never hit.
const stableKeyValue = (key: string, value: unknown): unknown =>
  key === "daysSinceActivity" && typeof value === "number" ? Math.floor(value) : value;

const fingerprint = (input: unknown): string =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(input, stableKeyValue) ?? "")
    .digest("hex");

/**
 * Memoizes an LLM assessment in Redis, keyed by a hash of the exact payload sent
 * to the model. Any change to the record, its activities, or its messages yields
 * a different key, so entries need no explicit invalidation, a stale one is
 * simply unreachable, and the TTL only bounds how long it lingers.
 *
 * Without Redis, or if Redis errors, this degrades to a plain live call.
 *
 * `shouldCache` guards against persisting a degraded answer: the AI provider
 * swallows model failures and returns a heuristic fallback, which would
 * otherwise pin a transient outage into the cache for TTL_SECONDS.
 */
export const rememberInsight = async <T>(
  kind: string,
  tenantId: string,
  input: unknown,
  compute: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true
): Promise<T> => {
  const redis = getRedis();
  if (!redis) return compute();

  const key = `ai:${kind}:${VERSION}:${tenantId}:${fingerprint(input)}`;

  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return compute(); // fail open: a broken cache just means a live model call
  }

  const value = await compute();
  if (!shouldCache(value)) return value;

  try {
    await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  } catch {
    /* fail open */
  }
  return value;
};

// Every insight produced without the model carries the heuristic marker.
export const isModelGenerated = (value: { generatedBy: string }): boolean =>
  value.generatedBy !== HEURISTIC_GENERATED_BY;
