# ADR 0008: Catalog money in minor units, one conversion point

## Status

Accepted.

## Context

Connected products publish prices and send revenue on events. Payment providers and most
billing systems speak minor units (paise, cents). The older CRM columns (`deals.value`,
`invoices.amount`) store whole major units as integers. A producer that
sends `4999` leaves the receiver guessing between 49.99 and 4,999.00, and the wrong guess
misprices a product by a factor of 100 while an agent is quoting it to a customer.

## Decision

- Every catalog amount is an integer in minor units: `product_prices.amount_minor` and
  `compare_at_minor`, `product_offers.discount_value` for `FLAT` offers,
  `deal_line_items.unit_price_minor`, `discount_minor`, `total_minor`,
  `activity_events.value_minor`, `engagement_profiles.mrr_minor`
  ([`apps/api/prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma)).
- The ingest contract has no `amount` field. A price that carries `amount` or `price` but
  no `amount_minor` is refused with a `400` that names the field and gives an example
  ([`services/catalog-mapping.ts`](../../../apps/api/src/services/catalog-mapping.ts),
  [`validators/products.schema.ts`](../../../apps/api/src/validators/products.schema.ts)).
- The exponent per currency comes from a small ISO 4217 table, defaulting to 2
  ([`utils/money.ts`](../../../apps/api/src/utils/money.ts)).
- Catalog money crosses into the major-unit columns in exactly one place:
  `minorToMajor`, called when deal line items set `deals.value`
  ([`services/deal-line-items.service.ts`](../../../apps/api/src/services/deal-line-items.service.ts)).
  It rounds half up.
- The SDK names the fields `amountMinor` and `compareAtMinor` and has no `amount`
  ([`packages/sdk/src/index.ts`](../../../packages/sdk/src/index.ts)).

## Consequences

Positive:

- A 100x mispricing cannot be sent by accident; the error says what to send instead.
- Sub-unit precision is exact for every currency, including zero- and three-decimal ones.
- The rounding between the two worlds is in one function, so it is easy to find and test.

Trade-offs:

- Two money conventions live in one schema. Anyone reading `deals.value` next to
  `deal_line_items.total_minor` has to know which is which.
- `deals.value` derived from line items is rounded to whole major units, so a deal of
  1999.50 is recorded as 2000.
- `deals.value` takes the first line item's currency and sums the totals without
  conversion; mixed-currency line items on one deal are not handled.

## Alternatives considered

- **Major units with decimals (`numeric`) everywhere.** Matches the older columns, but
  every integrating product would convert on the way in, and the ambiguity of a bare
  number in the payload remains.
- **Migrate the older columns to minor units now.** Removes the seam but touches every
  pipeline, invoice and report; left as a later migration.
