// Activity-event contract of the first integrated product, frozen before the
// generic event model existed and kept so that producer keeps working. New
// integrations use the semantic vocabulary in semantic-events.const.ts.
//
// The names are now GENERIC: content.* carries the acted-on type in
// properties.content_type (COURSE, BOOK, TEST_SERIES, WEBINAR, …, an OPEN
// string; new LMS features add values without any change here). This keeps the
// allowlist permanently fixed at 10 names.

export const ALLOWED_ACTIVITY_EVENTS = new Set<string>([
  "content.created",
  "content.edited",
  "content.published",
  "plan.checkout_started",
  "plan.activated",
  "plan.payment_failed",
  "plan.renewed",
  "plan.cancel_scheduled",
  "plan.cancelled",
  "organization.updated",
  // Reserved for later phases (pre-allowlisted, no future contract change):
  "video.uploaded",
  "section.viewed",
]);

// Events that (in V1.5) should actively alert the lead's owner. Not wired for
// notifications in V1, kept here so the fast-follow has a single source.
// NOTE: content.published alerts only on the FIRST publish (handled in service).
export const HIGH_INTENT_EVENTS = new Set<string>([
  "plan.checkout_started",
  "plan.payment_failed",
  "plan.activated",
  "content.published",
]);

// The rolled-up "platform snapshot" persisted on leads.custom_fields and shown
// in the lead's summary panel. Counts are generic (by content_type) so new LMS
// content types are captured with zero code change. `checkout_abandoned` is
// computed our side: true on checkout_started, cleared on activated.
export interface PlatformSnapshot {
  plan_status?: string; // active | payment_failed | cancel_scheduled | cancelled
  plan_name?: string;
  checkout_abandoned?: boolean;
  content_created?: number; // total content items created (any type)
  content_published?: number; // total content items published (any type)
  published_by_type?: Record<string, number>; // published count keyed by content_type
  first_published_at?: string; // ISO, earliest publish of any type
  last_platform_active_at?: string; // ISO, latest event occurred_at
}

const inc = (n: unknown): number => (typeof n === "number" && n >= 0 ? n : 0) + 1;

// Marks the earliest publish moment (kept immutable once the first arrives).
const earliest = (current: string | undefined, at: string): string =>
  !current || at < current ? at : current;

const strProp = (props: Record<string, unknown>, key: string): string => {
  const v = props[key];
  return typeof v === "string" ? v.trim() : "";
};

/**
 * Folds one event into the existing snapshot and returns the next snapshot.
 * Pure: same inputs → same output, no I/O. Idempotency (no double counting) is
 * guaranteed upstream, a duplicate idempotency_key short-circuits before this
 * ever runs, so counters only ever advance once per real event.
 */
export function applyEventToSnapshot(
  existing: PlatformSnapshot,
  event: string,
  occurredAtIso: string,
  properties: Record<string, unknown>
): PlatformSnapshot {
  const next: PlatformSnapshot = { ...existing };
  const contentType = strProp(properties, "content_type");
  const plan = strProp(properties, "resource_label") || strProp(properties, "plan");

  // Every event advances "last active", keeping the most recent occurred_at.
  if (!next.last_platform_active_at || occurredAtIso > next.last_platform_active_at) {
    next.last_platform_active_at = occurredAtIso;
  }

  switch (event) {
    case "content.created":
      next.content_created = inc(next.content_created);
      break;
    case "content.published": {
      next.content_published = inc(next.content_published);
      next.first_published_at = earliest(next.first_published_at, occurredAtIso);
      if (contentType) {
        const byType = { ...(next.published_by_type ?? {}) };
        byType[contentType] = inc(byType[contentType]);
        next.published_by_type = byType;
      }
      break;
    }
    case "plan.checkout_started":
      next.checkout_abandoned = true;
      if (plan) next.plan_name = plan;
      break;
    case "plan.activated":
      next.checkout_abandoned = false;
      next.plan_status = "active";
      if (plan) next.plan_name = plan;
      break;
    case "plan.renewed":
      next.plan_status = "active";
      if (plan) next.plan_name = plan;
      break;
    case "plan.payment_failed":
      next.plan_status = "payment_failed";
      break;
    case "plan.cancel_scheduled":
      next.plan_status = "cancel_scheduled";
      break;
    case "plan.cancelled":
      next.plan_status = "cancelled";
      break;
    default:
      // content.edited, organization.updated, video.uploaded, section.viewed:
      // only advance last_platform_active_at (done above).
      break;
  }
  return next;
}
