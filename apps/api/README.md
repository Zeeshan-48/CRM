# @open-crm/api

The Euron Open CRM API: one Express 5 service that serves the tenant plane (`/api/v1`), the
operator plane (`/api/v1/operator`), product ingest (`/api/v1/ingest`) and provider webhooks,
and runs the background jobs. PostgreSQL through Kysely, optional Redis, Node cluster mode.

Architecture: [docs/architecture/HLD.md](../../docs/architecture/HLD.md) and
[LLD.md](../../docs/architecture/LLD.md).

## Run it

From the repository root, with Postgres reachable on the `PG_DATABASE_*` settings in
`apps/api/.env` (copy [`.env.example`](.env.example)):

```bash
pnpm install
pnpm db:migrate          # apply db/migrations; runs from the root, so it reads DATABASE_URL
                         # (or PG_DATABASE_*) from the shell or a root .env, not apps/api/.env
pnpm demo:seed           # Northwind Academy and Acme Robotics demo data
pnpm --filter @open-crm/api dev    # http://localhost:5066
```

Health: `GET /up` (plain `OK`) and `GET /api/health` (JSON). Every provider is optional: blank
keys keep that channel simulated ([connect-providers.md](../../docs/guides/connect-providers.md)).
A tour of the seeded data: [walkthrough.md](../../docs/guides/walkthrough.md).

## Scripts

| Script | Does |
| --- | --- |
| `pnpm dev` | `tsx watch src/index.ts` |
| `pnpm build`, `pnpm start` | Compile to `dist/`, run `dist/index.js` |
| `pnpm lint`, `pnpm typecheck` | ESLint; `tsc` over `src` and `scripts` |
| `pnpm test` | Unit and mock-database tests, no database needed |
| `pnpm test:integration` | `tests/api` and `tests/operator` against a migrated and seeded Postgres ([tests/README.md](tests/README.md)) |
| `pnpm gen:types` | `prisma generate`: regenerate the Kysely types in `src/db` from `prisma/schema.prisma` |
| `pnpm gen:mock-schema` | Regenerate `tests/mock-schema.ts` from a migrated database |
| `pnpm demo:seed` | Seed the demo data ([`scripts/seed.ts`](scripts/seed.ts)) |

Prisma never touches a database: migrations are plain SQL in
[`db/migrations`](../../db/migrations) ([ADR 0004](../../docs/architecture/adr/0004-sql-migrations-prisma-types-only.md)).

## Layout

| Path | Contents |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Cluster entry: forks workers, one owns the jobs, graceful shutdown |
| [`src/app.ts`](src/app.ts) | Middleware order, webhook mounts, the three planes |
| [`src/config/index.ts`](src/config/index.ts) | Every environment variable and the production guard |
| [`src/routes`](src/routes) | [`index.ts`](src/routes/index.ts) is the tenant gating map; `operator/` is the operator plane |
| [`src/controllers`](src/controllers), [`src/services`](src/services), [`src/repositories`](src/repositories) | Thin controllers, business services, Kysely repositories |
| [`src/middlewares`](src/middlewares) | Auth (tenant, operator, API key), module gate, rate limits, validation, errors |
| [`src/services/ai`](src/services/ai) | AI provider seam, offline heuristics, copilot tools |
| [`src/jobs`](src/jobs) | Scheduled sweeps ([`registry.ts`](src/jobs/registry.ts)) and the SES SQS consumers |
| [`src/constants`](src/constants) | Module keys, built-in roles, entitlement codes, event names |
| [`src/db`](src/db) | Pool, generated types, Redis client |
| [`prisma/schema.prisma`](prisma/schema.prisma) | Schema source for type generation |
| [`scripts`](scripts) | Seeds, mock-schema generator, SES infrastructure setup |
| [`tests`](tests) | Unit, mock-database and integration tests |

## Further reading

| Topic | Page |
| --- | --- |
| Tenancy and entitlements | [multi-tenancy-and-entitlements.md](../../docs/architecture/multi-tenancy-and-entitlements.md) |
| Roles | [rbac.md](../../docs/architecture/rbac.md) |
| Every table | [data-model.md](../../docs/architecture/data-model.md) |
| Product ingest | [integrate-your-product.md](../../docs/guides/integrate-your-product.md) |
| Security and known gaps | [security.md](../../docs/architecture/security.md) |
| Testing | [testing.md](../../docs/guides/testing.md) |
