# Contributing

Thanks for helping improve Euron Open CRM. This guide covers the workflow, the bar a change
has to clear, and the conventions the codebase follows.

## Ground rules

- **Open an issue first** for anything larger than a bug fix or a docs tweak, so we can
  agree on the approach before you invest time.
- **One concern per pull request.** A refactor and a feature are two PRs.
- **Security issues go through private reporting**, never a public issue. See
  [SECURITY.md](SECURITY.md).
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Development setup

Requirements: Docker, Node 22+, pnpm 9 (`corepack enable`).

```bash
pnpm install
make up          # Postgres, Redis, the AWS emulator (provisioned by Terraform),
                 # then migrate, the API, the workspace app and the operator console
make demo        # two fictional workspaces full of data, and an operator
make test        # unit tests across every package (no database)
```

The workspace app is at http://localhost:3570, the operator console at
http://localhost:3580 and the API at http://localhost:5066. No provider account is
needed: email, WhatsApp, telephony and payments run in their simulated modes and AI uses
the offline provider. [docs/guides/quickstart-local.md](docs/guides/quickstart-local.md)
lists every port, and [docs/guides/connect-providers.md](docs/guides/connect-providers.md)
explains how to connect real ones.

## Before you open a pull request

Each of these must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
make test-integration            # the API over HTTP against a migrated, seeded Postgres
make tf-validate tf-lint tf-security   # when you touched infra/terraform
make sanitize                    # no credentials, account ids, real emails or IPs
```

[docs/guides/testing.md](docs/guides/testing.md) explains each test layer.

## Conventions

**Layers (api).** Routes declare endpoints and guards, controllers read the request and
write the response, services hold the business rules, repositories hold the Kysely
queries. Services and repositories are singletons; repositories accept an optional
transaction. Recurring work is one entry in `apps/api/src/jobs/registry.ts`
([LLD.md](docs/architecture/LLD.md)).

**Every tenant query carries `tenant_id`.** A record from another workspace is a 404, never
a 403. A new endpoint that returns workspace data gets an integration test proving the
other seeded workspace cannot read it.

**Entitlements first.** A module route is mounted once in `apps/api/src/routes/index.ts`
behind the entitlement gate and then RBAC. Runtime code reads `tenant_entitlements`, never
a plan ([multi-tenancy-and-entitlements.md](docs/architecture/multi-tenancy-and-entitlements.md)).

**Credentials are write-only.** Tenant provider credentials are encrypted with
`CREDENTIALS_ENCRYPTION_KEY` and returned only as a hint (last four). Never add a secret to
a response, a log line or an audit payload.

**Simulated modes stay honest.** Every external provider has a simulated mode so the app
and the test suite run without accounts. A new provider gets one too, and responses say
when something was simulated.

**Money.** Catalogue prices are integer minor units; invoices and deal values are major
units, converted in one place (`apps/api/src/utils/money.ts`).

**Configuration lives in one file.** Every environment variable is read in
`apps/api/src/config/index.ts` and nowhere else, documented in
[docs/guides/configuration.md](docs/guides/configuration.md) in the same PR, and
security-relevant ones are enforced at boot by `assertProductionConfig`.

**Database changes are new migrations.** Change `apps/api/prisma/schema.prisma`, run
`pnpm --filter @open-crm/api gen:types` to regenerate the Kysely types, and add
`db/migrations/NNNN_description.sql` with the matching SQL. Prisma never touches a
database. Never edit an applied migration: the runner refuses to start when a checksum
changes.

**Comments explain why.** The code says what it does. Comments are for the constraint, the
incident, or the trade-off that made it this way.

**Style.** Prettier and ESLint settle formatting. TypeScript strict mode everywhere.

## Commit messages

Imperative mood with an optional scope: `ingest: accept unknown events as NEEDS_REVIEW`,
`web: keep the pipeline filter when a deal moves`. Explain the *why* in the body when it is
not obvious.

## Architecture decisions

A change that alters a documented decision (multi-tenancy, entitlements, SQL migrations,
encrypted provider credentials, simulated providers, the event model, catalogue money)
needs a new or updated ADR in [docs/architecture/adr/](docs/architecture/adr/README.md)
explaining the trade-off, linked from the pull request.
