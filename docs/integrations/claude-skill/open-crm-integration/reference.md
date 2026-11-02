# Open CRM integration reference

When in doubt the live spec wins: `GET {BASE}/api/v1/ingest/openapi.json`.

`{BASE}` is the CRM API origin, for example `https://crm-api.example.com`. All paths are
under `{BASE}/api/v1/ingest`.

## Endpoints

| Method | Path | Key | Per minute | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/openapi.json` | none | | The contract |
| GET | `/t.js` | none | | Browser tracker |
| POST | `/leads` | secret | 120 per key | Capture a lead |
| POST | `/leads/t/{token}` | URL token | 120 per token | Lead capture for no-code form tools |
| POST | `/identify` | either | 120 per key; publishable keys also 240 per key and IP | Bind an identity, claim anonymous history |
| POST | `/events` | either | 120 per key; publishable keys also 240 per key and IP | One event |
| POST | `/events/batch` | secret | 120 per key | Up to 500 events |
| PUT | `/catalog` | secret | 30 per key | Up to 500 products |
| PUT | `/catalog/offers` | secret | 30 per key | Up to 500 offers |
| GET | `/health` | secret | | Diagnose the integration |

"Either" means a publishable key (`crm_pk_`) works as well as a secret one. A global limit
of 600 requests per minute per IP applies on top.

## Authentication

```
Authorization: Bearer crm_sk_...
```

or `X-API-Key: crm_sk_...`. A secret key in a query string is refused with 401.

| Key | Prefix | Lives | Reaches |
| --- | --- | --- | --- |
| Secret | `crm_sk_` | Servers only | Everything |
| Publishable | `crm_pk_` | Page source | `/events`, `/identify`, from allowed origins only |

| Status | Cause |
| --- | --- |
| 401 | No key, unknown or revoked key, or a secret key in the URL |
| 403 | Publishable key on a secret-only route, origin not allowed, or the connected product is paused or disabled |

## Response envelope

```json
{ "success": true, "data": {}, "message": "...", "statusCode": 200 }
```

```json
{
  "success": false,
  "error": { "message": "products[0] (plan_team) price[0]: use \"amount_minor\" (paise/cents), not \"amount\". ..." },
  "message": "route: /catalog, errorMsg: ..., rayId: ...",
  "statusCode": 400
}
```

Quote the `rayId` when asking for help.

## Catalog

`PUT /catalog`

```json
{
  "mode": "UPSERT",
  "products": [
    {
      "external_id": "plan_team",
      "name": "Team Plan",
      "sku": "PLAN_TEAM",
      "description": "Markdown, rendered in the agent panel.",
      "category": "Subscription",
      "family": "Plans",
      "url": "https://app.acme.example.com/plan-team",
      "status": "ACTIVE",
      "sort_order": 0,
      "highlights": ["25 seats", "Automation", "Priority support"],
      "media": { "thumbnail": "https://app.acme.example.com/img/team.png", "images": [] },
      "attributes": { "seats": 25, "support": "Priority" },
      "prices": [
        { "currency": "INR", "amount_minor": 999900, "billing_period": "MONTHLY", "is_default": true },
        { "currency": "INR", "amount_minor": 9999900, "compare_at_minor": 11998800, "billing_period": "YEARLY" }
      ]
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `external_id` | Required, the upsert key, keep it stable |
| `name` | Required |
| `status` | `ACTIVE`, `DRAFT` or `ARCHIVED` |
| `highlights` | At most 10, 160 characters each |
| `attributes` | At most 30 keys, free-form |
| `description` | At most 8000 characters |
| `url`, `media` | Absolute URLs; relative ones are dropped. At most 10 images |
| `prices` | At most 20 per product; replaced wholesale on each sync |
| `amount_minor` | Required. Minor units. A bare `amount` is a 400 |
| `compare_at_minor` | Strike-through price, kept only when above `amount_minor` |
| `billing_period` | `ONE_TIME`, `MONTHLY`, `QUARTERLY`, `YEARLY` |
| `price_book` | Default `STANDARD` |

`mode`: `UPSERT` (default) touches only what is sent; `REPLACE` also archives this
product's missing items, never deleting them. A duplicate `external_id` in one payload is
refused.

Response: `{ ok, mode, received, created, updated, archived }`.

## Offers and coupons

`PUT /catalog/offers`

```json
{
  "offers": [
    {
      "name": "20% off this month",
      "code": "SAVE20",
      "terms": "New customers only.",
      "discount_type": "PERCENT",
      "discount_value": 20,
      "starts_at": "2026-10-01T00:00:00.000Z",
      "ends_at": "2026-10-31T23:59:59.000Z",
      "max_redemptions": 200,
      "status": "ACTIVE",
      "applies_to": { "product_ids": ["plan_team"], "categories": [] }
    }
  ]
}
```

- `discount_type`: `PERCENT` (0 to 100) or `FLAT` (minor units, with `currency`).
- `code`: omit for an automatic offer. Coupons match by code, codeless offers by name.
- `applies_to.product_ids` are your external ids. An offer whose named products are all
  unknown is skipped; the response's `skipped` is a count.
- Omit `applies_to` to apply across the catalog.
- Expired or used-up offers are never shown to agents.

Response: `{ ok, received, created, updated, skipped }`.

## Events

`POST /events`

```json
{
  "event": "checkout.started",
  "idempotency_key": "order_5521_started",
  "occurred_at": "2026-10-20T09:31:44.000Z",
  "title": "Started checkout",
  "identity": {
    "user_id": "usr_8842",
    "email": "priya@acme.example.com",
    "phone": "+15550100",
    "anonymous_id": "a_3f1c"
  },
  "context": {
    "page_url": "https://app.acme.example.com/billing",
    "referrer": "https://www.example.com/",
    "session_id": "s_01"
  },
  "product": { "external_id": "plan_team", "name": "Team Plan" },
  "properties": { "value": 999900, "currency": "INR" }
}
```

- `context.url` is an alias for `page_url`; `context.anonymous_id` is read too.
- `identity.external_id` is an alias for `user_id`.
- The product is looked up by `product.external_id`, `product.id` or
  `properties.product_id`. An event never creates a catalog row.
- Properties read by the CRM: `value` or `value_minor`, `currency`, `plan` or `plan_name`,
  `plan_status`, `mrr` or `mrr_minor`, `trial_ends_at`, `counters` (an object of numbers),
  `coupon`. Everything else is stored and shown as is.

Response:

```json
{ "ok": true, "eventId": "01K...", "leadId": "01K...", "contactId": null,
  "matched": false, "deduped": false, "registered": false }
```

| Field | Meaning |
| --- | --- |
| `leadId`, `contactId` | Who it attached to. Both null: stored anonymously, waiting for `/identify` |
| `matched` | True only when an identity already pointed at this person; false also when a lead was just created |
| `deduped` | This `idempotency_key` was already stored |
| `registered` | First sighting of an unknown name; registered for review |

### Batch

`POST /events/batch` with `{ "events": [...] }`, at most 500, secret key. Returns 201 with
per-event counts even when some were rejected:

```json
{ "ok": true, "received": 500, "recorded": 497, "deduped": 2, "orphaned": 0,
  "rejected": 1, "errors": [{ "index": 42, "error": "idempotency_key is required" }] }
```

## Semantic event vocabulary

Weight is the contribution to the 0 to 100 intent score before decay (14-day half-life,
30-day window). "Alert" notifies the lead's owner.

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

An admin can retune any of these per product. Categories are exactly `PAGE`, `ACTION`,
`LIFECYCLE`, `COMMERCE`, `SUPPORT`.

`checkout.started` opens an abandoned cart on the person; `checkout.completed` or
`subscription.activated` closes it. Lifecycle (`VISITOR`, `SIGNED_UP`, `TRIAL`, `ACTIVE`,
`PAYING`, `CHURNED`) only moves forward, except on `subscription.cancelled` and
`trial.expired`.

## Identity

`POST /identify`

```json
{
  "user_id": "usr_8842",
  "anonymous_id": "a_3f1c",
  "traits": { "email": "priya@acme.example.com", "name": "Priya Sharma", "city": "Austin" }
}
```

At least one of `user_id`, `traits.email`, `traits.phone` or `anonymous_id`. Response:
`{ leadId, contactId, created, matched, backfilled }`. Traits used: `email`, `phone`,
`name` (or `first_name` plus `last_name`), `city`, each only where the lead field is empty.

## Lead capture

`POST /leads`. Lenient field names: `name` / `full_name` / `first_name` + `last_name`,
`email` / `email_address` / `work_email`, `phone` / `phone_number` / `mobile`, `company` /
`company_name` / `organization`, `notes` / `message`, plus `city`, `country`, `source`,
`campaign`, `tags[]`, `utm_source`, `utm_medium`, `utm_campaign`.

At least a name, email or phone. An email or phone already on file updates that lead.
Unknown fields go into the lead's notes. `idempotency_key`, `external_id`, `leadgen_id` or
`id` makes the capture idempotent.

Response: `{ ok, leadId, deduped, spam? }`. `spam: true` with `leadId: null` means a
honeypot field (`_gotcha`, `honeypot`, `_honey`, `bot-field`) was filled.

`POST /leads/t/{token}` is the same for tools that cannot set headers; the `lit_` token is
on the CRM's Integrations page.

## Browser tracker

```html
<script async
  src="{BASE}/api/v1/ingest/t.js"
  data-crm-key="crm_pk_..."
  data-crm-auto="true"
  data-crm-consent="true"></script>
```

| Attribute | Default | Meaning |
| --- | --- | --- |
| `data-crm-key` | none | Publishable key. Without it the tracker does nothing |
| `data-crm-endpoint` | Derived from `src` | Override the ingest base |
| `data-crm-auto` | `true` | Automatic page views and SPA route changes |
| `data-crm-consent` | `true` | `false` holds everything until `crm.consent(true)` |

```js
crm.track("checkout.started", { value: 999900, currency: "INR" });
crm.page("Pricing");
crm.identify("usr_8842", { email: "priya@acme.example.com" });
crm.consent(true);
crm.reset(); // on sign-out
```

Honours Do Not Track. Keeps the anonymous id in `localStorage` (`crm_anon_id`); a session
(`crm_session`) ends after 30 minutes of inactivity and each new one sends
`session.started`. Uses `sendBeacon` (key in `?k=`) with a `fetch` fallback (`X-API-Key`).
Never surfaces a tracking failure to the page. Calls queued in `window.crm.q` before load
are replayed.

## Webhooks (the CRM calls you)

Events emitted in this release: `lead.created`, `lead.converted`, `deal.stage_changed`,
`deal.won`, `ticket.created`, `product.event`, `product.high_intent`,
`product.checkout_abandoned`, `product.trial_ending`, `product.limit_reached`. The CRM's
picker also offers `lead.stage_changed`, `payment.success` and `meeting.scheduled`, which
nothing emits yet.

```
POST your-url
Content-Type: application/json
X-CRM-Event: deal.won
X-CRM-Delivery: 01K...
X-CRM-Signature: t=1792400000,v1=9f86d081...
User-Agent: OpenCRM-Webhooks/1.0

{ "id": "01K...", "event": "deal.won", "created_at": "2026-10-20T09:31:44.000Z",
  "data": { "lead": null, "contact": {}, "deal": {} } }
```

`data` carries the lead, contact and deal objects the event was emitted with; their fields
depend on the event.

Rules: https only to public hosts, checked on every attempt; redirects not followed; 10 s
timeout. 2xx is success. 4xx other than 408 or 429 is a permanent refusal. Anything else is
retried after 30 s, 2 min, 10 min and 1 h; the fifth failure is final. Every attempt is
listed in the CRM and can be replayed.

### Verifying the signature

HMAC-SHA256 over `"{t}.{raw body}"`, sent as `t=<unix>,v1=<hex>`. Several `v1=` values may
appear; accept if any verifies. Verify the raw bytes, before JSON parsing.

TypeScript (Express):

```ts
import crypto from "node:crypto";

const TOLERANCE_SEC = 5 * 60;

export function verifyCrmSignature(rawBody: Buffer | string, header: string, secret: string): boolean {
  let timestamp: number | null = null;
  const candidates: string[] = [];
  for (const part of String(header || "").split(",")) {
    const [k, v] = part.split("=", 2).map((x) => x?.trim());
    if (!k || !v) continue;
    if (k === "t") timestamp = Number(v);
    else if (k === "v1") candidates.push(v);
  }
  if (!timestamp || !Number.isFinite(timestamp) || !candidates.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TOLERANCE_SEC) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString()}`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected);
  return candidates.some((c) => {
    const b = Buffer.from(c);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// Mount with the raw body parser, not express.json():
// app.post("/hooks/crm", express.raw({ type: "*/*" }), (req, res) => { ... })
```

Python (Flask):

```python
import hashlib, hmac, time

TOLERANCE_SEC = 5 * 60

def verify_crm_signature(raw_body: bytes, header: str, secret: str) -> bool:
    timestamp, candidates = None, []
    for part in (header or "").split(","):
        k, _, v = part.partition("=")
        k, v = k.strip(), v.strip()
        if k == "t":
            timestamp = int(v) if v.isdigit() else None
        elif k == "v1":
            candidates.append(v)
    if not timestamp or not candidates:
        return False
    if abs(int(time.time()) - timestamp) > TOLERANCE_SEC:
        return False
    signed = f"{timestamp}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, c) for c in candidates)
```

## Actions (an agent presses a button, the CRM calls you)

Each action in the product's catalogue (at most 25):

```json
{
  "key": "extend_trial",
  "label": "Extend trial",
  "description": "Adds days to this account's trial.",
  "params_schema": { "days": { "type": "number", "label": "Days", "default": 14 } },
  "confirm": true
}
```

`confirm` defaults to true. The CRM POSTs to `actions_url` (https), signed like a webhook
with the actions secret, `X-CRM-Event: action.extend_trial`, 15 s timeout:

```json
{
  "id": "01K...",
  "action": "extend_trial",
  "requested_at": "2026-10-20T09:31:44.000Z",
  "params": { "days": 14 },
  "subject": { "type": "lead", "id": "01K...", "name": "Priya Sharma",
               "email": "priya@acme.example.com", "phone": null, "external_id": "usr_8842" }
}
```

A contact subject is `{ type: "contact", id, name, email, phone }`. Reply
`{ "ok": true, "message": "Trial extended to 3 November", "data": {} }`; a non-2xx reply is
shown as a failure with your `message`. The catalogue has no API or UI write path in this
release.

## Health

`GET /health` with a secret key:

```json
{
  "app": { "key": "acme-cloud", "name": "Acme Cloud", "environment": "LIVE", "status": "ACTIVE" },
  "health": "OK",
  "health_detail": null,
  "last_event_at": "2026-10-20T09:31:44.000Z",
  "last_catalog_sync_at": "2026-10-20T06:00:00.000Z",
  "events_24h": 128,
  "catalog": { "products": 3, "offers": 1 },
  "event_definitions": { "total": 21, "needs_review": 1 },
  "warnings": []
}
```

`health`: `PENDING` (nothing received), `OK`, `STALE` (silent 48 hours), `ERROR` (the last
catalog pull failed).

## Common failures

| Symptom | Cause |
| --- | --- |
| 400 naming `amount_minor` | A price sent as `amount`. Convert to minor units |
| 401 with a key present | Secret key in the query string, or an unknown or revoked key |
| 403 from the browser | Origin not in the product's allowed origins, or a publishable key on a secret-only route |
| Events accepted, nobody sees them | `leadId` and `contactId` are null. Call `/identify` with the same `anonymous_id` or an email |
| Event stored, score unchanged | The product is in TEST, or the name is still awaiting review (`event_definitions.needs_review`) |
| Offer synced, not visible | Expired, used up, or every named product unknown (`skipped`) |
| Signature never verifies | Verified the parsed body instead of the raw bytes |
