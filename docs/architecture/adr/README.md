# Architecture decision records

Short records of the decisions that shape Euron Open CRM: the context, what was decided, and
what it costs. The system as built is described in [HLD.md](../HLD.md) and [LLD.md](../LLD.md).

| ADR | Decision |
| --- | --- |
| [0001](0001-monorepo-and-spa.md) | One pnpm and Turborepo monorepo: one Express API for all three planes, two React SPAs, a server SDK |
| [0002](0002-multi-tenant-shared-schema.md) | Many tenants in one database and one schema, isolated by `tenant_id` |
| [0003](0003-entitlements-first.md) | Plans are snapshotted into per-tenant entitlements; the runtime reads only entitlements |
| [0004](0004-sql-migrations-prisma-types-only.md) | Plain SQL migrations with a small runner; Prisma only generates Kysely types |
| [0005](0005-byo-provider-credentials-encrypted.md) | Tenants bring their own provider accounts; secrets are encrypted at rest and never returned |
| [0006](0006-simulated-providers-for-local-and-tests.md) | Every provider has a simulated mode, so the product runs and is tested with no accounts |
| [0007](0007-unknown-events-accepted.md) | An unknown product event is accepted and registered for review, not rejected |
| [0008](0008-minor-units-for-catalog-money.md) | Catalog money is integer minor units; a bare `amount` is refused |
