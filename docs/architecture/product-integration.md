# Product integration

How an external software product connects to Euron Open CRM: it publishes its catalog,
streams what people do inside it, and receives CRM events back. The CRM never models the
product's domain. It models a contract (a catalog, a generic event stream, an identity
graph) and renders product-specific facts from metadata the product supplies. Paths are
relative to the repository root.

The guide for an integrating team is [../guides/integrate-your-product.md](../guides/integrate-your-product.md).
The flow is drawn in [events-and-automation.svg](../assets/diagrams/events-and-automation.svg).

| Topic | Section |
| --- | --- |
| The external system, its keys and its gate | [1](#1-connected-apps-and-keys) |
| The inbound pipeline | [2](#2-ingest-pipeline) |
| Identity and anonymous history | [3](#3-identity-graph) |
| Engagement profiles and intent | [4](#4-engagement-and-intent) |
| The event registry | [5](#5-event-definitions) |
| Catalog, prices, offers, deal line items | [6](#6-catalog) |
| Outbound webhooks and product actions | [7](#7-outbound) |
| Health and the served contract | [8](#8-health-and-the-served-contract) |
| Known limitations | [9](#9-known-limitations) |

## 1. Connected apps and keys

A connected app (`connected_apps`) is one external product a workspace has wired up. API
keys, catalog rows, event definitions, identities and engagement profiles all hang off it.

| Field | Values | Effect |
| --- | --- | --- |
| `key` | Slug, unique per tenant | Derived from the name by `slugifyAppKey`; permanent |
| `status` | `ACTIVE`, `PAUSED`, `DISABLED` | A paused or disabled app's keys get `403` on every ingest call |
| `environment` | `LIVE`, `TEST` | TEST traffic is stored and shown but never moves a score, fires a workflow or alerts an owner |
| `catalog_mode` | `PUSH`, `PULL`, `MANUAL` | Who owns the catalog; PULL needs an `https` feed URL |
| `allowed_origins` | JSON string array | The only origins a publishable key works from |
| `actions_url`, `actions_secret` | `https` URL, sealed secret | Where product actions are sent and how they are signed |
| `health` | `PENDING`, `OK`, `STALE`, `ERROR` | Last write outcome; staleness is derived on read |

Code: [`constants/connected-apps.const.ts`](../../apps/api/src/constants/connected-apps.const.ts),
[`services/connected-apps.service.ts`](../../apps/api/src/services/connected-apps.service.ts).

### Gating

The tenant routes (`/api/v1/connected-apps`, `/api/v1/products`, `/api/v1/signals`) sit
behind `M(..., "products", ...)` in [`routes/index.ts`](../../apps/api/src/routes/index.ts):
the `module.products` entitlement, then RBAC. Reading is part of the module. Every route
that changes the wiring (create, update, delete, mint a key, rotate the actions secret,
retune an event definition, fire a product action) also needs the `settings` capability
([`routes/connected-apps.route.ts`](../../apps/api/src/routes/connected-apps.route.ts)).
Creating an app checks `limit.connected_apps` against the count of apps that are not
`DISABLED`. See [multi-tenancy-and-entitlements.md](multi-tenancy-and-entitlements.md) and
[rbac.md](rbac.md).

### Keys

`POST /api/v1/connected-apps/:id/keys` mints a key bound to exactly one app. Creating the
app does not mint one.

| Scope | Prefix | Reaches |
| --- | --- | --- |
| `SECRET` | `crm_sk_` | Every ingest route |
| `PUBLISHABLE` | `crm_pk_` | `POST /events` and `POST /identify` only, and only from an allowed origin |

- A key is the prefix plus 32 hex characters (16 random bytes). Only its SHA-256 is stored
  (`api_keys.key_hash`), with the first few characters kept as `key_prefix` for display.
  The raw key is returned once.
- A publishable key cannot be minted for an app with no allowed origin.
- [`middlewares/api-key.middleware.ts`](../../apps/api/src/middlewares/api-key.middleware.ts)
  reads the key from `Authorization: Bearer`, `X-API-Key`, or `?k=`. The query form exists
  for `navigator.sendBeacon`, which cannot set headers, and is refused for secret keys.
- The middleware resolves the key to its tenant and its app, so a producer never names
  itself in a payload and cannot write to another app's catalog or event stream. The lookup
  joins the tenant and requires it to be `ACTIVE`: keys of a suspended or closed workspace
  answer 401.
- CORS: [`app.ts`](../../apps/api/src/app.ts) answers any origin on `/api/v1/ingest/*` and
  allows the `X-API-Key` header, so the tracker works from a product's own site. No
  credentials (cookies) are involved; the origin lock on publishable keys is enforced here,
  server side.
- For a publishable key it compares the `Origin` (or `Referer`) with `allowed_origins`:
  exact scheme, host and port, no wildcards.
- `requireSecretKey` guards the batch, catalog, lead and health routes.
- Keys minted from `/api/v1/integrations/api-keys` before connected apps existed carry no
  app. On first use they are bound to an auto-created `default` app ("Default product").

## 2. Ingest pipeline

Mounted at `/api/v1/ingest` in [`app.ts`](../../apps/api/src/app.ts), outside the
JWT-guarded tenant router and after the global per-IP limiter. Publishable-key calls to
`/identify` and `/events` pass `browserLimiter` (the 240 per key and IP `trackerLimiter`)
before `activityEventsLimiter`, so one busy page cannot drain the key's budget.

| Method | Path | Key | Limiter (per minute) | Handler |
| --- | --- | --- | --- | --- |
| GET | `/t.js` | none | global only | The browser tracker ([`services/tracker-script.ts`](../../apps/api/src/services/tracker-script.ts)) |
| GET | `/openapi.json` | none | global only | The contract ([`services/ingest-openapi.ts`](../../apps/api/src/services/ingest-openapi.ts)) |
| POST | `/leads` | secret | 120 per key | [`services/ingest.service.ts`](../../apps/api/src/services/ingest.service.ts) |
| POST | `/leads/t/:token` | URL token | 120 per token | same |
| POST | `/identify` | either | 120 per key; publishable keys also 240 per key and IP | [`services/identity.service.ts`](../../apps/api/src/services/identity.service.ts) |
| POST | `/events` | either | 120 per key; publishable keys also 240 per key and IP | [`services/activity-events.service.ts`](../../apps/api/src/services/activity-events.service.ts) |
| POST | `/events/batch` | secret | 120 per key | same, up to 500 events |
| PUT | `/catalog` | secret | 30 per key | [`services/catalog-sync.service.ts`](../../apps/api/src/services/catalog-sync.service.ts) |
| PUT | `/catalog/offers` | secret | 30 per key | same |
| GET | `/health` | secret | global only | [`services/integration-health.service.ts`](../../apps/api/src/services/integration-health.service.ts) |

Routes: [`routes/ingest.route.ts`](../../apps/api/src/routes/ingest.route.ts). Limiters:
[`middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts),
fixed windows in Redis when `REDIS_URL` is set, in memory otherwise, and off under tests.

### One event

`activityEventsService.ingestEvent`:

1. **Validate.** `event` must match `^[a-z0-9_]+(\.[a-z0-9_]+)+$` (case-insensitive) and be
   at most 120 characters. `idempotency_key` and an ISO `occurred_at` are required.
2. **Dedupe.** An `idempotency_key` already stored for the tenant returns the earlier row
   with `deduped: true` and writes nothing. A unique index
   (`activity_events(tenant_id, idempotency_key)`) settles a race between two deliveries.
3. **Resolve the definition.** Known names register as `ACTIVE` with their weights; an
   unknown name is auto-registered as `NEEDS_REVIEW` with weight 0
   ([section 5](#5-event-definitions), [ADR 0007](adr/0007-unknown-events-accepted.md)).
4. **Resolve the person** through the identity graph ([section 3](#3-identity-graph)).
5. **Resolve the product** by `product.external_id` (or `product.id`, or
   `properties.product_id`). An event never creates a catalog row.
6. **Insert** into `activity_events` with status `RECORDED` (a person was found) or
   `ORPHAN` (anonymous, waiting for identify). `value` or `value_minor` and `currency` are
   stored as `value_minor` and `currency`.
7. **After the insert, best-effort:** bump the definition's count, stamp the app's
   `last_event_at`, fold the event into the engagement profile, touch the lead's
   `last_activity_at`, recompute the lead score in the background, fire product workflow
   triggers and the owner alert ([section 4](#4-engagement-and-intent)), and write an audit
   row. None of these can fail the request.

The batch route runs the same path per event with fault isolation: a bad event is counted
in `rejected` with its index and message, and the rest are recorded. It returns
`{ ok, received, recorded, deduped, orphaned, rejected, errors[] }`.

### Leads

`POST /ingest/leads` (and the token variant for form tools that cannot send headers)
maps lenient field names onto a lead (`name` or `full_name` or `first_name` plus
`last_name`, `email` or `work_email`, `phone` or `mobile`, `company`, `utm_*`, and so on)
and keeps unrecognised fields in the lead's notes. A filled honeypot field (`_gotcha`,
`honeypot`, `_honey`, `bot-field`) is answered as a success with no lead. An
`idempotency_key`, `external_id`, `leadgen_id` or `id` makes the capture idempotent through
`lead_ingest_events(tenant_id, external_id)`. An existing lead with the same email or phone
is enriched (empty fields only, tags merged) instead of duplicated. New leads go through
`leadsService.create`, the same path as the UI, so the `limit.leads` check, scoring and the
`lead.created` workflows all apply. The URL token is `lit_` plus a ULID, stored in
`tenants.config.ingestToken` and rotated from `POST /api/v1/integrations/ingest/rotate-token`.

## 3. Identity graph

`app_identities` maps `(tenant, app, identity_type, identity_value)` to a lead or contact.
Types, strongest first: `EXTERNAL_USER_ID`, `EMAIL` (lower-cased), `PHONE` (normalised),
`ANONYMOUS_ID`.

`identityService.resolve` (called for every event):

1. An identity this app already bound wins.
2. Otherwise an existing lead with the same email or phone is matched, even if this app
   never saw it.
3. Otherwise, with an email or phone, a lead is created (named from the email's local part
   until a real name arrives). If creation fails, for example on the lead limit, the event
   is stored as an orphan and the producer is not blocked.
4. Otherwise the identities are recorded unbound and the event stays anonymous. An
   anonymous visitor never creates a lead, so bot traffic cannot fill the CRM or spend the
   workspace's lead limit.

`identityService.identify` (the `/identify` route) resolves the same way, then binds the
anonymous id to the person and re-points every orphan event with that anonymous id at
them in one indexed `UPDATE`, returning the count as `backfilled`. Traits fill only empty
lead fields; a name replaces only a placeholder (empty, `Unknown`, the email, or the name
derived from the email).

Deleting a lead or contact calls `engagementService.purgePerson` first, because none of
these tables has a foreign key to `leads` or `contacts`.

## 4. Engagement and intent

`engagement_profiles` holds one rollup row per (person, app).

### The fold

[`services/engagement-fold.ts`](../../apps/api/src/services/engagement-fold.ts) is a pure
function from (profile, event) to the next profile:

- **Lifecycle** `VISITOR`, `SIGNED_UP`, `TRIAL`, `ACTIVE`, `PAYING`, `CHURNED` moves forward
  only, except `subscription.cancelled` (to `CHURNED`) and `trial.expired` (to `SIGNED_UP`),
  so a redelivered signup cannot demote a paying customer
  ([`constants/semantic-events.const.ts`](../../apps/api/src/constants/semantic-events.const.ts)).
- **Plan facts** from any event: `plan` or `plan_name`, `plan_status`, `currency`,
  `mrr` or `mrr_minor`, `trial_ends_at`.
- **Counters.** `usage.counts` counts each raw event name; `usage.reported` stores the
  product's own `counters` object as given. Each is capped at 40 keys.
- **Abandoned checkout** is computed by the CRM: `checkout.started` sets
  `checkout_abandoned_at` and `abandoned_cart`; `checkout.completed` or
  `subscription.activated` clears them.
- **Top products**: the five most referenced catalog items.

Legacy event names from the first integrated product (`plan.activated`,
`plan.checkout_started`, and others) are aliased to their semantic equivalents before the
fold.

### Intent score

[`services/ai/intent.ts`](../../apps/api/src/services/ai/intent.ts), pure:

- Only events in the last 30 days whose definition is `ACTIVE` count.
- Each contributes `intent_weight` times a decay with a 14-day half-life.
- An open abandoned checkout adds 25.
- The sum maps to 0 to 100 as `100 * (1 - e^(-sum/120))`. `HOT` from 70, `WARM` from 40.
- The four strongest positive contributors are kept as `intent_reasons`.

`engagementService.recompute` derives the score and the 30-day counters
(`sessions_30d`, `events_30d`, `page_views_30d`, `active_days_30d`) from the stored events,
so running it twice changes nothing. It runs inline after each LIVE event and from the
`engagement-rollup` job every 15 minutes for profiles older than six hours (200 per tick),
because intent decays with time and a quiet lead must cool down on its own
([`jobs/engagement-rollup.job.ts`](../../apps/api/src/jobs/engagement-rollup.job.ts)).

The lead score is the higher of the CRM score and the best product intent across apps
(`blendLeadScore`, [`services/scoring.service.ts`](../../apps/api/src/services/scoring.service.ts)),
so a workspace without an integration keeps its grades.

### Signals and automation

`GET /api/v1/signals` lists profiles by intent across every app, with the person, the
reasons and the abandoned checkout ([`routes/signals.route.ts`](../../apps/api/src/routes/signals.route.ts)).

For LIVE events attached to a lead, `fireAutomation` emits workflow triggers in the
background ([automation-engine.md](automation-engine.md)):

| Trigger | When |
| --- | --- |
| `product.event` | Every event |
| `product.high_intent` | The definition is `ACTIVE` and `is_high_intent` |
| `product.checkout_abandoned` | `checkout.started` or `checkout.abandoned` (no delay: it fires on the start) |
| `product.trial_ending` | `trial.ending` |
| `product.limit_reached` | `limit.reached` |

A high-intent `ACTIVE` event also notifies the lead's owner.

## 5. Event definitions

`app_event_definitions` is the per-app registry: label, category (`PAGE`, `ACTION`,
`LIFECYCLE`, `COMMERCE`, `SUPPORT`), icon, `intent_weight` (-100 to 100), `is_high_intent`,
`review_status` (`ACTIVE`, `NEEDS_REVIEW`, `IGNORED`), `event_count`, `last_seen_at`.

- Creating an app seeds the 20 semantic events from `SEMANTIC_EVENTS`. After that the rows
  are the source of truth: a changed default in code affects new apps only.
- An unknown name is inserted as `NEEDS_REVIEW`, weight 0, `auto_registered: true`. It is
  stored, shown and folded into counters, but it adds nothing to intent and alerts nobody
  until an admin activates it with `PATCH /api/v1/connected-apps/:id/events/:definitionId`.

Decision record: [ADR 0007](adr/0007-unknown-events-accepted.md).

## 6. Catalog

### Products and prices

`products` rows carry `app_id` (null for a CRM-native product), `external_id` (the
product's own id, the upsert key), `source` (`SYNCED` or `MANUAL`), status, highlights,
attributes and media. `product_prices` rows carry `amount_minor`, `compare_at_minor`,
`currency`, `billing_period` and `price_book`, unique per
`(tenant, product, price_book, currency, billing_period)`.

`PUT /ingest/catalog` ([`services/catalog-mapping.ts`](../../apps/api/src/services/catalog-mapping.ts),
[`services/catalog-sync.service.ts`](../../apps/api/src/services/catalog-sync.service.ts)):

- Up to 500 products per call; a duplicate `external_id` in one payload is refused.
- Limits per product: 10 highlights of 160 characters, 30 attribute keys, 20 prices, an
  8000-character description, 10 images.
- Money is minor units only. A price with `amount` or `price` and no `amount_minor` is a
  `400` that names the fix ([ADR 0008](adr/0008-minor-units-for-catalog-money.md)).
- One transaction: products upserted by `external_id`; prices of every product in the
  payload replaced wholesale; with `mode: "REPLACE"`, products of this app missing from the
  payload archived, never deleted.

PULL mode: the `catalog-pull` job runs every 10 minutes, picks at most 10 apps whose last
sync is over an hour old, and fetches each feed through the SSRF guard
([`utils/http-guard.ts`](../../apps/api/src/utils/http-guard.ts): https only, public
addresses only, 20 s timeout, 8 MB cap). The feed is `{ mode?, products, offers? }`; its
mode defaults to `REPLACE`. A failure is recorded on the app's health
([`jobs/catalog-pull.job.ts`](../../apps/api/src/jobs/catalog-pull.job.ts)).

### Offers

`product_offers` unifies offers and coupons: an offer with a `code` is a coupon. Discounts
are `PERCENT` (0 to 100) or `FLAT` (minor units). `PUT /ingest/catalog/offers` matches
coupons by code and codeless offers by name, resolves `applies_to.product_ids` from
external ids, and skips (counts in `skipped`) an offer whose named products are all
unknown rather than widening it to the whole catalog. `isOfferLive` in
[`utils/catalog-pricing.ts`](../../apps/api/src/utils/catalog-pricing.ts) hides an offer
outside its window or past `max_redemptions`, whatever its stored status.

### Deal line items

`deal_line_items` attach catalog items (or ad-hoc lines) to a deal with quantity, unit
price, per-unit discount and total in minor units
([`services/deal-line-items.service.ts`](../../apps/api/src/services/deal-line-items.service.ts),
routes under `/api/v1/deals/:id/line-items`). When a deal has line items, `deals.value` is
derived from their sum through `minorToMajor` ([`utils/money.ts`](../../apps/api/src/utils/money.ts)),
the one place catalog money crosses into the major-unit columns, rounded half up. Without
line items the manually entered value stands.

## 7. Outbound

### Webhooks

`engineService.emit` hands every domain event to `webhookDispatchService.emit`
([`services/webhook-dispatch.service.ts`](../../apps/api/src/services/webhook-dispatch.service.ts)),
which queues one `webhook_deliveries` row per active subscription whose `event` equals the
event name. Nothing is sent inline.

The `webhook-dispatch` job runs every 15 seconds
([`jobs/webhook-dispatch.job.ts`](../../apps/api/src/jobs/webhook-dispatch.job.ts)): it
releases deliveries stuck in `SENDING` for over 5 minutes, claims up to 25 due deliveries
with a conditional `UPDATE` (`PENDING` to `SENDING`), and sends them concurrently.

| Rule | Value |
| --- | --- |
| Body | `{ id, event, created_at, data }`; `data` is `{ lead, contact, deal }` as the emitting service passed them |
| Headers | `X-CRM-Event`, `X-CRM-Delivery` (the delivery id), `X-CRM-Signature`, `User-Agent: OpenCRM-Webhooks/1.0` |
| Signature | `t=<unix>,v1=<hex>`, HMAC-SHA256 of `"<t>.<body>"` with the subscription's secret ([`utils/webhook-signature.ts`](../../apps/api/src/utils/webhook-signature.ts)) |
| Transport | `assertSafeUrl` on every attempt, redirects refused, 10 s timeout, response kept to 2000 characters |
| Success | Any 2xx: `SUCCEEDED` |
| Permanent refusal | 4xx other than 408 and 429: `EXHAUSTED` at once |
| Retries | Back to `PENDING` after 30 s, 2 min, 10 min, 1 h; the fifth failed attempt is `EXHAUSTED` |

Subscriptions are managed under `/api/v1/integrations/webhooks`; the signing secret is
`whsec_` plus a ULID, sealed with `sealSecret` and shown once. `POST .../:id/test` sends a
real signed delivery inline. `GET /api/v1/integrations/webhook-deliveries` lists attempts
and `POST .../webhook-deliveries/:id/replay` requeues one.

Events a subscription can name that are actually emitted: `lead.created`,
`lead.converted`, `deal.stage_changed`, `deal.won`, `ticket.created`, `product.event`,
`product.high_intent`, `product.checkout_abandoned`, `product.trial_ending`,
`product.limit_reached`. The list the UI offers (`WEBHOOK_EVENTS` in
[`services/integrations.service.ts`](../../apps/api/src/services/integrations.service.ts))
also names `lead.stage_changed`, `payment.success` and `meeting.scheduled`, which nothing
emits in this release.

### Product actions

The CRM calling into the product: an agent presses a button on a record and the product
does something (extend a trial, issue a coupon)
([`services/product-actions.service.ts`](../../apps/api/src/services/product-actions.service.ts)).

- The app declares `actions_catalog`: up to 25 entries of
  `{ key, label, description?, params_schema?, confirm? }`. `confirm` defaults to true.
- `POST /api/v1/connected-apps/:id/actions/:actionKey` (needs `settings`) fires one. Only a
  declared key can be fired, so the route is not a proxy into the product's API.
- The subject is resolved on the server from `lead_id` or `contact_id`
  (`{ type, id, name, email, phone }`, plus `external_id` for a lead).
- The call is inline (the agent waits): `assertSafeUrl`, 15 s timeout, no redirects,
  signed like a webhook with the app's actions secret and `X-CRM-Event: action.<key>`.
- The product's `message` is returned to the agent; the outcome is logged as a `NOTE`
  activity on the record and audited.

## 8. Health and the served contract

`GET /ingest/health` (secret key) returns the app, its derived health
(`deriveAppHealth`: `STALE` after 48 hours of silence), `last_event_at`,
`last_catalog_sync_at`, `events_24h`, catalog counts, event-definition counts and plain
`warnings[]`, each naming its fix (orphan events, definitions awaiting review, a declared
catalog with no products, PULL mode without a URL, TEST mode).

`GET /ingest/openapi.json` serves the ingest contract from the deployment itself, so a
client generator always gets that deployment's version.
[`tests/unit/ingest-openapi.test.ts`](../../apps/api/tests/unit/ingest-openapi.test.ts)
checks it against the router.

## 9. Known limitations

- **Actions catalogue has no write path.** `actions_catalog` is read everywhere, but neither
  the create nor the update schema accepts it, so today it can only be set in the
  database. The actions URL and secret can be set through the API.
- **Backfilled events are not folded.** `identify` re-points anonymous events at the
  person, and intent (recomputed from stored events) sees them, but lifecycle, plan facts,
  the abandoned cart and top products from those events are not replayed into the profile.
- **Fold order is arrival order.** Events are folded as they arrive, not by `occurred_at`.
- **No cap on auto-registration** and no retention policy for `activity_events`.
- **Line-item currency.** `deals.value` takes the currency of the first line item and sums
  every line's total without converting.
- **Automation is best-effort.** Product triggers run in a detached async block in the
  process that took the event; see [automation-engine.md](automation-engine.md).
