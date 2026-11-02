// Reserved semantic events: the small vocabulary the CRM understands specially
// no matter which product is talking to it.
//
// This is Segment's "semantic events" idea. Everything OUTSIDE this list is
// still accepted and still stored: an unknown event name auto-registers as
// NEEDS_REVIEW rather than being rejected, so a producer is never blocked by a
// schema they forgot to declare. What this list buys is meaning: these names
// drive intent scoring, lifecycle transitions and owner alerts out of the box,
// with no per-tenant configuration.
//
// Seeded into app_event_definitions when a connected product is created. Once
// seeded, the rows are the source of truth: an admin can retune any weight in
// the UI and this file stops applying to that workspace. Changing a default here
// therefore affects NEW connected products only, never existing ones.

export const EVENT_CATEGORIES = ["PAGE", "ACTION", "LIFECYCLE", "COMMERCE", "SUPPORT"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const REVIEW_STATUSES = ["ACTIVE", "NEEDS_REVIEW", "IGNORED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface SemanticEventDefinition {
  name: string;
  label: string;
  description: string;
  category: EventCategory;
  icon: string;
  /**
   * Contribution to the product-intent score, -100..100, before recency decay.
   * Positive means "closer to buying", negative means "moving away".
   *
   * These are STARTING POINTS tuned for a self-serve SaaS motion. They decide
   * which leads surface in the signals feed, so they are worth arguing about
   * for the specific products that will integrate.
   */
  intent_weight: number;
  /** Notifies the lead owner in near real time. Keep this list short: an alert
   * that fires constantly is an alert nobody reads. */
  is_high_intent: boolean;
}

export const SEMANTIC_EVENTS: SemanticEventDefinition[] = [
  // ---- Browsing (individually weak, meaningful in volume) ----
  {
    name: "page.viewed",
    label: "Viewed a page",
    description: "Any page view inside the product. Sent automatically by the browser tracker.",
    category: "PAGE",
    icon: "file-text",
    intent_weight: 1,
    is_high_intent: false,
  },
  {
    name: "pricing.viewed",
    label: "Viewed pricing",
    description: "Opened the pricing page. The classic buying-intent signal.",
    category: "PAGE",
    icon: "tag",
    intent_weight: 30,
    is_high_intent: true,
  },
  {
    name: "content.viewed",
    label: "Viewed content",
    description: "Opened a specific catalog item, article or lesson.",
    category: "PAGE",
    icon: "book-open",
    intent_weight: 3,
    is_high_intent: false,
  },
  {
    name: "session.started",
    label: "Started a session",
    description: "A new browsing session began. Sent automatically by the tracker.",
    category: "ACTION",
    icon: "activity",
    intent_weight: 2,
    is_high_intent: false,
  },

  // ---- Lifecycle ----
  {
    name: "signup.completed",
    label: "Signed up",
    description: "Created an account in the product.",
    category: "LIFECYCLE",
    icon: "user-plus",
    intent_weight: 25,
    is_high_intent: false,
  },
  {
    name: "trial.started",
    label: "Started a trial",
    description: "Began a free trial.",
    category: "LIFECYCLE",
    icon: "play",
    intent_weight: 40,
    is_high_intent: true,
  },
  {
    name: "trial.ending",
    label: "Trial ending soon",
    description: "Trial is about to expire. The window where a call converts.",
    category: "LIFECYCLE",
    icon: "clock",
    intent_weight: 35,
    is_high_intent: true,
  },
  {
    name: "trial.expired",
    label: "Trial expired",
    description: "Trial ended without converting.",
    category: "LIFECYCLE",
    icon: "clock",
    intent_weight: -10,
    is_high_intent: false,
  },

  // ---- Commerce ----
  {
    name: "checkout.started",
    label: "Started checkout",
    description: "Reached the payment step.",
    category: "COMMERCE",
    icon: "shopping-cart",
    intent_weight: 60,
    is_high_intent: true,
  },
  {
    name: "checkout.abandoned",
    label: "Abandoned checkout",
    description: "Reached payment and left without completing. Highest-value callback.",
    category: "COMMERCE",
    icon: "shopping-cart",
    intent_weight: 45,
    is_high_intent: true,
  },
  {
    name: "checkout.completed",
    label: "Completed checkout",
    description: "Paid. Carries value and currency.",
    category: "COMMERCE",
    icon: "check-circle",
    intent_weight: 80,
    is_high_intent: false,
  },
  {
    name: "subscription.activated",
    label: "Subscription activated",
    description: "Became a paying customer.",
    category: "COMMERCE",
    icon: "credit-card",
    intent_weight: 70,
    is_high_intent: false,
  },
  {
    name: "subscription.renewed",
    label: "Subscription renewed",
    description: "Renewed an existing subscription.",
    category: "COMMERCE",
    icon: "refresh-cw",
    intent_weight: 30,
    is_high_intent: false,
  },
  {
    name: "subscription.cancelled",
    label: "Subscription cancelled",
    description: "Cancelled. A retention call, not a sales call.",
    category: "COMMERCE",
    icon: "x-circle",
    intent_weight: -50,
    is_high_intent: true,
  },
  {
    name: "payment.failed",
    label: "Payment failed",
    description: "A charge did not go through. Revenue at risk, and a reason to call.",
    category: "COMMERCE",
    icon: "alert-triangle",
    intent_weight: -15,
    is_high_intent: true,
  },

  // ---- Product usage ----
  {
    name: "feature.used",
    label: "Used a feature",
    description: "Performed a meaningful in-product action.",
    category: "ACTION",
    icon: "zap",
    intent_weight: 5,
    is_high_intent: false,
  },
  {
    name: "limit.reached",
    label: "Hit a plan limit",
    description: "Ran into a plan ceiling. The clearest upgrade signal a product can send.",
    category: "ACTION",
    icon: "bar-chart",
    intent_weight: 55,
    is_high_intent: true,
  },
  {
    name: "invite.sent",
    label: "Invited a teammate",
    description: "Invited someone else into the product. Strong multi-seat expansion signal.",
    category: "ACTION",
    icon: "users",
    intent_weight: 35,
    is_high_intent: false,
  },
  {
    name: "demo.requested",
    label: "Requested a demo",
    description: "Explicitly asked to talk to someone.",
    category: "ACTION",
    icon: "video",
    intent_weight: 65,
    is_high_intent: true,
  },

  // ---- Support ----
  {
    name: "support.contacted",
    label: "Contacted support",
    description: "Opened a support conversation. Engaged, but read the context before pitching.",
    category: "SUPPORT",
    icon: "life-buoy",
    intent_weight: 10,
    is_high_intent: false,
  },
];

export const SEMANTIC_EVENT_NAMES = new Set(SEMANTIC_EVENTS.map((e) => e.name));

export const findSemanticEvent = (name: string): SemanticEventDefinition | undefined =>
  SEMANTIC_EVENTS.find((e) => e.name === name);

// ---------------------------------------------------------------------------
// Legacy contract (the first integrated product's fixed allowlist)
// ---------------------------------------------------------------------------
//
// These names were frozen into the CRM before the platform was generalized.
// They are kept working verbatim: registered on first receipt with real metadata
// instead of landing at NEEDS_REVIEW with weight 0, and aliased onto their
// semantic equivalents so they drive lifecycle exactly as before.
//
// Deliberately NOT added to SEMANTIC_EVENTS: they are one product's vocabulary,
// and every other integrating product would see them as noise.

export const LEGACY_EVENTS: SemanticEventDefinition[] = [
  {
    name: "content.created",
    label: "Created content",
    description: "Created a course, book or other content item.",
    category: "ACTION",
    icon: "file-plus",
    intent_weight: 8,
    is_high_intent: false,
  },
  {
    name: "content.edited",
    label: "Edited content",
    description: "Edited an existing content item.",
    category: "ACTION",
    icon: "edit",
    intent_weight: 3,
    is_high_intent: false,
  },
  {
    name: "content.published",
    label: "Published content",
    description: "Made a content item live. Strong activation signal.",
    category: "ACTION",
    icon: "send",
    intent_weight: 30,
    is_high_intent: true,
  },
  {
    name: "plan.checkout_started",
    label: "Started checkout",
    description: "Reached the payment step.",
    category: "COMMERCE",
    icon: "shopping-cart",
    intent_weight: 60,
    is_high_intent: true,
  },
  {
    name: "plan.activated",
    label: "Plan activated",
    description: "Became a paying customer.",
    category: "COMMERCE",
    icon: "credit-card",
    intent_weight: 70,
    is_high_intent: false,
  },
  {
    name: "plan.payment_failed",
    label: "Payment failed",
    description: "A charge did not go through.",
    category: "COMMERCE",
    icon: "alert-triangle",
    intent_weight: -15,
    is_high_intent: true,
  },
  {
    name: "plan.renewed",
    label: "Plan renewed",
    description: "Renewed an existing plan.",
    category: "COMMERCE",
    icon: "refresh-cw",
    intent_weight: 30,
    is_high_intent: false,
  },
  {
    name: "plan.cancel_scheduled",
    label: "Cancellation scheduled",
    description: "Asked to cancel at the end of the period. A retention window.",
    category: "COMMERCE",
    icon: "clock",
    intent_weight: -30,
    is_high_intent: true,
  },
  {
    name: "plan.cancelled",
    label: "Plan cancelled",
    description: "Cancelled.",
    category: "COMMERCE",
    icon: "x-circle",
    intent_weight: -50,
    is_high_intent: true,
  },
  {
    name: "organization.updated",
    label: "Updated their organization",
    description: "Changed organization settings or branding.",
    category: "ACTION",
    icon: "building",
    intent_weight: 2,
    is_high_intent: false,
  },
  {
    name: "video.uploaded",
    label: "Uploaded a video",
    description: "Uploaded video content.",
    category: "ACTION",
    icon: "video",
    intent_weight: 6,
    is_high_intent: false,
  },
  {
    name: "section.viewed",
    label: "Viewed a section",
    description: "Opened a section of the product.",
    category: "PAGE",
    icon: "file-text",
    intent_weight: 2,
    is_high_intent: false,
  },
];

/**
 * Legacy name -> semantic equivalent.
 *
 * Applied when folding an event so a legacy producer drives lifecycle and plan
 * state exactly as it did before, without any LMS vocabulary leaking into the
 * generic fold. Names with no clean equivalent are simply counted, and can still
 * set plan state explicitly via `properties.plan_status`.
 */
export const EVENT_ALIASES: Record<string, string> = {
  "plan.checkout_started": "checkout.started",
  "plan.activated": "subscription.activated",
  "plan.payment_failed": "payment.failed",
  "plan.renewed": "subscription.renewed",
  "plan.cancelled": "subscription.cancelled",
};

export const canonicalEventName = (name: string): string => EVENT_ALIASES[name] ?? name;

/** A known definition for a name, semantic first, then the legacy contract. */
export const findKnownEvent = (name: string): SemanticEventDefinition | undefined =>
  findSemanticEvent(name) ?? LEGACY_EVENTS.find((e) => e.name === name);

/**
 * Lifecycle stage a semantic event moves a person INTO.
 *
 * Stages only ever move forward except for the two explicit exits (cancelled,
 * trial expired). Without that rule a stray `signup.completed` redelivery would
 * demote a paying customer back to SIGNED_UP.
 */
export const LIFECYCLE_STAGES = [
  "VISITOR",
  "SIGNED_UP",
  "TRIAL",
  "ACTIVE",
  "PAYING",
  "CHURNED",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

const STAGE_RANK: Record<LifecycleStage, number> = {
  VISITOR: 0,
  SIGNED_UP: 1,
  TRIAL: 2,
  ACTIVE: 3,
  PAYING: 4,
  CHURNED: 5,
};

export const LIFECYCLE_TRANSITIONS: Record<string, LifecycleStage> = {
  "signup.completed": "SIGNED_UP",
  "trial.started": "TRIAL",
  "feature.used": "ACTIVE",
  "checkout.completed": "PAYING",
  "subscription.activated": "PAYING",
  "subscription.renewed": "PAYING",
  "subscription.cancelled": "CHURNED",
  "trial.expired": "SIGNED_UP",
};

// Events that legitimately move a person BACKWARDS. Everything else is
// forward-only, so out-of-order or redelivered events cannot demote anyone.
const REGRESSIVE_EVENTS = new Set(["subscription.cancelled", "trial.expired"]);

/**
 * Next lifecycle stage given the current one and an incoming event.
 * Pure, so the ordering rule is unit-testable without a database.
 */
export const nextLifecycleStage = (
  current: string | null | undefined,
  event: string
): LifecycleStage | null => {
  const target = LIFECYCLE_TRANSITIONS[event];
  if (!target) return null;

  const from = (current && current in STAGE_RANK ? current : "VISITOR") as LifecycleStage;
  if (from === target) return null;

  if (REGRESSIVE_EVENTS.has(event)) return target;

  // A churned person who comes back must be able to re-enter the funnel, so
  // CHURNED is never a dead end for a forward event.
  if (from === "CHURNED") return target;

  return STAGE_RANK[target] > STAGE_RANK[from] ? target : null;
};
