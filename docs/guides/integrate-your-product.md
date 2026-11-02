# Integrate your product

For a team wiring its software product into Euron Open CRM. When it is done, an agent
looking at a lead sees what that person did inside your product, what you sell, what it
costs today and which offers apply, and can act back on your product from the record.

The architecture behind it is in [../architecture/product-integration.md](../architecture/product-integration.md).
Examples use the seeded Acme Robotics workspace and its connected product, Acme Cloud
(`https://app.acme.example.com`). Replace `https://crm-api.example.com` with your
deployment's API origin.

```
https://crm-api.example.com/api/v1/ingest
```

## 1. Connect your product and get keys

In the CRM: **Integrations**, then **Connected products**. Create the product (a name, its
URL, LIVE or TEST, and how the catalog arrives). Then open it: the **Keys** tab mints keys,
**Settings** holds the allowed origins and URLs, **Events** is the event registry and
**Setup** has snippets. Changing any of this needs the `settings` capability
([`routes/connected-apps.route.ts`](../../apps/api/src/routes/connected-apps.route.ts)).

| Key | Prefix | Where it lives | Reaches |
| --- | --- | --- | --- |
| Secret | `crm_sk_` | Your servers only | Every ingest endpoint |
| Publishable | `crm_pk_` | Your web pages | `POST /events` and `POST /identify`, from an allowed origin only |

- Each key is shown once. Only its hash is stored.
- Add your web origin (for example `https://app.acme.example.com`) under **Settings**
  before minting a publishable key; the CRM refuses to mint one for a product with no
  allowed origin. Origins match exactly: scheme, host and port, no wildcard subdomains.
- Send a key as `Authorization: Bearer <key>` or `X-API-Key: <key>`. A secret key in a URL
  (`?k=`) is refused with `401`, because it is already in someone's access log by then
  ([`middlewares/api-key.middleware.ts`](../../apps/api/src/middlewares/api-key.middleware.ts)).
- A key belongs to one connected product. You never name your product in a payload.

Every response uses one envelope:

```json
{ "success": true, "data": {}, "message": "Event recorded", "statusCode": 201 }
{ "success": false, "error": { "message": "..." }, "message": "route: ..., rayId: ...", "statusCode": 400 }
```

Quote the `rayId` when asking for help; it identifies the request in the API's log
([`middlewares/error-handler.middleware.ts`](../../apps/api/src/middlewares/error-handler.middleware.ts)).

## 2. Send events

### From your server (the SDK)

Anything a customer could forge from a browser (payments, plan changes, trials) belongs
on the server. The SDK is [`packages/sdk`](../../packages/sdk/README.md) (`@open-crm/sdk`).

```ts
import { OpenCRM } from "@open-crm/sdk";

const crm = new OpenCRM({
  apiKey: process.env.CRM_SECRET_KEY!,
  baseUrl: "https://crm-api.example.com/api/v1/ingest",
});

await crm.track({
  event: "checkout.completed",
  identity: { userId: "usr_8842", email: "priya@acme.example.com" },
  properties: { value: 999900, currency: "INR" }, // minor units
  product: { externalId: "plan_team" },
  idempotencyKey: order.id, // makes a retry a no-op
});
```

### Raw HTTP

```http
POST /api/v1/ingest/events
Authorization: Bearer crm_sk_...
Content-Type: application/json

{
  "event": "checkout.started",
  "occurred_at": "2026-10-20T09:12:00Z",
  "idempotency_key": "co_9931",
  "identity": { "user_id": "usr_8842", "email": "priya@acme.example.com" },
  "product": { "external_id": "plan_team", "name": "Team Plan" },
  "properties": { "value": 999900, "currency": "INR", "coupon": "SAVE20" },
  "context": { "page_url": "https://app.acme.example.com/billing", "session_id": "s_01" }
}
```

Required: `event`, `idempotency_key`, `occurred_at` (when it happened, not when you sent
it). The response says who the event attached to:

| Field | Meaning |
| --- | --- |
| `eventId` | The stored row |
| `leadId`, `contactId` | The person. Both null: stored anonymously, waiting for `/identify` |
| `matched` | True only when an identity already pointed at this person. False also when a new lead was just created, so read `leadId` |
| `deduped` | This `idempotency_key` was already stored; nothing was written |
| `registered` | First sighting of this event name; registered for review |

`POST /ingest/events/batch` takes `{ "events": [...] }`, at most 500, with a secret key.
One bad event never rejects the rest: the response is
`{ ok, received, recorded, deduped, orphaned, rejected, errors: [{ index, error }] }`.

### From the browser (the tracker)

```html
<script async
        src="https://crm-api.example.com/api/v1/ingest/t.js"
        data-crm-key="crm_pk_..."></script>
```

This gives page views, a `session.started` event per session (30 minutes of inactivity
ends one), and an anonymous id per browser kept in `localStorage` (`crm_anon_id`). It
patches `history.pushState` and `replaceState` and listens for `popstate`, so single-page
route changes count. It honours Do Not Track. It sends with `navigator.sendBeacon` (the
key in `?k=`, allowed for publishable keys only) and falls back to `fetch` with
`X-API-Key` ([`services/tracker-script.ts`](../../apps/api/src/services/tracker-script.ts)).

```js
crm.track("pricing.viewed", { plan: "Business" });
crm.page("Pricing");
crm.identify("usr_8842", { email: "priya@acme.example.com", name: "Priya Sharma" });
crm.reset();        // on sign-out, especially on shared devices
crm.consent(true);  // after your cookie banner, if you set data-crm-consent="false"
```

| Attribute | Default | Effect |
| --- | --- | --- |
| `data-crm-key` | none | The publishable key. Without it the tracker does nothing |
| `data-crm-endpoint` | Derived from `src` | Override the ingest base URL |
| `data-crm-auto` | `true` | Automatic page views and SPA route tracking |
| `data-crm-consent` | `true` | `false` holds everything until `crm.consent(true)` |

Calls made before the script loads can be queued in `window.crm.q` as arrays
(`["track", "pricing.viewed", {}]`); the tracker replays them.

The ingest API answers CORS for any origin and allows the `X-API-Key` header
([`app.ts`](../../apps/api/src/app.ts)), so the tracker works from your own site; what limits
a publishable key to your pages is the allowed-origins list on the connected product. Browser
calls get their own bucket of 240 per minute per key and visitor IP, on top of the key's
120 per minute for events.

## 3. Event names

You do not declare events in advance. Any name matching `^[a-z0-9_]+(\.[a-z0-9_]+)+$`
(at most 120 characters) is accepted. An unknown name is stored and auto-registered as
`NEEDS_REVIEW`: it shows on the timeline but moves no score and alerts nobody until an
admin activates it under **Events** ([ADR 0007](../architecture/adr/0007-unknown-events-accepted.md)).
Use `entity.action`, lower case: `report.exported`, `workspace.created`.

These names arrive with weights and meaning
([`constants/semantic-events.const.ts`](../../apps/api/src/constants/semantic-events.const.ts)).
Weight is the contribution to the 0 to 100 intent score before decay; "Alert" means the
lead's owner is notified.

| Event | Category | Weight | Alert |
| --- | --- | --- | --- |
| `page.viewed` | PAGE | 1 | |
| `pricing.viewed` | PAGE | 30 | yes |
| `content.viewed` | PAGE | 3 | |
| `session.started` | ACTION | 2 | |
| `signup.completed` | LIFECYCLE | 25 | |
| `trial.started` | LIFECYCLE | 40 | yes |
| `trial.ending` | LIFECYCLE | 35 | yes |
| `trial.expired` | LIFECYCLE | -10 | |
| `checkout.started` | COMMERCE | 60 | yes |
| `checkout.abandoned` | COMMERCE | 45 | yes |
| `checkout.completed` | COMMERCE | 80 | |
| `subscription.activated` | COMMERCE | 70 | |
| `subscription.renewed` | COMMERCE | 30 | |
| `subscription.cancelled` | COMMERCE | -50 | yes |
| `payment.failed` | COMMERCE | -15 | yes |
| `feature.used` | ACTION | 5 | |
| `limit.reached` | ACTION | 55 | yes |
| `invite.sent` | ACTION | 35 | |
| `demo.requested` | ACTION | 65 | yes |
| `support.contacted` | SUPPORT | 10 | |

You do not need to send `checkout.abandoned`. `checkout.started` opens an abandoned cart
on the person and `checkout.completed` or `subscription.activated` closes it.

Properties the CRM reads ([`services/engagement-fold.ts`](../../apps/api/src/services/engagement-fold.ts)):

| Property | Effect |
| --- | --- |
| `value` or `value_minor`, `currency` | Revenue in minor units (INR 9,999.00 is `999900`) |
| `plan` or `plan_name` | Plan shown on the record |
| `plan_status` | Any status you want surfaced, even one with no event |
| `mrr` or `mrr_minor` | Recurring revenue, minor units |
| `trial_ends_at` | ISO date |
| `counters` | `{ "seats_used": 12 }`: your own numbers, shown as given (up to 40 keys) |
| `coupon` | Recorded on the abandoned cart |

Everything else is stored and shown as is.

## 4. Identity

Send whatever you know. The CRM tries, in order: your `user_id`, `email`, `phone`, the
tracker's `anonymous_id` ([`services/identity.service.ts`](../../apps/api/src/services/identity.service.ts)).

- A known identity, or an existing lead with that email or phone, is matched.
- With an email or phone and no match, a lead is created.
- An anonymous id alone never creates a lead; its events are kept as orphans.

Call identify the moment a visitor signs up or signs in:

```ts
await crm.identify({
  userId: "usr_8842",
  anonymousId: "a_3f1c...", // from the tracker, if you have it
  traits: { email: "priya@acme.example.com", name: "Priya Sharma" },
});
```

Every earlier event with that anonymous id is attached to the person; the response's
`backfilled` says how many. Traits fill empty fields only and never overwrite what a
person typed in the CRM.

## 5. Publish your catalog

```ts
await crm.syncCatalog(
  [
    {
      externalId: "plan_team", // your id, stable forever: the upsert key
      name: "Team Plan",
      category: "Subscription",
      url: "https://app.acme.example.com/plan-team",
      highlights: ["25 seats", "Automation", "Priority support"],
      attributes: { seats: 25, support: "Priority" },
      prices: [
        { currency: "INR", amountMinor: 999900, billingPeriod: "MONTHLY", isDefault: true },
        { currency: "INR", amountMinor: 9999900, compareAtMinor: 11998800, billingPeriod: "YEARLY" },
      ],
    },
  ],
  "REPLACE",
);
```

The HTTP form is `PUT /ingest/catalog` with `{ mode, products }` and snake_case fields
(`external_id`, `amount_minor`, `compare_at_minor`, `billing_period`, `is_default`,
`price_book`).

- **Money is minor units.** There is no `amount` field; sending one is a `400` that names
  `amount_minor` ([ADR 0008](../architecture/adr/0008-minor-units-for-catalog-money.md)).
- Up to 500 products per call, no duplicate `external_id` in one payload. Per product: 10
  highlights of 160 characters, 30 attribute keys, 20 prices, an 8000-character
  description ([`services/catalog-mapping.ts`](../../apps/api/src/services/catalog-mapping.ts)).
- Each product's prices are replaced by the ones you send.
- `UPSERT` (default) touches only what you send. `REPLACE` also archives your products
  that are missing; it never deletes them, so deal line items and history survive a bad
  run. A product that comes back is un-archived.
- The response is `{ ok, mode, received, created, updated, archived }`.

### Offers and coupons

```ts
await crm.syncOffers([
  {
    code: "SAVE20", // omit for an automatic offer
    name: "20% off this month",
    discountType: "PERCENT",
    discountValue: 20,
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: "2026-10-31T23:59:59Z",
    maxRedemptions: 200,
    terms: "New customers only.",
  },
]);
```

- `PERCENT` is 0 to 100. `FLAT` is minor units with a `currency`.
- `appliesTo.product_ids` are your external ids. An offer whose named products are all
  unknown is skipped and counted in `skipped`, not widened to the whole catalog.
- Coupons are matched by code, codeless offers by name, so repeating a sync is safe.
- An offer outside its dates or past `maxRedemptions` is never shown to an agent.

### Pull instead of push

Set the product's catalog mode to **PULL** with an `https` feed URL returning
`{ "products": [...], "offers": [...] }` (optional `"mode"`, default `REPLACE`). The
`catalog-pull` job fetches feeds older than an hour, every 10 minutes, at most 10 per run,
with a 20 second timeout and an 8 MB cap ([`jobs/catalog-pull.job.ts`](../../apps/api/src/jobs/catalog-pull.job.ts)).

## 6. Capture leads

```ts
await crm.captureLead({
  name: "Priya Sharma",
  email: "priya@acme.example.com",
  source: "Pricing page",
  externalId: "form_123", // idempotent across retries
});
```

`POST /ingest/leads` (secret key) accepts lenient field names (`full_name`,
`first_name` plus `last_name`, `work_email`, `mobile`, `company`, `utm_source`, ...) and
keeps unknown fields in the lead's notes. At least a name, email or phone is required. An
existing email or phone updates that lead instead of duplicating it. A filled honeypot
field (`_gotcha`, `honeypot`, `_honey`, `bot-field`) is answered as a success with
`spam: true` and no lead ([`services/ingest.service.ts`](../../apps/api/src/services/ingest.service.ts)).

For form tools that cannot set headers, `POST /ingest/leads/t/{token}` takes the
workspace's `lit_` token, shown on the Integrations page.

## 7. Receive CRM events

Subscribe a URL under **Integrations**, **Webhooks**. The signing secret (`whsec_...`) is
shown once. Each delivery:

```http
POST https://app.acme.example.com/hooks/crm
Content-Type: application/json
X-CRM-Event: deal.won
X-CRM-Delivery: 01K...
X-CRM-Signature: t=1792400000,v1=<hex>
User-Agent: OpenCRM-Webhooks/1.0

{ "id": "01K...", "event": "deal.won", "created_at": "2026-10-20T09:12:00.000Z",
  "data": { "lead": {}, "contact": {}, "deal": {} } }
```

Verify the signature against the raw body, before parsing. It is HMAC-SHA256 over
`"<t>.<raw body>"`; several `v1=` values may appear, and any one verifying is enough
([`utils/webhook-signature.ts`](../../apps/api/src/utils/webhook-signature.ts)):

```ts
import crypto from "node:crypto";

export function verify(secret: string, header: string, rawBody: string): boolean {
  let t = NaN;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t") t = Number(v);
    else if (k === "v1" && v) sigs.push(v);
  }
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > 300) return false; // replay window

  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  return sigs.some((s) => {
    const b = Buffer.from(s);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
```

Events that are emitted in this release: `lead.created`, `lead.converted`,
`deal.stage_changed`, `deal.won`, `ticket.created`, `product.high_intent`,
`product.checkout_abandoned`, plus `product.event`, `product.trial_ending` and
`product.limit_reached` if you subscribe to them by name. The picker also lists
`lead.stage_changed`, `payment.success` and `meeting.scheduled`, which nothing emits yet
([`services/integrations.service.ts`](../../apps/api/src/services/integrations.service.ts)).

Delivery rules ([`services/webhook-dispatch.service.ts`](../../apps/api/src/services/webhook-dispatch.service.ts)):

- `https` only, public hosts only, re-checked on every attempt; redirects are not followed;
  10 second timeout.
- 2xx is success. A 4xx other than 408 and 429 stops retrying at once.
- Anything else is retried after 30 s, 2 min, 10 min and 1 h; the fifth failure is final.
- Every attempt is listed under webhook deliveries and can be replayed. **Test** on a
  subscription sends a real signed delivery.

## 8. Let agents act on your product

A connected product can declare actions that the CRM shows as buttons on a record. The CRM
POSTs to the product's `actions_url`, signed like a webhook with its actions secret and
`X-CRM-Event: action.<key>` ([`services/product-actions.service.ts`](../../apps/api/src/services/product-actions.service.ts)):

```json
{
  "id": "01K...",
  "action": "extend_trial",
  "requested_at": "2026-10-20T09:12:00.000Z",
  "params": { "days": 14 },
  "subject": { "type": "lead", "id": "01K...", "name": "Priya Sharma",
               "email": "priya@acme.example.com", "phone": null, "external_id": "usr_8842" }
}
```

Reply `{ "ok": true, "message": "Trial extended to 3 November" }`. The message is shown to
the agent as written and logged on the record's timeline. The subject is resolved by the
CRM from the record, never from the browser. Only declared actions can be fired, and firing
one needs the `settings` capability.

The actions URL (https) and secret are set through the API; rotate the secret with
`POST /api/v1/connected-apps/:id/rotate-actions-secret`. The action catalogue itself
(`[{ key, label, description, params_schema, confirm }]`) has no API or UI write path in
this release.

## 9. Check your own work

```bash
curl -s https://crm-api.example.com/api/v1/ingest/health \
  -H "Authorization: Bearer crm_sk_..."
```

```json
{
  "app": { "key": "acme-cloud", "name": "Acme Cloud", "environment": "LIVE", "status": "ACTIVE" },
  "health": "OK",
  "health_detail": null,
  "last_event_at": "2026-10-20T09:12:00.000Z",
  "last_catalog_sync_at": "2026-10-20T06:00:00.000Z",
  "events_24h": 128,
  "catalog": { "products": 3, "offers": 1 },
  "event_definitions": { "total": 21, "needs_review": 1 },
  "warnings": ["1 event name(s) were auto-registered and are awaiting review. ..."]
}
```

`health` is `PENDING` (nothing received), `OK`, `STALE` (silent for 48 hours) or `ERROR`
(the last catalog pull failed). Each warning names its fix.

## 10. Test without touching real data

Set the product's environment to **TEST**. Events are stored and visible as usual, but
they never move a score, fire a workflow or alert an owner. Switch to LIVE when ready.

## Reference

The machine-readable contract is served by the API: `GET /api/v1/ingest/openapi.json`.
Point a client generator at your deployment's URL rather than a copy.

| Method | Path | Key | Per minute | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/openapi.json` | none | | The contract |
| GET | `/t.js` | none | | The browser tracker |
| POST | `/leads` | secret | 120 per key | Capture a lead |
| POST | `/leads/t/{token}` | URL token | 120 per token | Lead capture for form tools |
| POST | `/identify` | either | 120 per key; publishable keys also 240 per key and IP | Bind an identity, claim anonymous history |
| POST | `/events` | either | 120 per key; publishable keys also 240 per key and IP | One event |
| POST | `/events/batch` | secret | 120 per key | Up to 500 events |
| PUT | `/catalog` | secret | 30 per key | Up to 500 products |
| PUT | `/catalog/offers` | secret | 30 per key | Up to 500 offers |
| GET | `/health` | secret | | Diagnose your integration |

Limits are fixed windows from [`middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts),
on top of a global 600 per minute per IP. Publishable-key traffic from every visitor of a
page shares its key's `/events` budget.

| Symptom | Cause |
| --- | --- |
| `400` naming `amount_minor` | A price was sent as `amount`. Convert to minor units |
| `401` with a key present | Secret key in the query string, or an unknown or revoked key |
| `403` "requires a secret key" | A publishable key on a secret-only route |
| `403` "origin is not allowed" | The page's origin is not in the product's allowed origins |
| `403` "paused" or "disabled" | The connected product is not `ACTIVE` |
| Events accepted, nobody sees them | `leadId` and `contactId` are null; call `/identify` with the same anonymous id or an email |
| Event stored, score unchanged | The product is in TEST, or the name is still `NEEDS_REVIEW` |
| Offer synced, not shown | Expired, used up, or every named product unknown (`skipped`) |
| Signature never verifies | It was checked against the parsed body, not the raw bytes |
