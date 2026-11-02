# Quickstart: run the CRM locally

Start Euron Open CRM on your machine, seed two demo workspaces and an operator, and sign
in. No cloud account, no provider key and no payment account are needed. Paths are relative
to the repository root.

What runs ([`deploy/compose`](../../deploy/compose)): Postgres 16, Redis 7, the Floci AWS
emulator (S3, SES, SQS, SNS, KMS) provisioned by the production Terraform modules, Mailpit
(catches every email SES sends), then a one-shot `migrate`, the `api`, and the two
single-page apps: `web` (the workspace app) and `console` (the operator console).

## Prerequisites

- Docker with Compose v2 (Docker Desktop, OrbStack, Colima or plain Docker Engine).
- `make`, `bash` and `openssl` (used by [`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)).
- For the tests and for running the apps outside Docker: Node 22 ([`.nvmrc`](../../.nvmrc))
  and pnpm 9 (`packageManager` in [`package.json`](../../package.json); `corepack enable`).

```bash
pnpm install
```

`make up` itself only needs Docker: the images install their own dependencies.

## Start the stack

```bash
make env      # optional: make up runs it too
make up
```

`make env` writes `deploy/compose/.env` with three random, local-only values:
`CRM_JWT_SECRET`, `CRM_CREDENTIALS_ENCRYPTION_KEY` and `CRM_DEMO_PASSWORD`. It never
overwrites a value and never prints one; an existing file only gains keys added since it was
written. Delete the file to regenerate it.

`make up` builds the images, starts Floci and Mailpit, runs the `terraform` one-shot that
applies [`infra/terraform/envs/local-floci`](../../infra/terraform/envs/local-floci/main.tf)
against the emulator, runs the migrations, starts the API and both apps, and waits until every
service is healthy (`docker compose up -d --build --wait`). The first build takes a few
minutes. It prints:

```
  app      http://localhost:3570
  console  http://localhost:3580  (operator console)
  api      http://localhost:5066/api/health
  mail     http://localhost:8086  (everything SES sends)
  aws      http://localhost:4637  (Floci: S3, SES, SQS, SNS, KMS)
```

`curl -s localhost:5066/api/health` answers `{"ok":true,"service":"open-crm-api",...}`.

## Ports

Every host port binds to `127.0.0.1` and can be moved in `deploy/compose/.env` (or your
shell), from [`compose.yaml`](../../deploy/compose/compose.yaml) and
[`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml):

| Service | Host port | Variable |
| --- | --- | --- |
| Workspace app (`apps/web`) | 3570 | `CRM_WEB_PORT` |
| Operator console (`apps/console`) | 3580 | `CRM_CONSOLE_PORT` |
| API | 5066 | `CRM_API_PORT` |
| Postgres (user, password and database `crm`) | 5532 | `CRM_PG_PORT` |
| Redis | 6469 | `CRM_REDIS_PORT` |
| Floci | 4637 | `CRM_FLOCI_PORT` |
| Mailpit web UI | 8086 | `CRM_MAILPIT_PORT` |

The two apps are static builds on nginx that call the API directly at
`http://localhost:<CRM_API_PORT>/api/v1` (the console at `/api/v1/operator`). That URL is
compiled in at image build time, and the API's `CORS_ORIGINS`, `CRM_APP_URL`,
`OPERATOR_APP_URL` and `APP_PUBLIC_URL` follow the same port variables, so after changing a
port run `make up` again to rebuild.

## Seed the demo

```bash
make demo
```

This runs `node dist-scripts/scripts/seed.js` inside the API container
([`apps/api/scripts/seed.ts`](../../apps/api/scripts/seed.ts)) with `DEMO_PASSWORD` set to
`CRM_DEMO_PASSWORD` from `deploy/compose/.env`. It creates three plans (Starter, Growth,
Enterprise), an operator, and two fictional workspaces full of leads, deals, conversations,
campaigns, tickets, workflows, invoices and product activity. When the database already has
tenants it does nothing; `make demo FORCE=1` wipes the CRM data and reseeds. The seed refuses
to run with `NODE_ENV=production`.

| Account | Signs in to | Role |
| --- | --- | --- |
| `maya@northwind.example.com` | Workspace app, http://localhost:3570 | ADMIN of Northwind Academy (ENTERPRISE plan) |
| `arjun@acme.example.com` | Workspace app, http://localhost:3570 | ADMIN of Acme Robotics (GROWTH plan) |
| `root@example.com` | Operator console, http://localhost:3580 | SUPERADMIN operator |

Every demo account, including the managers and agents listed in
[walkthrough.md](walkthrough.md#who-is-in-the-demo), signs in with `CRM_DEMO_PASSWORD`:

```bash
grep '^CRM_DEMO_PASSWORD=' deploy/compose/.env
```

[walkthrough.md](walkthrough.md) tours every page with this data.

## What is simulated

Nothing leaves your machine. [`compose.yaml`](../../deploy/compose/compose.yaml) sets every
provider switch to `true` by default: `WHATSAPP_SIMULATE`, `TELEPHONY_SIMULATE`,
`EXOTEL_SIMULATE`, `RAZORPAY_SIMULATE`, `STRIPE_SIMULATE` and `BILLING_SIMULATE`.
WhatsApp sends and calls get fake ids, payment links and
platform subscriptions are canned, and AI answers come from the deterministic offline engine
because no AI key is set
([ADR 0006](../architecture/adr/0006-simulated-providers-for-local-and-tests.md)).

| Concern | Local behaviour |
| --- | --- |
| Email | Real SES API calls against Floci, which relays every message to Mailpit: open http://localhost:8086 for invites, password resets, campaign mail and reminders |
| SES delivery events | Per-tenant configuration sets publish to the emulated SNS topic; the API long-polls the SQS queue behind it |
| Files | Local disk inside the `files` volume, served through HMAC-signed links that expire. The emulated bucket `open-crm-local-files` exists too: set `AWS_S3_BUCKET=open-crm-local-files` in `deploy/compose/.env` to use it (browser downloads then need the notes in [`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)) |
| Redis | A plain container (the BullMQ job scheduler, rate limits, caches) |

To try a real provider account, set its keys in `deploy/compose/.env` and turn its switch off;
every key in that file reaches the API container. See [connect-providers.md](connect-providers.md).

## Stop and reset

```bash
make ps                   # status of every service
make logs SERVICE=api     # tail one service: api, web, console, migrate, floci, terraform, mailpit, postgres, redis
make down                 # stop everything and delete the volumes (database, Redis, files, emulator state)
```

`deploy/compose/.env` survives `make down`, so the next `make up` keeps the same secrets and
demo password. Delete it to generate new ones. Because `make down` deletes the database,
run `make demo` again after the next `make up`.

`make up` without the emulator is not a target, but [`compose.yaml`](../../deploy/compose/compose.yaml)
runs on its own: files on local disk, email simulated (no `AWS_SES_FROM_EMAIL`), the SES
consumers idle.

## Run the apps outside Docker

For hot reload, run Postgres and Redis from compose and the API and both apps from source.
Compose refuses to start until `deploy/compose/.env` exists, so run `make env` first. If the
full stack from `make up` is running, its API holds port 5066 and its apps hold 3570 and
3580: run `make down` before you start.

```bash
pnpm install
make env
docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml up -d --wait postgres redis

cp apps/api/.env.example apps/api/.env          # points at localhost:5532 and localhost:6469
cp apps/web/.env.example apps/web/.env          # VITE_API_BASE_URL=http://localhost:5066/api/v1
cp apps/console/.env.example apps/console/.env  # VITE_API_BASE_URL=http://localhost:5066/api/v1/operator

DATABASE_URL=postgres://crm:crm@localhost:5532/crm pnpm db:migrate
pnpm demo:seed
pnpm dev
```

- `pnpm db:migrate` runs [`db/migrate.ts`](../../db/migrate.ts) from the repository root, so it
  does not read `apps/api/.env`: pass `DATABASE_URL` (or the `PG_DATABASE_*` variables) in the
  shell.
- `pnpm demo:seed` runs in `apps/api` and reads `apps/api/.env`. Without `DEMO_PASSWORD` the
  accounts get the fixed fallback passwords (`admin123` for the workspace admins,
  `operator123` for `root@example.com`, see [walkthrough.md](walkthrough.md#who-is-in-the-demo));
  set `DEMO_PASSWORD=<choose-one>` to use your own.
- `pnpm dev` runs `turbo run dev --parallel`: the API with `tsx watch src/index.ts` on
  `:5066`, the workspace app with Vite on `:3570` and the console on `:3580`
  ([`apps/web/vite.config.ts`](../../apps/web/vite.config.ts),
  [`apps/console/vite.config.ts`](../../apps/console/vite.config.ts)). One at a time:
  `pnpm --filter @open-crm/api dev`, `pnpm --filter @open-crm/web dev`,
  `pnpm --filter @open-crm/console dev`.

Differences from the Docker stack, all from [`apps/api/.env.example`](../../apps/api/.env.example):

- The `*_SIMULATE` switches are `false` there, except `BILLING_SIMULATE=true`. With blank keys
  and a switch off, that channel refuses or records sends as not delivered instead of faking
  them; set `WHATSAPP_SIMULATE=true`, `TELEPHONY_SIMULATE=true`, `EXOTEL_SIMULATE=true`,
  `RAZORPAY_SIMULATE=true` and `STRIPE_SIMULATE=true` for the same demo experience as Docker
  ([connect-providers.md](connect-providers.md#simulate-switches)).
- `AWS_SES_FROM_EMAIL` is blank, so email is simulated (recorded, not sent) and Mailpit sees
  nothing.
- `AWS_S3_BUCKET` is blank, so files go to `apps/api/.local-storage`.
- `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` are blank, so the development defaults apply. That
  is fine with `NODE_ENV=development`; production refuses them
  ([configuration.md](configuration.md#the-production-guard)).

## First-run problems

| Symptom | Where to look |
| --- | --- |
| `make up` fails with "port is already allocated" | [troubleshooting.md](troubleshooting.md#a-port-is-already-in-use) |
| `run \`make env\` first` from compose | `deploy/compose/.env` is missing; run `make env` |
| `make demo` prints "database already seeded" | Expected on a second run; `make demo FORCE=1` wipes and reseeds |
| Sign-in works but a page shows a CORS error in the browser console | [troubleshooting.md](troubleshooting.md#cors-errors-in-the-browser) |
| No email in Mailpit | [troubleshooting.md](troubleshooting.md#emails-do-not-arrive) |
| `changed after it was applied` from `migrate` | [troubleshooting.md](troubleshooting.md#migrate-fails-changed-after-it-was-applied) |

## Next

- Every setting: [configuration.md](configuration.md).
- Real email, WhatsApp, telephony, payments, calendar and AI: [connect-providers.md](connect-providers.md).
- Run the tests: [testing.md](testing.md).
- Deploy it: [deploy-aws.md](deploy-aws.md).
