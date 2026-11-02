# Testing

Three layers in [`apps/api/tests`](../../apps/api/tests), fast to slow. Reach for the lowest
one that can prove the thing you changed. Paths are relative to the repository root.

| Layer | Folder | Command | Needs |
| --- | --- | --- | --- |
| Unit | `tests/unit`, `tests/*.test.ts` | `pnpm test` | Node only |
| Mock database | `tests/mock` | `pnpm test` (same run) | Node only; an in-memory Postgres (pg-mem) |
| Integration | `tests/api`, `tests/operator` | `make test-integration`, or `pnpm test:integration` | A local Postgres, freshly migrated and seeded |

No test calls a real provider. Under tests every channel runs simulated: SES, WhatsApp,
Twilio, Exotel, Razorpay, Stripe and platform billing all check `NODE_ENV=test` or Vitest,
and the AI provider is always the deterministic offline one, even with a key set
([ADR 0006](../architecture/adr/0006-simulated-providers-for-local-and-tests.md)).

## Unit and mock tests

```bash
pnpm test                              # every package, through turbo
pnpm --filter @open-crm/api test       # the API only
```

`apps/api`'s `test` script is `vitest run tests/unit tests/mock tests/*.test.ts`
([`apps/api/package.json`](../../apps/api/package.json)). No database, no Redis, no
network. This is the suite CI runs ([`.github/workflows/checks.yml`](../../.github/workflows/checks.yml)).
`apps/web`, `apps/console` and `packages/sdk` have no tests yet.

### tests/unit

Pure functions. Inject `now` so time-dependent logic is deterministic.

| File | Covers |
| --- | --- |
| [`catalog-mapping.test.ts`](../../apps/api/tests/unit/catalog-mapping.test.ts), [`catalog-pricing.test.ts`](../../apps/api/tests/unit/catalog-pricing.test.ts) | Mapping a product's catalog payload to rows; minor-unit money, price resolution, savings |
| [`connected-apps.test.ts`](../../apps/api/tests/unit/connected-apps.test.ts) | App key slugs, capability parsing |
| [`crypto.test.ts`](../../apps/api/tests/unit/crypto.test.ts) | `sealSecret` and `openSecret` |
| [`email-dns.test.ts`](../../apps/api/tests/unit/email-dns.test.ts), [`email-html.test.ts`](../../apps/api/tests/unit/email-html.test.ts), [`email-throttle.test.ts`](../../apps/api/tests/unit/email-throttle.test.ts), [`reputation.test.ts`](../../apps/api/tests/unit/reputation.test.ts), [`unsubscribe.test.ts`](../../apps/api/tests/unit/unsubscribe.test.ts) | Sending-domain DNS records and status, branded HTML, per-tenant send rates, reputation tiers, unsubscribe tokens |
| [`engagement-fold.test.ts`](../../apps/api/tests/unit/engagement-fold.test.ts), [`intent.test.ts`](../../apps/api/tests/unit/intent.test.ts), [`identity.test.ts`](../../apps/api/tests/unit/identity.test.ts) | Folding product events into an engagement profile, checkout abandonment, intent decay and bands, identity normalisation |
| [`ingest-openapi.test.ts`](../../apps/api/tests/unit/ingest-openapi.test.ts) | The served ingest OpenAPI document |
| [`webhook-signature.test.ts`](../../apps/api/tests/unit/webhook-signature.test.ts) | Outbound webhook signing and verification |
| [`hardening.test.ts`](../../apps/api/tests/unit/hardening.test.ts), [`http-guard.test.ts`](../../apps/api/tests/unit/http-guard.test.ts) | The production config guard, CORS, signed local file links, the SSRF guard for outbound URLs |
| [`phone.test.ts`](../../apps/api/tests/unit/phone.test.ts), [`telephony-routing.test.ts`](../../apps/api/tests/unit/telephony-routing.test.ts) | Phone normalisation, the 09:00 to 21:00 IST calling window |
| [`template.test.ts`](../../apps/api/tests/unit/template.test.ts) | Template variable filling |

The four files directly in `tests/` are unit tests too: AI heuristics
([`ai-heuristics.test.ts`](../../apps/api/tests/ai-heuristics.test.ts)), copilot retrieval and
planning ([`copilot-retrieval.test.ts`](../../apps/api/tests/copilot-retrieval.test.ts)), email
link handling ([`email-html.test.ts`](../../apps/api/tests/email-html.test.ts)) and template
variables ([`template-vars.test.ts`](../../apps/api/tests/template-vars.test.ts)).

### tests/mock

The real repositories and services run against [pg-mem](https://github.com/oguimbal/pg-mem),
an in-memory Postgres: same Kysely queries, same transactions, a private database per test.
[`tests/mock-db.ts`](../../apps/api/tests/mock-db.ts) builds it from
[`tests/mock-schema.ts`](../../apps/api/tests/mock-schema.ts) and provides seed helpers;
each test file replaces `src/db/connection` with `vi.mock` before importing the code under
test.

| File | Covers |
| --- | --- |
| [`product-repositories.test.ts`](../../apps/api/tests/mock/product-repositories.test.ts) | Connected apps, products, event definitions, identities, engagement, activity events, deal line items |
| [`product-services.test.ts`](../../apps/api/tests/mock/product-services.test.ts) | Catalog sync, products, engagement, line items, lead source attribution |

`tests/mock-schema.ts` covers only the tables the product integration code touches (the
`TABLES` list in [`scripts/gen-mock-schema.ts`](../../apps/api/scripts/gen-mock-schema.ts)).
Regenerate it after a schema change, against a migrated database named by `DATABASE_URL`
(the generator reads `information_schema` and writes nothing to the database):

```bash
pnpm --filter @open-crm/api gen:mock-schema
```

What pg-mem does not reproduce: enums are `TEXT`, there are no foreign keys, only unique
indexes are carried over, there are no partial indexes and no real concurrency. Missing
builtins are registered in `mock-db.ts`. Anything that depends on real Postgres behaviour
belongs in the integration suites.

## Integration tests

`tests/api` and `tests/operator` drive the real Express app in-process with supertest
([`tests/helpers.ts`](../../apps/api/tests/helpers.ts)) against a real Postgres. No server
is started and no background job runs: jobs start only in a cluster worker
([`apps/api/src/index.ts`](../../apps/api/src/index.ts)), and the tests import
[`src/app.ts`](../../apps/api/src/app.ts) directly.

They need a local database that is freshly migrated and seeded. They write to it, so do not
point them at a database anyone else uses.

### 1. A database

Any Postgres you control. The connection comes from `apps/api/.env`
([`apps/api/.env.example`](../../apps/api/.env.example)):

- The API, the seed and the tests read `PG_DATABASE_HOST`, `PG_DATABASE_PORT`,
  `PG_DATABASE_USER`, `PG_DATABASE_PASSWORD`, `PG_DATABASE`
  ([`apps/api/src/db/connection.ts`](../../apps/api/src/db/connection.ts)).
- The migration runner prefers `DATABASE_URL` and falls back to the same `PG_DATABASE_*`
  variables ([`db/migrate.ts`](../../db/migrate.ts)).

Keep both pointing at the same database. The example file does
(`crm:crm@localhost:5532/crm`).

### 2. Migrate and seed

```bash
pnpm db:migrate                 # applies db/migrations/*.sql
pnpm demo:seed --force          # plans, the operator, Northwind Academy and Acme Robotics
```

The seed ([`apps/api/scripts/seed.ts`](../../apps/api/scripts/seed.ts)) refuses to run with
`NODE_ENV=production`. Without `--force` it does nothing when tenants already exist; with
`--force` it deletes every tenant (cascading to all CRM data), the operator users, plans
and platform billing rows, then reseeds. It calls
[`seed-product-integration.ts`](../../apps/api/scripts/seed-product-integration.ts) for each
tenant itself; there is nothing separate to run.

Leave `DEMO_PASSWORD` unset when seeding for tests. The tests sign in with the fixed
fallback passwords, and `DEMO_PASSWORD` replaces all of them.

### 3. Run

```bash
pnpm test:integration                                         # tests/api and tests/operator
pnpm --filter @open-crm/api exec vitest run tests/api/deals.test.ts   # one file
```

`make test-integration` is the Makefile entry point for the same suites.

[`vitest.config.ts`](../../apps/api/vitest.config.ts) loads
[`tests/setup-env.ts`](../../apps/api/tests/setup-env.ts) first (it pins `TZ=UTC`,
`NODE_ENV=test`, test-only webhook secrets and a sender address), runs files one at a time
(`fileParallelism: false`) because they share the two seeded tenants, and allows 30 seconds
per test. Rate limits are off under tests
([`apps/api/src/middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts)) and Redis is not used.

### Logins the suites use

From [`tests/helpers.ts`](../../apps/api/tests/helpers.ts) and
[`tests/operator/helpers.ts`](../../apps/api/tests/operator/helpers.ts):

| Constant | Account | Role, tenant |
| --- | --- | --- |
| `NW_ADMIN` | `maya@northwind.example.com` / `admin123` | ADMIN, Northwind Academy (ENTERPRISE) |
| `NW_SALES` | `asha@northwind.example.com` / `agent123` | SALES_AGENT |
| `NW_SUPPORT` | `ravi@northwind.example.com` / `agent123` | SUPPORT_AGENT |
| `NW_MARKETING` | `meera@northwind.example.com` / `agent123` | MARKETING_AGENT |
| `NW_FINANCE` | `anil@northwind.example.com` / `agent123` | FINANCE |
| `ACME_ADMIN` | `arjun@acme.example.com` / `admin123` | ADMIN, Acme Robotics (GROWTH); used for cross-tenant and plan-gating checks |
| `ROOT_OPERATOR` | `root@example.com` / `operator123` | Operator SUPERADMIN |

### What each file covers

| File | Covers |
| --- | --- |
| [`golden-slices.test.ts`](../../apps/api/tests/api/golden-slices.test.ts) | Health, login, the tenant workspace, users and roles, a slice through each core module |
| [`lead-assignment`](../../apps/api/tests/api/lead-assignment.test.ts), [`lead-ingest`](../../apps/api/tests/api/lead-ingest.test.ts) | Assignment strategies; API-key ingest, dedup and idempotency, the spam honeypot |
| [`contacts`](../../apps/api/tests/api/contacts.test.ts), [`accounts`](../../apps/api/tests/api/accounts.test.ts) | Contacts and accounts modules |
| [`deals`](../../apps/api/tests/api/deals.test.ts) | Pipelines, the board and forecast, deal CRUD, stage moves, won and lost |
| [`activities`](../../apps/api/tests/api/activities.test.ts) | Activities and tasks, edit and delete |
| [`inbox`](../../apps/api/tests/api/inbox.test.ts), [`inbound`](../../apps/api/tests/api/inbound.test.ts) | Conversation list, detail and send; inbound ingestion and the WhatsApp webhook |
| [`whatsapp`](../../apps/api/tests/api/whatsapp.test.ts), [`whatsapp-config`](../../apps/api/tests/api/whatsapp-config.test.ts), [`whatsapp-templates-sync`](../../apps/api/tests/api/whatsapp-templates-sync.test.ts) | Templates, sends, WhatsApp campaigns, agent replies; Embedded Signup; template sync |
| [`email`](../../apps/api/tests/api/email.test.ts), [`email-domains`](../../apps/api/tests/api/email-domains.test.ts), [`email-sending`](../../apps/api/tests/api/email-sending.test.ts), [`email-events`](../../apps/api/tests/api/email-events.test.ts), [`email-reputation`](../../apps/api/tests/api/email-reputation.test.ts), [`unsubscribe`](../../apps/api/tests/api/unsubscribe.test.ts) | Templates, the AI writer, sends and metrics, RBAC; sending domains and identities; the send resolver, message log and suppressions; SES event processing; reputation transitions; public unsubscribe |
| [`campaigns`](../../apps/api/tests/api/campaigns.test.ts), [`campaign-send`](../../apps/api/tests/api/campaign-send.test.ts) | Campaign CRUD and RBAC; bulk send |
| [`tickets`](../../apps/api/tests/api/tickets.test.ts), [`kb`](../../apps/api/tests/api/kb.test.ts) | Tickets, SLA, metrics and AI resolve; articles, search and RBAC |
| [`calendar`](../../apps/api/tests/api/calendar.test.ts) | Calendar providers, meetings, the availability guard, reminders |
| [`workflows`](../../apps/api/tests/api/workflows.test.ts) | Workflow CRUD and runs |
| [`copilot`](../../apps/api/tests/api/copilot.test.ts), [`copilot-tools`](../../apps/api/tests/api/copilot-tools.test.ts), [`agents`](../../apps/api/tests/api/agents.test.ts) | The copilot, its read-only tools, the agents module |
| [`analytics`](../../apps/api/tests/api/analytics.test.ts), [`audit`](../../apps/api/tests/api/audit.test.ts) | Analytics overviews; the audit trail and compliance posture |
| [`finance`](../../apps/api/tests/api/finance.test.ts), [`razorpay-payments`](../../apps/api/tests/api/razorpay-payments.test.ts), [`stripe-payments`](../../apps/api/tests/api/stripe-payments.test.ts) | Gateways, invoices, payments, pay and refund; BYO Razorpay and Stripe config, payment links, the default gateway |
| [`telephony`](../../apps/api/tests/api/telephony.test.ts), [`exotel-config`](../../apps/api/tests/api/exotel-config.test.ts), [`exotel-webhook`](../../apps/api/tests/api/exotel-webhook.test.ts) | Twilio config and click-to-call; Exotel config, number pool, availability, click-to-call; Exotel webhook token auth, inbound routing, finalize and status callbacks |
| [`integrations`](../../apps/api/tests/api/integrations.test.ts), [`product-integration`](../../apps/api/tests/api/product-integration.test.ts) | Integration catalogue, webhooks, API keys; connected products, key scoping, catalog sync, the event pipeline |
| [`platform`](../../apps/api/tests/api/platform.test.ts), [`profile`](../../apps/api/tests/api/profile.test.ts), [`user-reset-password`](../../apps/api/tests/api/user-reset-password.test.ts) | Notifications, search, saved views, reminders; self-service profile and password; admin password reset |
| [`tenant-billing`](../../apps/api/tests/api/tenant-billing.test.ts) | The workspace's own billing endpoints |
| [`operator/operator.test.ts`](../../apps/api/tests/operator/operator.test.ts) | Operator auth, plans, tenants, onboarding |
| [`operator/billing.test.ts`](../../apps/api/tests/operator/billing.test.ts) | Upfront-payment onboarding, the Razorpay webhook lifecycle, the dunning sweep, Stripe activation (all simulated, driven by signed synthetic webhooks) |

### Rules for these suites

They share two real workspaces, so:

- Name everything you create with a per-run suffix and delete it in `afterAll`, sweeping by
  the suffix. Register created rows for cleanup before asserting on them.
- When a test depends on a setting (`tenants.config`, a `roles` row, `tenant_whatsapp`),
  snapshot it, set the state you need in `beforeAll`, and restore it in `afterAll`. A killed
  run otherwise leaves the workspace in a state that fails an unrelated file later.
- If the database has drifted, reseed with `pnpm demo:seed --force`.

[`apps/api/tests/README.md`](../../apps/api/tests/README.md) has the longer version.

## Browser tests

[`e2e/tests`](../../e2e/tests) runs Playwright against the running stack (`make up && make demo`,
then `make e2e` or `pnpm e2e`):

- `01-workspace.spec.ts`: sign-in, the dashboard, a lead created through the API appearing in
  the list and opening, the pipeline stages, a Growth workspace not seeing Enterprise modules,
  a wrong password refused.
- `02-console.spec.ts`: the operator's tenant list, a tenant's plan-snapshot entitlements, a
  workspace user refused by the console.
- `03-accessibility.spec.ts`: axe (WCAG 2 A and AA) on the sign-in pages, dashboard, leads and
  pipeline in light and dark mode and on the console; serious and critical violations fail.

[`global-setup.ts`](../../e2e/global-setup.ts) waits for the stack and signs each demo account
in once through the API, sharing the sessions with every test, because sign-in allows 10
attempts per IP every 5 minutes. Running the suite twice inside that window can still trip it.
