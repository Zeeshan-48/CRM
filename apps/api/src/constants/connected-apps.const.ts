// Connected apps: the external-system identity that every product integration
// hangs off (Salesforce calls this a Connected App, Zoho an Extension).
// See docs/product-integration-plan.md.

export const APP_STATUSES = ["ACTIVE", "PAUSED", "DISABLED"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

// TEST-environment apps ingest normally but never contribute to lead scoring,
// so an integrating team can rehearse against real data without polluting it.
export const APP_ENVIRONMENTS = ["LIVE", "TEST"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const CATALOG_MODES = ["PUSH", "PULL", "MANUAL"] as const;
export type CatalogMode = (typeof CATALOG_MODES)[number];

export const APP_HEALTH = ["PENDING", "OK", "STALE", "ERROR"] as const;
export type AppHealth = (typeof APP_HEALTH)[number];

// An app is STALE once it has been silent for this long after having reported
// at least one event. Surfaced on the integration console so a silently broken
// producer is visible before someone notices missing leads.
export const APP_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

// ---- API key scopes ----
// SECRET keys are server-side and reach the whole ingest surface.
// PUBLISHABLE keys ship in browser JavaScript, so they are origin-checked and
// limited to the three calls a tracker needs. This is the Stripe split: it is
// what makes shipping a key in page source safe.
export const KEY_SCOPES = ["SECRET", "PUBLISHABLE"] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];

export const KEY_PREFIX: Record<KeyScope, string> = {
  SECRET: "crm_sk_",
  PUBLISHABLE: "crm_pk_",
};

// The only routes a PUBLISHABLE key may reach. Anything not listed here is a
// 403 for a browser key even if the key is otherwise valid.
export const PUBLISHABLE_ALLOWED_ACTIONS = ["track", "page", "identify"] as const;
export type PublishableAction = (typeof PUBLISHABLE_ALLOWED_ACTIONS)[number];

export const isPublishableAction = (value: string): value is PublishableAction =>
  (PUBLISHABLE_ALLOWED_ACTIONS as readonly string[]).includes(value);

// ---- Capabilities ----
// What a given app is wired up to do. Declared by the admin at connect time and
// used to hide surfaces that would otherwise render empty (e.g. no catalog tab
// for an app that only streams events).
export interface AppCapabilities {
  catalog: boolean; // publishes products + prices + offers
  events: boolean; // streams behavioural events
  identity: boolean; // calls /ingest/identify to stitch identities
  deeplink: boolean; // product_url is set, so CRM records can link back
  outbound: boolean; // receives CRM webhooks
  actions: boolean; // exposes actions the agent can fire from a record
}

export const DEFAULT_CAPABILITIES: AppCapabilities = {
  catalog: false,
  events: true,
  identity: true,
  deeplink: false,
  outbound: false,
  actions: false,
};

export const parseCapabilities = (value: unknown): AppCapabilities => {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_CAPABILITIES };
    }
  }
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof AppCapabilities): boolean =>
    typeof obj[key] === "boolean" ? (obj[key] as boolean) : DEFAULT_CAPABILITIES[key];
  return {
    catalog: pick("catalog"),
    events: pick("events"),
    identity: pick("identity"),
    deeplink: pick("deeplink"),
    outbound: pick("outbound"),
    actions: pick("actions"),
  };
};

// ---- Legacy back-compat ----
// API keys minted before connected apps existed carry app_id = NULL. Rather
// than break them, authenticateApiKey binds them to this auto-created app on
// first use, so the pre-existing ingest contract keeps working verbatim.
export const DEFAULT_APP_KEY = "default";
export const DEFAULT_APP_NAME = "Default product";

/**
 * URL-safe slug for an app key. Deliberately strict (lowercase, alphanumeric,
 * single dashes) because the key appears in payloads, docs and deep links, and
 * a key that changes shape later would break every producer using it.
 */
export const slugifyAppKey = (input: string): string =>
  String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

/** Normalizes a stored JSON string[] column (origins) into a real string[]. */
export const parseStringArray = (value: unknown): string[] => {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
};

/**
 * Origin match for a PUBLISHABLE key. Exact scheme+host+port only: no wildcard
 * subdomains, because a tracker key that any subdomain can use is a tracker key
 * an attacker can use from a subdomain they control.
 */
export const isOriginAllowed = (origin: string, allowed: string[]): boolean => {
  if (!allowed.length) return false;
  const normalize = (value: string): string => {
    try {
      return new URL(value).origin.toLowerCase();
    } catch {
      return String(value || "").trim().toLowerCase().replace(/\/+$/, "");
    }
  };
  const target = normalize(origin);
  if (!target) return false;
  return allowed.some((a) => normalize(a) === target);
};

// ---- Health ----

export interface AppHealthInput {
  status: string;
  last_error: string | null;
  last_event_at: Date | string | null;
}

export interface AppHealthResult {
  health: AppHealth;
  detail: string | null;
}

/**
 * Health is DERIVED on read, not stored. "Stale" is a function of elapsed time,
 * so a stored value would need a sweep to stay honest and would be wrong between
 * sweeps. The column still records the last write outcome (OK / ERROR); this
 * layers staleness on top of it.
 *
 * Pure so it can be unit-tested without a database. `now` is injectable for the
 * same reason.
 */
export const deriveAppHealth = (row: AppHealthInput, now = Date.now()): AppHealthResult => {
  if (row.status === "DISABLED") return { health: "PENDING", detail: "Disabled" };
  if (row.last_error) return { health: "ERROR", detail: row.last_error };
  if (!row.last_event_at) return { health: "PENDING", detail: "No events received yet" };

  const at = new Date(row.last_event_at).getTime();
  if (Number.isNaN(at)) return { health: "PENDING", detail: "No events received yet" };

  const since = now - at;
  if (since > APP_STALE_AFTER_MS) {
    const hours = Math.round(since / 3_600_000);
    return { health: "STALE", detail: `No events for ${hours}h` };
  }
  return { health: "OK", detail: null };
};
