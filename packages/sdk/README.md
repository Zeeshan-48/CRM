# @open-crm/sdk

Server-side SDK for connecting a product to Euron Open CRM: lead capture, identity,
behavioural events and catalog sync. It wraps the ingest API (`/api/v1/ingest`) so a
product does not have to reimplement idempotency keys, batching, retries or the
minor-unit money rules.

- Zero dependencies. Node 18 or later (global `fetch`). ES module.
- Source: [`src/index.ts`](src/index.ts). The full integration guide is
  [docs/guides/integrate-your-product.md](../../docs/guides/integrate-your-product.md).
- For the browser, use the tracker served at `/api/v1/ingest/t.js`, not this package.

## Install

The package lives in this workspace and is not published to a registry by this
repository. Build it and depend on it from the workspace, or publish it yourself:

```bash
pnpm --filter @open-crm/sdk build   # writes dist/
```

## Configure

```ts
import { OpenCRM } from "@open-crm/sdk";

const crm = new OpenCRM({
  apiKey: process.env.CRM_SECRET_KEY!,                    // a secret key, crm_sk_...
  baseUrl: "https://crm-api.example.com/api/v1/ingest",   // your deployment
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `apiKey` | required | A secret key (`crm_sk_`). A publishable key (`crm_pk_`) throws in the constructor |
| `baseUrl` | `https://crm.example.com/api/v1/ingest` | The ingest base URL. The default is a placeholder: always set it |
| `timeoutMs` | `10000` | Per-request timeout |
| `retries` | `2` | Extra attempts after a network failure, a 5xx or a 429 (backoff 250 ms, doubling) |
| `onError` | logs a warning | Called when a non-throwing method gives up: `(error, { path, attempt })` |

A 4xx other than 429 is never retried: the payload is wrong, and resending it would not
help. Requests carry `Authorization: Bearer <key>` and `User-Agent: open-crm-sdk/0.1`.

## Methods

| Method | Endpoint | Throws | Returns |
| --- | --- | --- | --- |
| `identify(input)` | `POST /identify` | never | The person and `backfilled`, or `null` on failure |
| `track(input)` | `POST /events` | never | `{ eventId, leadId, ... }`, or `null` on failure |
| `trackBatch(inputs)` | `POST /events/batch` | never | `{ recorded, rejected }` summed over chunks of 500 |
| `captureLead(input)` | `POST /leads` | yes | `{ leadId, deduped, ... }` |
| `syncCatalog(products, mode?)` | `PUT /catalog` | yes | `{ created, updated, archived, ... }` |
| `syncOffers(offers)` | `PUT /catalog/offers` | yes | `{ created, updated, skipped, ... }` |
| `health()` | `GET /health` | yes | `HealthReport` |

`identify`, `track` and `trackBatch` never throw, so analytics cannot break the request
that produced them; failures go to `onError`. In `trackBatch`, a chunk that fails entirely
is counted as rejected. The other methods throw `OpenCRMError` (with `status` and `body`)
on an API error, because a dropped lead or a failed catalog sync needs handling.

The SDK returns the envelope's `data` as the API sends it. The response field lists above
are summaries; see [the guide](../../docs/guides/integrate-your-product.md) for each
shape.

### Identity and events

```ts
await crm.identify({
  userId: "usr_8842",
  anonymousId: "a_3f1c...", // from the browser tracker, if you have it
  traits: { email: "priya@acme.example.com", name: "Priya Sharma", plan: "Team Plan" },
});

await crm.track({
  event: "checkout.completed",          // dotted lower case; unknown names are accepted
  identity: { userId: "usr_8842", email: "priya@acme.example.com" },
  properties: { value: 999900, currency: "INR" }, // MINOR units
  product: { externalId: "plan_team" },
  idempotencyKey: "order_5521",         // generated when omitted; pass your own
  occurredAt: new Date(),               // defaults to now
  context: { sessionId: "s_01", pageUrl: "https://app.acme.example.com/billing" },
});
```

`Identity` takes `userId`, `email`, `phone` and `anonymousId`. Pass your own
`idempotencyKey` (an order id, a webhook event id) so a redelivery is a no-op rather than a
double count.

### Leads

```ts
const { leadId, deduped } = await crm.captureLead({
  name: "Priya Sharma",
  email: "priya@acme.example.com",
  company: "Acme Robotics",
  source: "Pricing page",
  externalId: "form_123", // idempotent across retries
});
```

### Catalog

```ts
await crm.syncCatalog(
  [
    {
      externalId: "plan_team",
      name: "Team Plan",
      category: "Subscription",
      highlights: ["25 seats", "Automation", "Priority support"],
      prices: [{ currency: "INR", amountMinor: 999900, billingPeriod: "MONTHLY", isDefault: true }],
    },
  ],
  "REPLACE", // archives your products missing from this call; default "UPSERT"
);

await crm.syncOffers([
  { code: "SAVE20", name: "20% off this month", discountType: "PERCENT", discountValue: 20 },
]);
```

Prices are `amountMinor` and `compareAtMinor`; there is no `amount` field
([ADR 0008](../../docs/architecture/adr/0008-minor-units-for-catalog-money.md)). Send at
most 500 products per `syncCatalog` call.

### Health

```ts
const report = await crm.health();
if (report.warnings.length) console.warn(report.warnings);
```

## Exports

`OpenCRM` (also the default export), `OpenCRMError`, and the types `OpenCRMOptions`,
`Identity`, `IdentifyInput`, `TrackInput`, `LeadInput`, `CatalogPrice`, `CatalogProduct`,
`CatalogOffer`, `HealthReport`.
