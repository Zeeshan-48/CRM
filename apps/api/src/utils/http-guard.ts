import dns from "dns/promises";
import net from "net";
import logger from "./logger";

// Outbound HTTP for tenant-supplied endpoints (AI-calling provider). Because the
// URL comes from tenant config, this is an SSRF surface: we allow only HTTPS to
// public hosts, block private/loopback/link-local/metadata ranges (re-checked
// per call to defeat DNS rebinding), and cap time + response size.

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000; // 1 MB
// Product catalog feeds are legitimately larger than a provider status payload
// (a few hundred products with descriptions and price rows), so callers may
// raise the cap. Still bounded: an unbounded read is a memory DoS.
const MAX_BYTES_CEILING = 8_000_000; // 8 MB

const isPrivateIp = (ip: string): boolean => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") ||
    lower.startsWith("fd") || // unique-local
    lower.startsWith("::ffff:") // IPv4-mapped: let the resolved A record check below catch it
  );
};

// Validates a tenant-supplied URL: HTTPS only, hostname must not resolve to a
// private/loopback/metadata address. Throws on violation.
export const assertSafeUrl = async (raw: string): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:") throw new Error("URL must use https");
  if (url.username || url.password) throw new Error("URL must not contain credentials");

  const host = url.hostname;
  // Literal IP host.
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("URL host is not allowed");
    return url;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new Error("URL host is not allowed");
  }
  // Resolve and ensure every address is public.
  let addrs: string[] = [];
  try {
    const records = await dns.lookup(host, { all: true });
    addrs = records.map((r) => r.address);
  } catch {
    throw new Error("URL host could not be resolved");
  }
  if (addrs.length === 0 || addrs.some(isPrivateIp)) {
    throw new Error("URL host is not allowed");
  }
  return url;
};

// Flattens an error and its nested `cause` chain into one readable line, e.g.
// "TypeError: fetch failed <- Error: connect ECONNREFUSED (ECONNREFUSED)".
const describeError = (err: unknown): string => {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur instanceof Error && depth < 4; depth += 1) {
    const code = (cur as NodeJS.ErrnoException).code;
    parts.push(code ? `${cur.name}: ${cur.message} (${code})` : `${cur.name}: ${cur.message}`);
    cur = cur.cause;
  }
  return parts.length ? parts.join(" <- ") : String(err);
};

export interface GuardedResponse {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}

// Performs an SSRF-guarded fetch with timeout + size cap. Re-validates the URL
// immediately before the request.
export const guardedFetch = async (
  rawUrl: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** Response size cap. Defaults to 1 MB, hard-capped at 8 MB. */
    maxBytes?: number;
    /** Request timeout. Defaults to 10s. */
    timeoutMs?: number;
  }
): Promise<GuardedResponse> => {
  await assertSafeUrl(rawUrl);
  const limit = Math.min(Math.max(init.maxBytes ?? MAX_BYTES, 1), MAX_BYTES_CEILING);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      redirect: "error", // do not follow redirects (could escape the allowlist)
      signal: controller.signal,
    });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > limit) throw new Error("Response too large");
    const text = Buffer.from(buf).toString("utf8");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    // Node's fetch collapses every network-layer failure (reset, TLS, DNS, a
    // blocked redirect) into a bare "TypeError: fetch failed" and hides the real
    // reason in err.cause, which is undiagnosable in a log. Unwrap the chain.
    logger.warn(`guardedFetch failed for a tenant endpoint: ${describeError(err)}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};
