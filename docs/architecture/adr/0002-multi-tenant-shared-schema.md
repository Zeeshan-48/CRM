# ADR 0002: Many tenants in one shared schema

## Status

Accepted.

## Context

Euron Open CRM is run by an operator who sells workspaces to many organisations (in the
demo, Northwind Academy and Acme Robotics). Each workspace needs its own users, roles,
leads, conversations, provider credentials and settings, with no way to see another's.
The operator needs one place to onboard tenants, sell plans and bill them, and one
deployment to upgrade.

The options are a database per tenant, a Postgres schema per tenant, or one shared schema
with a tenant column.

## Decision

- One Postgres database and one schema for all tenants. Every tenant-owned table has a
  required `tenant_id` with a foreign key to `tenants` and `onDelete: Cascade`; indexes and
  natural unique keys lead with `tenant_id` ([`apps/api/prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma)).
  Platform tables (`tenants`, `plans`, `operator_users`, `plan_gateway_refs`,
  `platform_webhook_events`) have none.
- The tenant of a request comes only from its credential: the tenant JWT (re-checked
  against `users.tenant_id` on every request), an ingest API key, or a per-tenant webhook
  token ([`apps/api/src/middlewares/auth.middleware.ts`](../../../apps/api/src/middlewares/auth.middleware.ts),
  [`apps/api/src/middlewares/api-key.middleware.ts`](../../../apps/api/src/middlewares/api-key.middleware.ts)).
  Never from a path or body parameter.
- Every repository method that touches tenant data takes `tenantId` and puts it in the
  `WHERE` clause. Another tenant's row answers `404`, the same as a missing one.
- The operator plane (`/api/v1/operator/*`) is a separate router with its own user table
  and token type, in the same process.

Details: [multi-tenancy-and-entitlements.md](../multi-tenancy-and-entitlements.md).

## Consequences

Positive:

- One migration run, one connection pool per worker, one backup, whatever the number of
  tenants. Onboarding is a handful of inserts in one transaction.
- Operator views across tenants (usage, billing metrics, audit) are plain queries.
- Deleting a tenant is one `DELETE` that cascades.

Trade-offs:

- Isolation rests on application code. A repository query that forgets `tenant_id` leaks
  data; there is no row-level security behind it. The API suites test cross-tenant access
  with a second seeded tenant, but they cannot prove every query.
- One noisy tenant shares the database with everyone. Per-IP rate limits and per-tenant
  email throttles soften this; there are no per-tenant database quotas.
- A tenant cannot be moved to its own database or region without an export tool, which
  does not exist.

## Alternatives considered

- **A database per tenant.** Strong isolation, but onboarding becomes provisioning,
  migrations run N times, and cross-tenant operator views need a fan-out.
- **A schema per tenant.** The same migration fan-out, plus search-path handling in every
  connection, for isolation that is still logical rather than physical.
- **Postgres row-level security on top of the shared schema.** A good second line of
  defence; not done yet because every query would need a per-transaction tenant setting
  and the jobs that sweep all tenants would need a bypass role.
