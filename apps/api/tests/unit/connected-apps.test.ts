import { describe, expect, it } from "vitest";
import {
  APP_STALE_AFTER_MS,
  DEFAULT_CAPABILITIES,
  KEY_PREFIX,
  deriveAppHealth,
  isOriginAllowed,
  isPublishableAction,
  parseCapabilities,
  parseStringArray,
  slugifyAppKey,
} from "../../src/constants/connected-apps.const";

describe("slugifyAppKey", () => {
  it("lowercases and dash-separates", () => {
    expect(slugifyAppKey("Acme Cloud App")).toBe("acme-cloud-app");
  });

  it("collapses runs of punctuation into a single dash", () => {
    expect(slugifyAppKey("My  App!!! v2")).toBe("my-app-v2");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyAppKey("  --Shop--  ")).toBe("shop");
  });

  it("caps length so the key stays usable in payloads and URLs", () => {
    expect(slugifyAppKey("a".repeat(120))).toHaveLength(48);
  });

  it("returns empty when nothing survives, so the service can reject it", () => {
    expect(slugifyAppKey("!!!")).toBe("");
    expect(slugifyAppKey("")).toBe("");
  });
});

describe("parseCapabilities", () => {
  it("falls back to defaults for null and malformed input", () => {
    expect(parseCapabilities(null)).toEqual(DEFAULT_CAPABILITIES);
    expect(parseCapabilities("not json")).toEqual(DEFAULT_CAPABILITIES);
  });

  it("reads a JSON string, as the driver may hand back a stringified column", () => {
    expect(parseCapabilities(JSON.stringify({ catalog: true }))).toMatchObject({
      catalog: true,
      events: DEFAULT_CAPABILITIES.events,
    });
  });

  it("ignores non-boolean values instead of coercing them", () => {
    // "true" as a string must NOT enable a capability: a truthy-coercion bug
    // here would silently turn on outbound delivery for an app that never
    // asked for it.
    expect(parseCapabilities({ outbound: "true" }).outbound).toBe(false);
    expect(parseCapabilities({ outbound: 1 }).outbound).toBe(false);
    expect(parseCapabilities({ outbound: true }).outbound).toBe(true);
  });
});

describe("parseStringArray", () => {
  it("handles arrays, JSON strings, null and junk", () => {
    expect(parseStringArray(["a", "b"])).toEqual(["a", "b"]);
    expect(parseStringArray('["a"]')).toEqual(["a"]);
    expect(parseStringArray(null)).toEqual([]);
    expect(parseStringArray("nope")).toEqual([]);
  });

  it("drops non-string members", () => {
    expect(parseStringArray(["a", 3, null, "b"])).toEqual(["a", "b"]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["https://app.example.com", "https://www.example.com"];

  it("matches on exact origin regardless of path", () => {
    expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://app.example.com/pricing?a=1", allowed)).toBe(true);
  });

  it("rejects everything when no origins are configured", () => {
    // A publishable key with an empty allowlist must be unusable, not open.
    expect(isOriginAllowed("https://app.example.com", [])).toBe(false);
  });

  it("does not treat a subdomain as the allowed origin", () => {
    expect(isOriginAllowed("https://evil.app.example.com", allowed)).toBe(false);
  });

  it("does not let a lookalike host through", () => {
    expect(isOriginAllowed("https://app.example.com.evil.io", allowed)).toBe(false);
  });

  it("distinguishes scheme and port", () => {
    expect(isOriginAllowed("http://app.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://app.example.com:8443", allowed)).toBe(false);
  });

  it("ignores case and a trailing slash on the configured value", () => {
    expect(isOriginAllowed("https://APP.example.com", ["https://app.example.com/"])).toBe(true);
  });

  it("rejects an empty origin", () => {
    expect(isOriginAllowed("", allowed)).toBe(false);
  });
});

describe("key scopes", () => {
  it("gives secret and publishable keys distinguishable prefixes", () => {
    expect(KEY_PREFIX.SECRET).toBe("crm_sk_");
    expect(KEY_PREFIX.PUBLISHABLE).toBe("crm_pk_");
    expect(KEY_PREFIX.SECRET).not.toBe(KEY_PREFIX.PUBLISHABLE);
  });

  it("limits publishable keys to the three tracker calls", () => {
    expect(isPublishableAction("track")).toBe(true);
    expect(isPublishableAction("page")).toBe(true);
    expect(isPublishableAction("identify")).toBe(true);
    expect(isPublishableAction("catalog")).toBe(false);
    expect(isPublishableAction("health")).toBe(false);
  });
});

describe("deriveAppHealth", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const base = { status: "ACTIVE", last_error: null, last_event_at: null };

  it("reports PENDING before the first event", () => {
    expect(deriveAppHealth(base, now)).toEqual({
      health: "PENDING",
      detail: "No events received yet",
    });
  });

  it("reports OK for a recently active app", () => {
    const at = new Date(now - 60_000).toISOString();
    expect(deriveAppHealth({ ...base, last_event_at: at }, now)).toEqual({
      health: "OK",
      detail: null,
    });
  });

  it("reports STALE once the silence exceeds the threshold", () => {
    const at = new Date(now - APP_STALE_AFTER_MS - 60_000).toISOString();
    const result = deriveAppHealth({ ...base, last_event_at: at }, now);
    expect(result.health).toBe("STALE");
    expect(result.detail).toMatch(/No events for \d+h/);
  });

  it("does not flip to STALE one millisecond early", () => {
    const at = new Date(now - APP_STALE_AFTER_MS).toISOString();
    expect(deriveAppHealth({ ...base, last_event_at: at }, now).health).toBe("OK");
  });

  it("surfaces a recorded error ahead of staleness", () => {
    const at = new Date(now - APP_STALE_AFTER_MS - 1).toISOString();
    expect(deriveAppHealth({ status: "ACTIVE", last_error: "401 from feed", last_event_at: at }, now))
      .toEqual({ health: "ERROR", detail: "401 from feed" });
  });

  it("reports a disabled app as PENDING rather than pretending it is healthy", () => {
    expect(deriveAppHealth({ ...base, status: "DISABLED", last_event_at: new Date(now).toISOString() }, now))
      .toEqual({ health: "PENDING", detail: "Disabled" });
  });

  it("treats an unparseable timestamp as never-seen instead of throwing", () => {
    expect(deriveAppHealth({ ...base, last_event_at: "not-a-date" }, now).health).toBe("PENDING");
  });
});
