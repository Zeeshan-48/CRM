# Troubleshooting

Symptoms, causes and fixes, each traced to the code or configuration that produces it. Paths
are relative to the repository root.

Start with the logs: `make logs SERVICE=api` locally, the CloudWatch group
`/open-crm/<name_prefix>/api` on AWS. Every error response from the API carries a `rayId`
in its `message` (`route: ..., errorMsg: ..., rayId: ...`); search the log for it to find the
full line, and the stack for an unexpected error
([`apps/api/src/middlewares/error-handler.middleware.ts`](../../apps/api/src/middlewares/error-handler.middleware.ts)).

## Local stack

### A port is already in use

`make up` fails with `port is already allocated` or `address already in use`. The stack
publishes seven host ports on `127.0.0.1`: 3570, 3580, 5066, 5532, 6469, 4637 and 8086.

Find what holds one (`lsof -i :5066` on macOS and Linux), stop it, or move the stack's port in
`deploy/compose/.env`:

```bash
CRM_API_PORT=5067
CRM_PG_PORT=5533
```

The variables are listed in [quickstart-local.md](quickstart-local.md#ports). Run `make up`
again afterwards: the apps' API URL is compiled in at build time and the API's
`CORS_ORIGINS` follows the same variables. Two notes:

- `make test-integration` and [`scripts/test-db.sh`](../../scripts/test-db.sh) read
  `CRM_PG_PORT` and `CRM_REDIS_PORT` from the shell, not from `.env`: run
  `CRM_PG_PORT=5533 CRM_REDIS_PORT=6470 make test-integration`.
- With `pnpm dev`, the API reads `PORT` and the `PG_DATABASE_*` and `REDIS_URL` values in
  `apps/api/.env`, and Vite's ports are fixed in each app's `vite.config.ts`. A running
  `make up` stack holds 5066, 3570 and 3580; `make down` first.

### Compose says "run `make env` first"

`deploy/compose/.env` is missing, and compose requires `CRM_JWT_SECRET` and
`CRM_CREDENTIALS_ENCRYPTION_KEY` from it. Run `make env` (`make up` does it for you).

### A service never becomes healthy

`make up` waits for every service. See which one is stuck with `make ps`, then its logs:

- `terraform`: the one-shot that provisions Floci. It waits for the emulator, then applies
  [`infra/terraform/envs/local-floci`](../../infra/terraform/envs/local-floci/main.tf);
  `make logs SERVICE=terraform`. Its state lives in a volume next to the emulator's, so
  `make down` (which deletes both) and `make up` start clean.
- `migrate`: see [the next section](#migrate-fails-changed-after-it-was-applied).
- `api`: it starts after `migrate` exits 0 and Redis is healthy. A worker that cannot reach
  Postgres retries five times with backoff, then logs `Database connection failed after
  retries`.

### Migrate fails: changed after it was applied

```
0001_init.sql changed after it was applied; add a new migration instead
```

[`db/migrate.ts`](../../db/migrate.ts) stores a SHA-256 checksum of every applied file in
`schema_migrations` and refuses to continue when a file on disk no longer matches. Somebody
edited a migration that this database already ran.

- Restore the file (`git checkout -- db/migrations/<file>`) and put the change in a new,
  higher-numbered file.
- Locally only, when the data does not matter: `make down` deletes the database volume, and the
  next `make up` applies every file from scratch (then `make demo` again).

Never edit an applied migration on a shared or production database.

### `make demo` prints "database already seeded"

The seed does nothing when any tenant exists. `make demo FORCE=1` wipes every tenant (and the
operators, plans and billing rows) and reseeds. It refuses outright with
`The demo seed never runs with NODE_ENV=production`
([`apps/api/scripts/seed.ts`](../../apps/api/scripts/seed.ts)).

### The demo password does not work

Every account seeded by `make demo` uses `CRM_DEMO_PASSWORD` from `deploy/compose/.env`
(`grep '^CRM_DEMO_PASSWORD=' deploy/compose/.env`). A database seeded with `pnpm demo:seed`
and no `DEMO_PASSWORD` uses the fixed fallbacks instead (`admin123`, `manager123`,
`agent123`, `operator123`, see [walkthrough.md](walkthrough.md#who-is-in-the-demo)).
Workspace accounts sign in to the workspace app (3570), `root@example.com` to the operator
console (3580); a token for one plane is refused by the other.

## Boot and configuration

### Production refuses to boot

```
Refusing to start in production:
  - JWT_SECRET must be set to a random value of at least 32 characters
```

`assertProductionConfig` ([`apps/api/src/config/index.ts`](../../apps/api/src/config/index.ts))
stops a `NODE_ENV=production` process when `JWT_SECRET` or `CREDENTIALS_ENCRYPTION_KEY` is
unset (the development default) or shorter than 32 characters, or when `CORS_ORIGINS` is
empty. Set real values ([configuration.md](configuration.md#the-production-guard)).

The API image sets `NODE_ENV=production` by default
([`infra/docker/api.Dockerfile`](../../infra/docker/api.Dockerfile)), so `docker run` of the
image without those variables hits the guard even on a laptop. Compose sets
`NODE_ENV=development`; Terraform injects both secrets from `<name_prefix>/app`. On AWS, a
task that stops right after start with this message means the secret was edited by hand
without one of the two keys: put the full JSON back.

### CORS errors in the browser

The browser console shows `No 'Access-Control-Allow-Origin' header` for calls to the API. The
API only answers CORS for origins in `CORS_ORIGINS` ([`apps/api/src/app.ts`](../../apps/api/src/app.ts));
other origins get no CORS headers, and the browser blocks the response.

- The origin must match exactly: scheme, host and port, no path. Trailing slashes are
  stripped; `*` is ignored.
- `CORS_ORIGINS` defaults to `CRM_APP_URL,OPERATOR_APP_URL`. When you serve an app from
  another origin (a different port, a custom host, `127.0.0.1` instead of `localhost`), add it
  or change those URLs.
- Locally the compose stack derives all of them from the `CRM_*_PORT` variables; after
  changing a port, `make up` again so the API and the rebuilt apps agree.
- On AWS the apps call `/api/*` on their own host, so CORS does not come into play; it is set
  to both `https://` hosts anyway.
- Product ingest (`/api/v1/ingest/*`) answers any origin by design.

## Email, webhooks and files

### Emails do not arrive

| Where | Check |
| --- | --- |
| `pnpm dev` or compose without the Floci overlay | `AWS_SES_FROM_EMAIL` is blank, so every email is simulated: recorded, not sent. The API logs `Email domains: simulated (AWS_SES_FROM_EMAIL unset)` at boot |
| `make up` | Mail goes to Floci's SES and is relayed to Mailpit: open http://localhost:8086. Nothing leaves the machine |
| `make up-aws` and AWS | `AWS_SES_FROM_EMAIL` must be a verified SES identity (`terraform output mail_from`). In the SES sandbox only verified recipients receive mail; request production access |
| A workspace's own sending domain | It sends only once the domain is verified (`verify-domains` checks every minute); until then mail goes through the platform sender. The `health-sweep` job fails a domain whose DNS has been broken for more than 24 hours |
| Bounces and complaints | Reach the CRM only with `SES_EVENTS_QUEUE_URL` set; the API logs `SES events consumer idle (SES_EVENTS_QUEUE_URL unset)` otherwise |

The SES account suppression list (bounces and complaints) also drops mail silently: check it
in the SES console. Onboarding a tenant while email is simulated skips the welcome email; the
console says so ([operations.md](operations.md#onboarding-a-tenant)).

### WhatsApp webhooks answer 401

| Response | Cause | Fix |
| --- | --- | --- |
| `401 Webhook signing secret not configured` | The shared Embedded Signup webhook in production with no `META_APP_SECRET` | Set `META_APP_SECRET` (on AWS, in `provider_secrets` or `<name_prefix>/providers`) and roll the API |
| `401 Invalid signature` | `X-Hub-Signature-256` does not match `META_APP_SECRET` | Use the secret of the Meta app that sends the webhook |
| `403 Forbidden` on the GET verification | The `hub.verify_token` is not `META_WEBHOOK_VERIFY_TOKEN`, or the variable is blank | Enter the same token in the Meta app |

Outside production the shared webhook processes an unsigned payload with a warning instead
([`apps/api/src/controllers/wa-webhook.controller.ts`](../../apps/api/src/controllers/wa-webhook.controller.ts)).
Setup: [connect-providers.md](connect-providers.md#embedded-signup-workspaces-connect-their-own-number).

### Files answer 403 "Link expired or invalid"

With no `AWS_S3_BUCKET`, files are served from `{APP_PUBLIC_URL}/local-files/...` only through
HMAC-signed links with an expiry (one hour by default)
([`apps/api/src/services/storage.service.ts`](../../apps/api/src/services/storage.service.ts)).
The API answers 403 when:

- the link has expired: reopen the record in the app, which mints a fresh link;
- the signature does not match, for example after `JWT_SECRET` changed (the link key derives
  from it), or the URL was edited.

With a bucket, downloads are presigned S3 URLs and expire the same way, with S3's own
`AccessDenied` or `Request has expired` answer. With the Floci bucket locally, presigned links
name `http://floci:4566`, which only resolves inside the compose network; see the notes in
[`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml).

## Access and limits

### 403 "The `<module>` module is not included in this workspace's plan"

The workspace's entitlements have no enabled `module.<key>` row for that module
([`apps/api/src/services/entitlements.service.ts`](../../apps/api/src/services/entitlements.service.ts)).
The app hides modules the plan lacks, so this usually means a direct API call, or a plan
change that has not reached every worker yet.

- In the operator console, open the tenant: change its plan to one with the module, or
  override that one `module.*` row.
- Entitlements are cached for 60 seconds per worker, so a change can take up to a minute to
  apply everywhere.
- Editing the plan itself does not change existing tenants; change the tenant's plan or
  override the row ([operations.md](operations.md#changing-plans-and-entitlements)).

A 403 for a module the plan includes is the user's role instead: `You do not have access to the
<module> module` or `Your role does not allow this action`
([`apps/api/src/middlewares/module.middleware.ts`](../../apps/api/src/middlewares/module.middleware.ts),
[rbac.md](../architecture/rbac.md)).

### 403 "This workspace is suspended"

The full message is `This workspace is suspended. Contact your platform operator.` The
tenant's status is `SUSPENDED` (or `CLOSED`). It is checked on every request. An operator
reactivates it on the tenant page (**Activate**). A tenant onboarded with Razorpay or Stripe
stays suspended until its first payment, and with `BILLING_SIMULATE=true` the simulated
checkout never completes, so press **Activate** ([operations.md](operations.md#platform-billing-in-simulate-mode)).

### 429 Too many requests

The API limits per client IP (600 requests a minute across the API) and tighter on sign-in (10
attempts per IP and 5 per email in 5 minutes), password reset, public booking, ingest and the
AI endpoints ([`apps/api/src/middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts)).
A 429 carries `Retry-After`. The counters live in Redis when `REDIS_URL` is set (shared by every
task), otherwise in memory per process.

Many users hitting 429 at once usually means every request looks like it comes from one
address. The client IP is taken from `X-Forwarded-For`, trusting `TRUST_PROXY` hops:

| In front of the API | `TRUST_PROXY` |
| --- | --- |
| Nothing (compose) | `0` |
| A load balancer | `1` (the default) |
| CloudFront and a load balancer (the Terraform) | `2` |

Too low, and every user shares the proxy's address and one bucket. Too high, and a client can
choose its own address by sending `X-Forwarded-For`. `RATE_LIMIT_ENABLED=false` turns every
limiter off, for load tests only.

On AWS a 403 from CloudFront, rather than a 429 from the API, is the WAF: it blocks an IP after
3000 requests in 5 minutes, except on provider webhooks and ingest
([`infra/terraform/modules/waf/main.tf`](../../infra/terraform/modules/waf/main.tf)).

### Everyone was signed out

Tokens are signed with `JWT_SECRET` and live `JWT_EXPIRY` (12 hours by default). A new
`JWT_SECRET` invalidates every token at once; otherwise users sign in again when theirs
expires. There is no server session, so a single token cannot be revoked early: disable the
user or suspend the tenant, both checked on every request
([security.md](../architecture/security.md#2-tokens)).

### Tenant integrations stopped working after a redeploy

Twilio, Exotel, WhatsApp, payment and calendar connections all fail to decrypt when
`CREDENTIALS_ENCRYPTION_KEY` changed. Put the old key back: there is no re-encryption tool, so a
new key means every workspace re-enters its credentials
([operations.md](operations.md#secret-rotation)).

## Tests

### Integration tests fail

`tests/api` and `tests/operator` sign in as the seeded demo users with the fixed fallback
passwords, and share the two seeded workspaces ([testing.md](testing.md#integration-tests)).

| Symptom | Fix |
| --- | --- |
| Sign-ins fail with 401 across every file | The database was seeded with `DEMO_PASSWORD` set, which replaces every password. Reseed without it: `pnpm demo:seed --force` |
| Unrelated files fail after an interrupted run | A killed run left rows or settings behind. Reseed: `pnpm demo:seed --force`, or use `make test-integration`, which drops, recreates, migrates and seeds `crm_test` on every run |
| `refusing to recreate '<name>': the name must end in _test` | `TEST_DB` must end in `_test` ([`scripts/test-db.sh`](../../scripts/test-db.sh)) |
| `test database: connect ECONNREFUSED` | Nothing on `CRM_PG_PORT` (5532) accepting `crm`/`crm`. The script starts the compose Postgres and Redis only when neither port answers |
| Relation or column errors | The database is behind the migrations: `pnpm db:migrate` with `DATABASE_URL` pointing at it, or `make test-integration` |

## AWS

### Tasks die with `exec format error`

The image was built for the wrong CPU. `PLATFORM` must match `cpu_architecture` in
`terraform.tfvars` (`linux/amd64` for `X86_64`, `linux/arm64` for `ARM64`);
[`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) derives it and refuses a mismatch, but an
image pushed by hand can still be wrong. Building for the other architecture than your machine
needs QEMU binfmt for buildx.

### The migrate task exits non-zero

`make aws-deploy` stops at step 4 and prints the task's log. The same messages as locally apply
([above](#migrate-fails-changed-after-it-was-applied)). List what is applied with
`scripts/aws-run-task.sh <env> migrate --status`.

### `make aws-operator` says the operator already exists

`[bootstrap] operator <email> already exists; nothing changed`: the script never resets a
password. Enter the email on the console sign-in page and press **Forgot password?** (SES must
be live), or sign in as another operator.

### The deploy waits forever for the service

`aws ecs wait services-stable` waits while tasks fail their health checks
(`GET /api/health` through the load balancer, `GET /up` in the container). Read the task's
stopped reason in the ECS console and its log group. The usual causes are the production guard
(above), the database or Redis unreachable, or a secret missing a key.
