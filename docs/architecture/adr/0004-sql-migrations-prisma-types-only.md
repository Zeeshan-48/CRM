# ADR 0004: SQL migrations, Prisma for types only

## Status

Accepted.

## Context

The runtime uses Kysely for every query: it is typed, close to SQL, and has no runtime engine.
Kysely needs TypeScript types for the schema. Prisma's schema language is a convenient way to
write and review the schema and `prisma-kysely` turns it into Kysely types, but letting Prisma
own the database (`db push`, `migrate dev`) would mean a second runtime dependency during
deploys, migrations that can be generated against the wrong database, and partial indexes or
other DDL that Prisma cannot express being dropped silently.

## Decision

- [`apps/api/prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma) is the readable
  definition of the schema. Its only generator is `prisma-kysely`, which writes
  [`apps/api/src/db/types.ts`](../../../apps/api/src/db/types.ts) and
  [`enums.ts`](../../../apps/api/src/db/enums.ts) (`pnpm --filter @open-crm/api gen:types`).
- What is applied to a database is plain SQL in [`db/migrations`](../../../db/migrations),
  starting with [`0001_init.sql`](../../../db/migrations/0001_init.sql).
- [`db/migrate.ts`](../../../db/migrate.ts) (`pnpm db:migrate`, `--status` to list) applies
  every `NNNN_*.sql` file not yet in `schema_migrations`, in order, each in its own transaction,
  under a Postgres advisory lock so concurrent deploys are safe. It stores a SHA-256 of each
  applied file and refuses to continue if an applied file has changed.
- Migrations are forward only. A change is a new file.
- No Prisma client is used at runtime, and no Prisma command touches a database.

## Consequences

Positive:

- Deploys need only Node and `pg` to migrate; the runner is about a hundred lines.
- Every schema change is a reviewable SQL file, including DDL Prisma cannot express.
- Edited history is caught by the checksum instead of silently diverging between environments.

Trade-offs:

- The Prisma schema and the SQL must be kept in step by hand. A change made only in
  `schema.prisma` changes the types but not the database, and the type checker will not notice.
- There are no down migrations; rolling back is a new forward migration or a restore.
- The mock-database tests use their own schema subset ([`tests/mock-schema.ts`](../../../apps/api/tests/mock-schema.ts)),
  regenerated from a migrated database by [`scripts/gen-mock-schema.ts`](../../../apps/api/scripts/gen-mock-schema.ts).

## Alternatives considered

- **Prisma Migrate.** Generates SQL too, but pulls the Prisma engine into deploys and its
  shadow-database step needs care to never point at a real database.
- **Kysely's migrator.** Migrations in TypeScript; fine, but SQL files are easier to review and
  to run by hand in an emergency.
