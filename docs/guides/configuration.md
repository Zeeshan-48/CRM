# Configuration

Everything the CRM reads comes from environment variables, read once at boot. Paths are
relative to the repository root.

- The API reads them in [`apps/api/src/config/index.ts`](../../apps/api/src/config/index.ts);
  a handful of job and utility settings are read where they are used (listed
  [below](#jobs-and-other-settings)). [`apps/api/.env.example`](../../apps/api/.env.example)
  is a starting `apps/api/.env` for running outside Docker.
- The migration runner, [`db/migrate.ts`](../../db/migrate.ts), reads its own small set.
- The two single-page apps take [build-time variables](#single-page-app-build-variables).
- The local Docker stack is driven by [`CRM_*` variables](#local-compose-variables) in
  `deploy/compose/.env`.
- On AWS, Terraform sets the API's environment and injects its secrets
  ([deploy-aws.md](deploy-aws.md#what-terraform-sets-for-the-api)).

Workspace-level settings (a tenant's own WhatsApp number, Twilio or Exotel account, payment
gateways, sending domains, Google Calendar connections) are not environment variables: each
workspace admin enters them in the app and they are stored encrypted with
`CREDENTIALS_ENCRYPTION_KEY` ([connect-providers.md](connect-providers.md#two-tiers)).

## The production guard

With `NODE_ENV=production`, `assertProductionConfig` runs before the cluster starts and
refuses to boot with:

```
Refusing to start in production:
  - JWT_SECRET must be set to a random value of at least 32 characters
  - CREDENTIALS_ENCRYPTION_KEY must be set to a random value of at least 32 characters
  - CORS_ORIGINS must list the app origins
```

listing whichever of these is true:

| Problem | Fix |
| --- | --- |
| `JWT_SECRET` is unset (the development default `dev-only-jwt-secret-change-me` applies) or shorter than 32 characters | A random value of 32+ characters |
| `CREDENTIALS_ENCRYPTION_KEY` (or its old name `TELEPHONY_ENCRYPTION_KEY`) is unset (the development default applies) or shorter than 32 characters | A random value of 32+ characters |
| `CORS_ORIGINS` ends up empty (for example it holds only `*`, which is dropped) | The two app origins |

That is the whole guard. It does not check the URLs, provider keys or the `*_SIMULATE` flags:
a production deployment with `WHATSAPP_SIMULATE=true` or no `AWS_SES_FROM_EMAIL` runs that
channel simulated without complaint ([security.md](../architecture/security.md#10-the-production-guard)).
The API image ([`infra/docker/api.Dockerfile`](../../infra/docker/api.Dockerfile)) sets
`NODE_ENV=production` by default, so the guard applies to any container started from it
unless you set `NODE_ENV` yourself (compose sets `development`).

Two other places refuse production: the demo seed ([`apps/api/scripts/seed.ts`](../../apps/api/scripts/seed.ts))
never runs with `NODE_ENV=production`, and the shared WhatsApp webhook answers 401 without
`META_APP_SECRET` ([below](#whatsapp)).

## API environment variables

"Blank" means an empty string, which turns the feature off or simulated as described.

### Server

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables the guard above, cluster mode with one worker per CPU (one worker otherwise), and hides 500 error details from responses. `test` (or Vitest) simulates every provider and turns rate limits off |
| `PORT` | `5066` | API listen port |
| `LOG_LEVEL` | `info` | Winston level: `error`, `warn`, `info`, `debug`, ... |
| `TRUST_PROXY` | `1` | Number of reverse proxies in front of the API, passed to Express `trust proxy`. Decides which `X-Forwarded-For` entry is the client IP for rate limits. 1 behind a load balancer, 2 behind CloudFront plus a load balancer, 0 when browsers reach the API directly (compose) |
| `CORS_ORIGINS` | `CRM_APP_URL,OPERATOR_APP_URL` | Comma-separated browser origins allowed to call the API. Trailing slashes are stripped and `*` is refused, because responses carry credentials. Required in production. `/api/v1/ingest/*` answers any origin regardless |
| `BRAND_NAME` | `Open CRM` | Display name in emails |

### Secrets

| Variable | Default | Notes |
| --- | --- | --- |
| `JWT_SECRET` | development default | Signs every session token (tenant and operator), and derives the key that signs local file links. 32+ characters in production. Changing it signs everyone out ([operations.md](operations.md#secret-rotation)) |
| `JWT_EXPIRY` | `12h` | Token lifetime. Tokens are not revocable before they expire ([security.md](../architecture/security.md#2-tokens)), so keep it short |
| `CREDENTIALS_ENCRYPTION_KEY` | development default | Encrypts every tenant-supplied credential at rest (Twilio, Exotel, WhatsApp, Razorpay, Stripe, Google refresh tokens, integration keys, webhook signing secrets); any string of 32+ characters, hashed to a 32-byte AES key. `TELEPHONY_ENCRYPTION_KEY` is the old name, read when this one is unset. Changing it makes every stored credential unreadable |

### Database

| Variable | Default | Notes |
| --- | --- | --- |
| `PG_DATABASE_HOST` | `localhost` | |
| `PG_DATABASE_PORT` | `5432` | The compose Postgres is on host port 5532 |
| `PG_DATABASE_USER` | `postgres` | |
| `PG_DATABASE_PASSWORD` | `postgres` | |
| `PG_DATABASE` | `crm` | |
| `PG_POOL_MAX` | `8` in production, `10` otherwise | Connections per process. Every cluster worker has its own pool |
| `PG_POOL_MIN` | `0` | |
| `PG_CONNECTION_TIMEOUT` | `15000` | Milliseconds to wait for a connection |
| `PG_IDLE_TIMEOUT` | `10000` | Milliseconds before an idle connection is closed |

The API does not read `DATABASE_URL`; it builds its pool from the `PG_DATABASE_*` variables
([`apps/api/src/db/connection.ts`](../../apps/api/src/db/connection.ts)). Every statement has
a 30 second `statement_timeout`. For TLS, the standard `pg` environment applies: on AWS the
task definitions set `PGSSLMODE=verify-full` and `NODE_EXTRA_CA_CERTS` to the RDS certificate
bundle baked into the image.

The migration runner ([`db/migrate.ts`](../../db/migrate.ts)) reads:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Wins when set |
| `PG_DATABASE_HOST`, `PG_DATABASE_PORT`, `PG_DATABASE_USER`, `PG_DATABASE_PASSWORD`, `PG_DATABASE` | Used when `DATABASE_URL` is unset. Port defaults to 5432 |
| `PG_SSL` | `true` turns on TLS with certificate verification |
| `MIGRATIONS_DIR` | Default `db/migrations` next to the runner; the image sets `/app/db/migrations` |

`pnpm db:migrate` runs from the repository root, so it reads the shell or a root `.env`, not
`apps/api/.env`.

### Redis

| Variable | Default | Notes |
| --- | --- | --- |
| `REDIS_URL` | blank | The BullMQ job scheduler, the email send limiter, resolver caches and rate-limit counters. Blank: jobs run on in-process timers, rate limits use an in-memory window per process, and the email throttle allows every send ([operations.md](operations.md#processes)). Never used under tests |

### URLs

Bare origins, no trailing slash.

| Variable | Default | Notes |
| --- | --- | --- |
| `CRM_APP_URL` | `http://localhost:3570` | The workspace app: sign-in, invite and password-reset links, public booking links (`{CRM_APP_URL}/meet/...`), the calendar OAuth return page, checkout redirects. Part of the default `CORS_ORIGINS` |
| `OPERATOR_APP_URL` | `http://localhost:3580` | The operator console: operator password-reset links. Part of the default `CORS_ORIGINS` |
| `APP_PUBLIC_URL` | `http://localhost:5066` | The API's own public base: unsubscribe links, the Google OAuth callback, signed local file links, provider webhook URLs. On AWS it is the workspace app's host, whose `/api/*` is the API |

### AWS: files and email

| Variable | Default | Notes |
| --- | --- | --- |
| `AWS_REGION` | `us-east-1` | |
| `AWS_ENDPOINT_URL` | blank | Endpoint override for every AWS client, for an emulator such as Floci |
| `AWS_S3_BUCKET` | blank | Bucket for CRM files (lead documents, call recordings). Blank: local disk |
| `AWS_S3_ACCESS_KEY`, `AWS_S3_SECRET_KEY` | blank | Static S3 keys; blank uses the default AWS credential chain (the ECS task role on AWS) |
| `LOCAL_STORAGE_DIR` | `.local-storage` in the working directory | Where files go when `AWS_S3_BUCKET` is blank. Served only through HMAC-signed links that expire |
| `AWS_SES_REGION` | `AWS_REGION` | |
| `AWS_SES_ACCESS_KEY`, `AWS_SES_SECRET_KEY` | blank | Static keys for the SES, SNS and SQS clients; blank uses the default chain |
| `AWS_SES_FROM_EMAIL` | blank | The platform sender, a verified SES identity. Blank: email is simulated (recorded, not sent) |
| `AWS_SES_FROM_NAME` | `Open CRM` | |
| `SES_EVENTS_SNS_TOPIC_ARN` | blank | Topic every per-tenant SES configuration set publishes delivery events to |
| `SES_EVENTS_QUEUE_URL` | blank | SQS queue behind that topic, long-polled by the API. Blank: the events consumer stays idle |
| `SES_INBOUND_QUEUE_URL` | blank | SQS queue fed by an SES receipt rule, for inbound mail. Blank: the inbound consumer stays idle |
| `SES_INBOUND_REGION` | `AWS_SES_REGION`, then `AWS_REGION` | SES receives mail only in some regions |

Details for each: [connect-providers.md](connect-providers.md#email-amazon-ses) and
[connect-providers.md](connect-providers.md#files-s3).

### Email throughput and rate limits

| Variable | Default | Notes |
| --- | --- | --- |
| `EMAIL_DEFAULT_TENANT_TPS` | `5` | Base sends per second per workspace, scaled by the reputation tier; a workspace can override it in `tenants.config.emailTps` |
| `EMAIL_ACCOUNT_TPS` | `EMAIL_MAX_SEND_PER_SECOND`, then `14` | Ceiling across every workspace. Set it to your SES sending rate |
| `EMAIL_MAX_SEND_PER_SECOND` | `14` | Legacy name, the fallback for `EMAIL_ACCOUNT_TPS` |
| `RATE_LIMIT_ENABLED` | on | Only `false` disables every HTTP rate limiter (for load tests). Always off under tests |

The HTTP limits themselves are code, not configuration, in
[`apps/api/src/middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts):
for example 600 requests a minute per IP across the API, and 10 sign-in attempts per IP and
5 per email in 5 minutes.

### AI

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | blank | Platform key for Google Gemini |
| `OPENAI_API_KEY` | blank | |
| `ANTHROPIC_API_KEY` | blank | |
| `AI_EMAIL_GEMINI_MODEL` | `gemini-2.5-flash-lite` | Read in [`apps/api/src/services/ai/provider.ts`](../../apps/api/src/services/ai/provider.ts) |
| `AI_EMAIL_OPENAI_MODEL` | `gpt-4o-mini` | |
| `AI_EMAIL_ANTHROPIC_MODEL` | `claude-opus-4-8` | |

With every key blank, the deterministic offline engine answers. Which key wins when several
are set: [connect-providers.md](connect-providers.md#ai-gemini-openai-or-anthropic).

### WhatsApp

| Variable | Default | Notes |
| --- | --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_KEY` | blank | The platform default number, used by workspaces without their own |
| `WHATSAPP_API_VERSION` | `META_GRAPH_API_VERSION`, then `v21.0` | Graph API version |
| `WHATSAPP_SIMULATE` | `false` | `true` fakes every send, onboarding step and template sync |
| `WHATSAPP_DEFAULT_TEMPLATE_LANG` | `en_US` | |
| `WHATSAPP_TEST_ALLOWLIST` | blank | Comma-separated E.164 numbers that may receive real sends; every other send is recorded as simulated. Blank: no restriction |
| `META_APP_ID`, `META_APP_SECRET` | blank | The Meta app behind Embedded Signup. Blank hides the Connect button |
| `META_WEBHOOK_VERIFY_TOKEN` | blank | Verify token for the shared webhook |

`META_APP_SECRET` also verifies `X-Hub-Signature-256` on the shared webhook. Without it, a
production API answers every shared webhook with `401 Webhook signing secret not configured`
([`apps/api/src/controllers/wa-webhook.controller.ts`](../../apps/api/src/controllers/wa-webhook.controller.ts)).

### Telephony

| Variable | Default | Notes |
| --- | --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_DEFAULT_FROM_NUMBER` | blank | The platform default Twilio account; all three for it to be live |
| `TELEPHONY_SIMULATE` | `false` | `true` fakes Twilio calls even with keys |
| `EXOTEL_SIMULATE` | `false` | Exotel has no platform account (each workspace connects its own); `true` fakes the whole Exotel flow ([telephony-exotel.md](telephony-exotel.md)) |
| `PHONE_DEFAULT_COUNTRY_CODE` | `91` | Country code assumed for a bare 10-digit number ([`apps/api/src/utils/phone.ts`](../../apps/api/src/utils/phone.ts)) |

### Payments (workspace invoices)

| Variable | Default | Notes |
| --- | --- | --- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | blank | Platform default Razorpay account, and the operator's account for platform billing |
| `RAZORPAY_SIMULATE` | `false` | |
| `STRIPE_SECRET_KEY` | blank | Platform default Stripe account, and the operator's for platform billing |
| `STRIPE_SIMULATE` | `false` | |
| `STRIPE_CURRENCY` | `inr` | `usd` for a USD Stripe account |

### Platform billing

The operator charges workspaces for their plan on the same Razorpay and Stripe keys
([platform-billing.md](../architecture/platform-billing.md)).

| Variable | Default | Notes |
| --- | --- | --- |
| `BILLING_SIMULATE` | `false` (`true` in `apps/api/.env.example` and compose) | Canned customers, subscriptions and checkout links even with live keys. Always on under tests |
| `BILLING_GRACE_DAYS` | `3` | Days a `PAST_DUE` subscription keeps the workspace live before the sweep suspends it |
| `BILLING_RETURN_URL` | `{CRM_APP_URL}/login` | Where the hosted checkout returns |
| `RAZORPAY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET` | blank | Verify the platform billing webhooks. Blank: every webhook from that gateway fails verification |

### Google Calendar

| Variable | Default | Notes |
| --- | --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` (or `GOOGLE_CLIENT_ID`) | blank | The `GOOGLE_CALENDAR_*` name wins when both are set |
| `GOOGLE_CALENDAR_CLIENT_SECRET` (or `GOOGLE_CLIENT_SECRET`) | blank | |
| `GOOGLE_CALENDAR_REDIRECT_URI` (or `GOOGLE_OAUTH_REDIRECT_URL`) | `{APP_PUBLIC_URL}/api/v1/oauth/google/calendar/callback` | Register it verbatim on the OAuth client |
| `GOOGLE_CALENDAR_ENABLED` | on | Only `false` turns the feature off |

With the client id or secret blank, nothing calls Google and meetings get a Jitsi link.

### Jobs and other settings

Read outside `config/index.ts`:

| Variable | Default | Read in | Notes |
| --- | --- | --- | --- |
| `MEETING_REMINDER_LEAD_MINUTES` | `60` | [`jobs/meeting-reminders.job.ts`](../../apps/api/src/jobs/meeting-reminders.job.ts) | How long before a meeting the reminder goes out |
| `TASK_REMINDER_HOUR_UTC` | `3` | [`jobs/task-reminders.job.ts`](../../apps/api/src/jobs/task-reminders.job.ts) | Hour of day (UTC) from which the daily task reminders are sent |
| `RUN_JOBS` | | [`index.ts`](../../apps/api/src/index.ts) | Set by the cluster primary on the one worker that runs the background jobs. Do not set it yourself |
| `TZ` | `UTC` | [`index.ts`](../../apps/api/src/index.ts) | Pinned to `UTC` by the code, compose, the image and Terraform |
| `DEMO_PASSWORD` | | [`scripts/seed.ts`](../../apps/api/scripts/seed.ts) | Seed only: the password of every demo account |

## Single-page app build variables

Vite compiles these into the bundle, so they are set at build time: in `apps/web/.env` and
`apps/console/.env` for `pnpm dev`, and as Docker build arguments for the images
([`infra/docker/web.Dockerfile`](../../infra/docker/web.Dockerfile),
[`infra/docker/console.Dockerfile`](../../infra/docker/console.Dockerfile)).

| App | Variable | Default | Notes |
| --- | --- | --- | --- |
| web | `VITE_API_BASE_URL` | `http://localhost:5066/api/v1` | The API base the browser calls |
| web | `VITE_META_APP_ID` | blank | WhatsApp Embedded Signup; the Connect button hides without it |
| web | `VITE_META_WA_ES_CONFIG_ID` | blank | Embedded Signup configuration id |
| web | `VITE_META_GRAPH_API_VERSION` | `v25.0` | Graph API version for the Facebook SDK |
| console | `VITE_API_BASE_URL` | `http://localhost:5066/api/v1/operator` | The operator plane |

On AWS, [`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) builds each app with
`VITE_API_BASE_URL` from the `sites` Terraform output (`https://<host>/api/v1`, the console's
`/api/v1/operator`) and passes no Meta arguments. To enable Embedded Signup there, add the
`VITE_META_*` build arguments to the web build in that script.

## Local compose variables

[`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml) reads `deploy/compose/.env`
(generated by `make env`, example in [`deploy/compose/.env.example`](../../deploy/compose/.env.example)):

| Variable | Default | Becomes |
| --- | --- | --- |
| `CRM_JWT_SECRET` | required, generated | `JWT_SECRET` |
| `CRM_CREDENTIALS_ENCRYPTION_KEY` | required, generated | `CREDENTIALS_ENCRYPTION_KEY` |
| `CRM_DEMO_PASSWORD` | generated (`Demo-` and 12 random characters) | `DEMO_PASSWORD` for `make demo` |
| `CRM_BRAND_NAME` | `Open CRM` | `BRAND_NAME` (and the SES sender name with Floci) |
| `CRM_WEB_PORT`, `CRM_CONSOLE_PORT`, `CRM_API_PORT` | `3570`, `3580`, `5066` | Host ports, and `CRM_APP_URL`, `OPERATOR_APP_URL`, `APP_PUBLIC_URL`, `CORS_ORIGINS` and the apps' `VITE_API_BASE_URL` |
| `CRM_PG_PORT`, `CRM_REDIS_PORT` | `5532`, `6469` | Host ports. The Makefile's `test-integration` and [`scripts/test-db.sh`](../../scripts/test-db.sh) read them from the shell, not from `.env` |
| `CRM_FLOCI_PORT`, `CRM_MAILPIT_PORT` | `4637`, `8086` | Host ports of the emulator overlay |
| `LOG_LEVEL`, `PG_POOL_MAX`, `AWS_REGION`, `AWS_S3_BUCKET` | `info`, `10`, `us-east-1`, blank | Passed through |
| `WHATSAPP_SIMULATE`, `TELEPHONY_SIMULATE`, `EXOTEL_SIMULATE`, `RAZORPAY_SIMULATE`, `STRIPE_SIMULATE`, `BILLING_SIMULATE` | `true` | Passed through |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | blank | Passed through |

Compose fixes the rest: `NODE_ENV=development`, `TRUST_PROXY=0`, the Postgres and Redis
addresses inside the network, `LOCAL_STORAGE_DIR=/app/.local-storage`. Any other key in
`deploy/compose/.env` reaches the API container as is (`env_file`), so provider keys for a
real test account go there. The Floci overlay ([`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml))
adds `AWS_ENDPOINT_URL`, static test keys, `AWS_SES_FROM_EMAIL` and the SES event topic and
queue.

`make up-aws` reads a second file, `deploy/compose/.env.aws`
([example](../../deploy/compose/.env.aws.example)), with real AWS resource names from
`terraform output`: `AWS_REGION`, `AWS_PROFILE`, `AWS_S3_BUCKET`, `AWS_SES_REGION`,
`AWS_SES_FROM_EMAIL` (required), `SES_EVENTS_SNS_TOPIC_ARN`, `SES_EVENTS_QUEUE_URL` and
optionally `SES_INBOUND_QUEUE_URL`. Its values win over the defaults. The SES and SQS keys
(`AWS_SES_ACCESS_KEY`, `AWS_SES_SECRET_KEY`) belong in `deploy/compose/.env`, and the S3 client
uses your AWS profile, mounted read-only. See what the API will get with:

```bash
docker compose --env-file deploy/compose/.env --env-file deploy/compose/.env.aws \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.aws.yaml config api
```
