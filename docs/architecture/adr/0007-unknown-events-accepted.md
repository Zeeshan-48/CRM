# ADR 0007: Unknown product events are accepted and held for review

## Status

Accepted.

## Context

A connected product sends behavioural events with names of its own choosing
(`report.exported`, `lesson.bookmarked`). Two postures are common. A strict registry
refuses any event that was not declared first, which blocks a producer over a schema it
forgot to update and drops data while the fix ships. An open sink accepts anything, which
is easy to integrate with but lets an event nobody has looked at change lead scores and
page sales people.

The CRM also needs some names to mean something without per-tenant setup: pricing views,
trials, checkouts, cancellations drive lifecycle stages, intent and owner alerts.

## Decision

- A small reserved vocabulary, `SEMANTIC_EVENTS` (20 names with a category, a label, an
  intent weight and a high-intent flag), is seeded into `app_event_definitions` when a
  connected product is created
  ([`constants/semantic-events.const.ts`](../../../apps/api/src/constants/semantic-events.const.ts)).
  After seeding, the rows are the source of truth and an admin can retune them.
- Any other name that matches `^[a-z0-9_]+(\.[a-z0-9_]+)+$` and is at most 120 characters
  is accepted and stored. On first sight it is auto-registered as `NEEDS_REVIEW`, weight 0,
  not high intent
  ([`services/activity-events.service.ts`](../../../apps/api/src/services/activity-events.service.ts),
  [`repositories/event-definitions.repository.ts`](../../../apps/api/src/repositories/event-definitions.repository.ts)).
- A `NEEDS_REVIEW` (or `IGNORED`) definition contributes nothing to the intent score
  ([`services/engagement.service.ts`](../../../apps/api/src/services/engagement.service.ts))
  and cannot trigger `product.high_intent` or an owner alert. It still counts in the
  person's usage counters and appears on the timeline.
- An admin activates it, with a label, category and weight, through
  `PATCH /api/v1/connected-apps/:id/events/:definitionId` (needs the `settings`
  capability). `/ingest/health` reports how many definitions await review.
- Names from the first integrated product's fixed contract (`LEGACY_EVENTS`) register as
  `ACTIVE` with real weights, and five of them are aliased onto semantic names, so that
  producer kept working unchanged.

## Consequences

Positive:

- A producer is never blocked by the registry; a new event name ships without touching
  the CRM.
- Scores and alerts move only on events a person has reviewed, so a buggy or noisy
  producer cannot page a sales team.
- Out of the box, a product that uses the semantic names gets lifecycle, intent and alerts
  with no configuration.

Trade-offs:

- The registry can fill with names nobody reviews. There is no cap on auto-registrations
  per app and no expiry; someone has to work the review queue.
- Data for an unreviewed event is stored but has no effect on intent until it is
  activated. Activation applies to the 30-day window from the next recompute on; it does
  not change past fold results such as lifecycle.
- A typo in an event name becomes a new definition rather than an error.

## Alternatives considered

- **Refuse undeclared events.** Safe for scores, hostile to producers, and loses data
  while a declaration is pending.
- **Accept and score everything with a default weight.** Easiest to integrate, but an
  unreviewed event would change who surfaces in the signals feed.
