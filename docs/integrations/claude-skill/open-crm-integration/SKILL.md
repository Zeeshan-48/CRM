---
name: open-crm-integration
description: Integrate this product with Euron Open CRM so sales agents see what customers do in it. Covers pushing the catalog and prices, sending product events (page views, trials, checkout), identity stitching for anonymous visitors, lead capture, receiving CRM webhooks, and answering product actions the CRM calls. Use when wiring up Open CRM, sending product analytics or intent signals to a CRM, syncing a catalog or pricing to a CRM, handling crm_sk_ / crm_pk_ API keys, using @open-crm/sdk, or verifying an X-CRM-Signature.
argument-hint: [catalog|events|identity|tracker|webhooks|actions]
---

# Integrating with Euron Open CRM

The CRM is product-agnostic. It learns about your product from four inbound calls
(catalog, events, identity, leads) and calls back out two ways (webhooks, actions). It
knows nothing about your domain, which is what lets you integrate without anyone changing
the CRM.

The goal: an agent opening a lead sees "viewed pricing three times this week, then started
a checkout worth INR 9,999 and did not finish". Everything below exists to produce that.

Payloads, the event vocabulary, and signature code are in [reference.md](reference.md).

## Before writing code

1. **Fetch the live contract** from the deployment you integrate with:
   ```bash
   curl -s "$CRM_API_URL/api/v1/ingest/openapi.json" | head -c 2000
   ```
   `CRM_API_URL` is the API origin, for example `https://crm-api.example.com`. Ask the user
   if it is not in the repository's environment.
2. **Get keys from the CRM UI.** *Integrations*, *Connected products*, open the product:
   - **Keys** tab: a `crm_sk_` secret key for servers.
   - **Settings** tab: add the web origin before minting a `crm_pk_` publishable key (the
     CRM refuses one for a product with no allowed origin).
   - **Setup** tab: snippets.
   Each key is shown once. Store it as a secret, never in the repository.
3. **Pick the environment.** A connected product is `LIVE` or `TEST`. TEST traffic is
   stored and visible but never moves a score, fires a workflow or alerts anyone. Build
   against TEST.

## Wire it in this order

Each step is useful on its own.

| Step | You get | Effort |
| --- | --- | --- |
| 1. Catalog | Agents quote correct prices and live coupons | Low |
| 2. Events | Intent scoring, the signals feed, the timeline | Medium |
| 3. Identity | Anonymous pre-signup history attached to the person | Low |
| 4. Tracker | Page-level behaviour without backend code | Low |
| 5. Webhooks | Your product reacts to what sales learns | Medium |
| 6. Actions | Agents operate your product from the CRM | Medium |

For a Node server, prefer the SDK: `import { OpenCRM } from "@open-crm/sdk"` with
`new OpenCRM({ apiKey, baseUrl: "<CRM_API_URL>/api/v1/ingest" })`. Always pass `baseUrl`;
the default is a placeholder.

## Step 1: catalog

`PUT /api/v1/ingest/catalog` with a secret key, at most 500 products per request.

**Money is in minor units.** `amount_minor: 999900` is INR 9,999.00. A price sent as
`amount` is refused with a 400 naming `amount_minor`.

`external_id` is your id and the upsert key; keep it stable. Each product's prices are
replaced by the ones you send. Run the sync on catalog change or on a schedule.
`mode: "REPLACE"` also archives your products that are missing; it never deletes them.

## Step 2: events

`POST /api/v1/ingest/events`, or `/events/batch` (up to 500, secret key, one bad event
never rejects the rest).

Required: `event`, `idempotency_key`, `occurred_at`.

- `event`: dotted lower case matching `^[a-z0-9_]+(\.[a-z0-9_]+)+$`, at most 120
  characters. Prefer the semantic names in [reference.md](reference.md); they carry
  weights. Unknown names are accepted and registered for review; they score nothing until
  an admin activates them.
- `idempotency_key`: your id for this event. A repeat is a no-op.
- `occurred_at`: when it happened in your product.

Send anything that matters (payments, plans, trials) from the backend. Use the tracker
only for page-level behaviour.

`matched: false` does not mean orphaned: it is also false when a new lead was just
created. `leadId` and `contactId` both null means waiting for `/identify`.

## Step 3: identity

`POST /api/v1/ingest/identify` when a visitor signs up or signs in, with any of
`user_id`, `traits.email`, `traits.phone`, `anonymous_id`.

With the `anonymous_id`, every earlier anonymous event is attached to the person;
`backfilled` is the count. Traits fill empty lead fields and never overwrite what a person
typed in the CRM.

## Step 4: tracker (optional)

```html
<script async src="https://crm-api.example.com/api/v1/ingest/t.js"
        data-crm-key="crm_pk_..."></script>
```

It tracks page views and SPA route changes, keeps an anonymous id, honours Do Not Track,
and exposes `crm.track()`, `crm.page()`, `crm.identify()`, `crm.consent()` and
`crm.reset()`. Behind a cookie banner set `data-crm-consent="false"` and call
`crm.consent(true)` on grant.

A publishable key reaches only `/events` and `/identify`, and only from the product's
allowed origins. The ingest API answers CORS for any origin; the allowed-origins list is
what locks a publishable key to the product's pages.

## Step 5: webhooks

Subscribe in the CRM (*Integrations*, *Webhooks*); the `whsec_` secret is shown once. The
CRM POSTs `{ id, event, created_at, data }` with:

- `X-CRM-Event`, `X-CRM-Delivery`
- `X-CRM-Signature: t=<unix>,v1=<hex>`: HMAC-SHA256 over `"<t>.<raw body>"`

Verify against the raw body before parsing; reject a timestamp more than 5 minutes off.
Code for TypeScript and Python is in [reference.md](reference.md).

Return 2xx quickly. A 4xx other than 408 or 429 stops retries. Anything else is retried
after 30 s, 2 min, 10 min and 1 h, then given up.

## Step 6: actions (optional)

The CRM shows buttons on a record and POSTs to the product's `actions_url`, signed like a
webhook with the actions secret and `X-CRM-Event: action.<key>`. Body:
`{ id, action, requested_at, params, subject }`. Reply `{ ok, message, data? }`; the
`message` is shown to the agent as written.

`subject` is resolved by the CRM from the record. Treat it as the only identity to act on.
In this release the action catalogue cannot be set through the API or UI, so confirm with
the CRM operator before building this step.

## Verify before calling it done

```bash
curl -s "$CRM_API_URL/api/v1/ingest/health" -H "Authorization: Bearer $CRM_SECRET_KEY"
```

`health` is `OK` once events flow (`PENDING` means nothing arrived yet). Check
`catalog.products`, `events_24h` and every entry in `warnings[]`; each names its fix,
including orphan events and event names awaiting review. Then open a lead in the CRM and
check its product panel and timeline.

## Rules worth repeating

- Minor units everywhere: `amount_minor`, `value_minor`. Never a float.
- Never put a secret key in a URL or in browser code. In a query string it is refused.
- Always send `idempotency_key`.
- One key, one product: never name your product in a payload.
- Limits per key per minute: 120 lead submissions, 120 events, 30 catalog syncs; browser
  (publishable) calls also 240 per key and visitor IP. Batch.
- Event categories are exactly `PAGE`, `ACTION`, `LIFECYCLE`, `COMMERCE`, `SUPPORT`.
