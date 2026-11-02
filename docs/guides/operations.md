# Operations

Running a CRM deployment day to day: what runs, how to tell it is healthy, backups, upgrades,
scaling, secrets, and the operator's tenant tasks. Paths are relative to the repository root.
The AWS shape is in [deploy-aws.md](deploy-aws.md).

## Processes

The API is one Node process tree ([`apps/api/src/index.ts`](../../apps/api/src/index.ts)):

| Process | Does |
| --- | --- |
| Cluster primary | Forks the workers (one per CPU with `NODE_ENV=production`, one otherwise), restarts a worker that dies (at most 10 restarts a minute), and forwards SIGTERM and SIGINT |
| HTTP workers | Each listens on `PORT` (5066) with its own database pool and caches |
| The jobs worker | Exactly one worker, forked with `RUN_JOBS=true`, also runs the background jobs. When it dies its replacement keeps the role |

On shutdown each worker stops the jobs (on the jobs worker), stops accepting connections,
finishes in-flight requests and closes Redis and the database, with a 30 second limit before
it exits anyway. On AWS each API task runs this whole tree, so there is one jobs worker per
task and no separate worker service.

The jobs worker starts three things ([`apps/api/src/jobs/index.ts`](../../apps/api/src/jobs/index.ts)):

- **The scheduler** ([`jobs/scheduler.ts`](../../apps/api/src/jobs/scheduler.ts)). With
  `REDIS_URL` set it is BullMQ: one queue, `crm-jobs`, holds every recurring job as a job
  scheduler in Redis, so the schedule survives restarts and each tick fires once across all
  tasks; up to 4 jobs run at once. On boot it upserts every job and removes schedulers for jobs
  no longer in the registry. Without Redis it falls back to `setInterval` timers in the jobs
  worker, which means every API task runs every sweep: keep Redis on any deployment with more
  than one task.
- **The SES events consumer** ([`jobs/ses-events.consumer.ts`](../../apps/api/src/jobs/ses-events.consumer.ts)):
  long-polls `SES_EVENTS_QUEUE_URL` for send, delivery, bounce, complaint, open and click
  events from tenant sending domains. Idle while the variable is unset.
- **The inbound mail consumer** ([`jobs/ses-inbound.consumer.ts`](../../apps/api/src/jobs/ses-inbound.consumer.ts)):
  long-polls `SES_INBOUND_QUEUE_URL`. Idle while unset.

On AWS, a message either consumer fails to process five times moves to the queue's
dead-letter queue, which raises an alarm.

### Jobs and schedules

From [`apps/api/src/jobs/registry.ts`](../../apps/api/src/jobs/registry.ts). Every job is an
idempotent "find due rows, process them" sweep; the name is also the BullMQ scheduler id, so
never rename a deployed one.

| Job | Every | Does |
| --- | --- | --- |
| `verify-domains` | 1 min | Checks pending tenant sending domains in SES |
| `reputation-recovery` | 10 min | Recovers tenant email sending reputation |
| `health-sweep` | 24 h | Re-checks verified sending domains; one broken for more than 24 hours is failed and sends fall back to the platform sender |
| `calls-poll` | 15 s | Polls Twilio call status |
| `exotel-sync` | 30 s | Syncs Exotel calls |
| `meeting-reminders` | 1 min | Sends meeting reminders `MEETING_REMINDER_LEAD_MINUTES` (60) ahead |
| `task-reminders` | 1 h | Sends at most one reminder per open task per day, from `TASK_REMINDER_HOUR_UTC` (3) |
| `sales-agent-runner` | 5 min | For tenants that opted in, enrols fresh signals and advances due sales sequence touches |
| `payments-poll` | 30 s | Polls invoice payment links (Razorpay, Stripe) |
| `billing-sweep` | 1 h | Platform billing dunning, then the entitlement sync |
| `billing-payment-poll` | 30 s | Checks pending platform billing payments |
| `catalog-pull` | 10 min | Refetches pull-mode product catalogs older than an hour |
| `engagement-rollup` | 15 min | Recomputes product-intent rollups, so quiet leads cool down |
| `webhook-dispatch` | 15 s | Sends queued outbound webhooks (claim, then send) |

A job that throws logs `job <name> failed: <error>` and runs again on its next tick.

## Health

| Endpoint | Answers | Used by |
| --- | --- | --- |
| `GET /up` | `200 OK` (plain text) | The image's Docker `HEALTHCHECK` and the ECS container health check |
| `GET /api/health` | `{"ok":true,"service":"open-crm-api","at":"..."}` | The load balancer target group health check |

Both are mounted before authentication and rate limiting
([`apps/api/src/app.ts`](../../apps/api/src/app.ts)), and neither checks Postgres or Redis: they
prove the HTTP worker is up. A worker only starts listening after its first database
connection succeeds (five attempts with backoff).

At boot the API logs which mode each provider started in, for example
`Email domains: simulated (AWS_SES_FROM_EMAIL unset)`,
`SES events consumer idle (SES_EVENTS_QUEUE_URL unset)`, `Storage: local disk at ...` and
`Background jobs: BullMQ scheduler (14 repeatable jobs)`.

## Logs, alarms and the dashboard

The API logs plain text lines, `YYYY-MM-DD HH:mm:ss [level] message`, to stdout
([`apps/api/src/utils/logger.ts`](../../apps/api/src/utils/logger.ts)), at `LOG_LEVEL`. Every
error response carries a `rayId` in its `message`, and the same line (with the stack for
unexpected errors) is in the log: search for the ray id. In production a 500 response hides
the error text; the log keeps it.

| Where | Logs |
| --- | --- |
| Local | `make logs SERVICE=api` (also `migrate`, `web`, `console`, `floci`, `terraform`) |
| AWS | CloudWatch Logs group `/open-crm/<name_prefix>/api` (one-off tasks: `/open-crm/<name_prefix>/migrate`), retention `log_retention_days` (14 days in aws-dev, 365 in aws-prod), encrypted with the deployment key |

The [observability module](../../infra/terraform/modules/observability/main.tf) sends alarms to
the SNS topic `<name_prefix>-alarms`, emailed to `alarm_email` when set (confirm the
subscription email SNS sends):

| Alarm | Fires when |
| --- | --- |
| `<prefix>-api-5xx` | More than 25 target 5xx responses in 5 minutes, two periods running |
| `<prefix>-api-unhealthy` | Any task fails the load balancer health check |
| `<prefix>-api-cpu`, `<prefix>-api-memory` | Average service CPU or memory above 85% for 10 minutes |
| `<prefix>-db-cpu` | Database CPU above 80% for 10 minutes |
| `<prefix>-db-storage` | Free database storage below 5 GiB |
| `<prefix>-db-connections` | More than 160 connections (80% of a 200 ceiling) |
| `<prefix>-failed-jobs` | More than 5 `job ... failed:` log lines in 5 minutes |
| `<prefix>-<queue>-messages` | Any message in an SES dead-letter queue |
| `<prefix>-redis-...` | From the [cache module](../../infra/terraform/modules/cache/main.tf), per node: engine CPU above 80%, memory above 80% of maxmemory, any eviction (with `noeviction`, that means out of memory), more than 1000 connections |

The CloudWatch dashboard named `<name_prefix>` shows request and error counts, p50 and p99
latency, API CPU and memory, and database CPU, connections and latency. The SES configuration
set publishes send, delivery, bounce and complaint counts for the platform sender to CloudWatch.
RDS exports its PostgreSQL log (statements slower than 1 second are logged) and has
Performance Insights on.

## Backups

From the [database module](../../infra/terraform/modules/database/main.tf):

| Setting | aws-dev | aws-prod |
| --- | --- | --- |
| Automated backups (point-in-time restore) | 3 days | 14 days |
| Backup window, maintenance window | `03:00-04:00`, `sun:04:30-sun:05:30` UTC | same |
| Multi-AZ | no | yes |
| Deletion protection, final snapshot | no, skipped | yes, `<name_prefix>-db-final` |

Storage is gp3, encrypted with the deployment key, and grows automatically from 20 GB up to
100 GB. Minor engine versions upgrade automatically in the maintenance window. Redis keeps
snapshots for 1 day (aws-dev) or 7 days (aws-prod).

The file bucket is versioned; replaced or deleted file versions are kept for 30 days
(`storage_noncurrent_version_days`). There is no cross-region replication.

Back up `CREDENTIALS_ENCRYPTION_KEY` separately from the database (it is in
`<name_prefix>/app` on AWS, `deploy/compose/.env` locally). A restored database is useless for
tenant integrations without the key that encrypted their credentials, and a dump plus the key
reveals every tenant secret, so keep the two apart.

## Migrations on upgrade

Schema changes are plain SQL files in [`db/migrations`](../../db/migrations), applied in
filename order by [`db/migrate.ts`](../../db/migrate.ts) (Prisma only generates the Kysely
types, [ADR 0004](../architecture/adr/0004-sql-migrations-prisma-types-only.md)):

- each file runs in its own transaction and is recorded in `schema_migrations` with a SHA-256
  checksum;
- a Postgres advisory lock makes concurrent runs safe: the second waits, then finds nothing
  left to apply;
- an applied file that changed stops the run with `<file> changed after it was applied; add a
  new migration instead`. Never edit an applied migration; add a new numbered file.

| Where | Apply | Status only |
| --- | --- | --- |
| Local Docker | `make up` (the `migrate` one-shot runs before the API) | `DATABASE_URL=postgres://crm:crm@localhost:5532/crm pnpm db:migrate --status` |
| From source | `pnpm db:migrate` | `pnpm db:migrate --status` |
| AWS | `make aws-deploy` (before the rollout) or `make aws-migrate ENV=...` | `scripts/aws-run-task.sh <env> migrate --status` |

Migrations are forward-only: there is no down migration. During a rolling deploy old and new
API tasks run against the migrated schema at the same time, so write migrations the old code
can live with (add columns and tables first, remove them in a later release). Restoring the
database is the rollback for a bad migration.

## Scaling

- **API tasks.** `api_min_count` and `api_max_count` in [`envs/<env>/main.tf`](../../infra/terraform/envs/aws-prod/main.tf)
  (1 to 2 in aws-dev, 2 to 10 in aws-prod); the service scales on average CPU with a 60%
  target. `api_cpu` and `api_memory` size each task. The API keeps no per-task session state
  (bearer JWTs), so any task can serve any request.
- **Database connections.** Each cluster worker has its own pool of `PG_POOL_MAX` (`db_pool_max`,
  8 on AWS). Total connections are about tasks x workers per task x `PG_POOL_MAX`; keep that
  under the instance's limit (the alarm assumes 200). Grow `db_instance_class` before raising
  `api_max_count` far.
- **Background jobs** do not scale with tasks: BullMQ fires each tick once, and the 4-job
  concurrency is per jobs worker.
- **Caches are per process.** Entitlements and role maps are cached for 60 seconds in each
  worker, so a plan change or override can take up to a minute to reach every worker and task
  ([multi-tenancy-and-entitlements.md](../architecture/multi-tenancy-and-entitlements.md#10-caching-and-staleness)).
  Tenant status is read on every request, so a suspension is immediate.
- **Email.** `EMAIL_ACCOUNT_TPS` caps sends across every workspace; raise it with your SES
  sending quota.

## Secret rotation

| Secret | Effect of a new value | How |
| --- | --- | --- |
| `JWT_SECRET` | Every session ends: users and operators sign in again. Local signed file links (no S3 bucket) stop working too, since their key derives from it. Bearer JWTs cannot be revoked one by one before `JWT_EXPIRY` (12 h), so rotating this is the way to end every session at once | AWS: put a new `<name_prefix>/app` value with the same `CREDENTIALS_ENCRYPTION_KEY`, then force a new deployment of the API. Local: change `CRM_JWT_SECRET` in `deploy/compose/.env` and `make up` |
| `CREDENTIALS_ENCRYPTION_KEY` | Every stored tenant credential becomes unreadable: every workspace re-enters its Twilio, Exotel, WhatsApp, payment, calendar and integration credentials | Rotation is not supported yet: there is no key versioning and no re-encryption tool ([security.md](../architecture/security.md#11-known-gaps)). Treat the key as permanent and back it up |
| Database password | None for users | `terraform apply -replace='module.app.module.database.random_password.master'`, then force a new deployment of the API |
| CloudFront origin header | A short burst of 403s while CloudFront propagates | `terraform apply -replace='module.app.random_password.origin_verify'` |
| Provider keys | The new key is used once tasks restart | Rotate at the provider, put the new value in `<name_prefix>/providers`, force a new deployment ([deploy-aws.md](deploy-aws.md#provider-keys)) |

Terraform never overwrites `<name_prefix>/app` or `<name_prefix>/providers` after creation
(`ignore_changes`), so a value you put by hand stays. Run the `-replace` applies from
`infra/terraform/envs/<env>` with `-var image_tag=<the deployed tag>`, or the API task
definition changes to whatever tag you pass. Force a new deployment with:

```bash
aws ecs update-service --cluster <terraform output cluster_name> --service <terraform output services> --force-new-deployment
```

## Onboarding a tenant

In the operator console (`OPERATOR_APP_URL`), as a `SUPERADMIN`:

1. **Plans** must hold an active plan. **New Plan** sets its key, name, description, monthly
   price, modules and limits (seats, leads, AI credits a month).
2. **Tenants**, **Onboard Tenant**: workspace name, slug, industry, domain, brand colour, plan,
   billing, and the first admin's name and email.
3. The console creates the tenant, snapshots the plan into its entitlements, creates the admin
   with a generated temporary password and the default sales pipeline, and emails the admin
   their sign-in details. The password is never shown to the operator.

When email is not configured (no `AWS_SES_FROM_EMAIL`), the dialog says so and the welcome
email is skipped and noted in the audit log; configure SES, then have the admin enter their
email on the workspace sign-in page and press **Forgot password?**. Under the SES sandbox the admin's address must be
verified.

The **Billing** choice decides when the workspace goes live:

| Billing | Result |
| --- | --- |
| No billing | `ACTIVE` immediately (comp or internal) |
| Razorpay or Stripe | `SUSPENDED` until the admin completes the first payment through the hosted checkout |

Details: [multi-tenancy-and-entitlements.md](../architecture/multi-tenancy-and-entitlements.md#6-onboarding-a-tenant).

## Changing plans and entitlements

Open the tenant under **Tenants**:

- **Change plan** moves it to another active plan and re-snapshots its entitlements. Rows an
  operator overrode (`source = ADMIN`) survive plan changes.
- Each entitlement row (one `module.*` per module, plus `limit.seats`, `limit.leads`,
  `limit.ai_credits_monthly` and, with products, `limit.connected_apps`) can be overridden.
- Editing a plan under **Plans** never changes tenants already on it: the snapshot is taken at
  onboarding and on a plan change ([ADR 0003](../architecture/adr/0003-entitlements-first.md)).
  Deactivating a plan hides it from onboarding and plan changes.

A workspace that calls a module not in its entitlements gets `403 The <module> module is not
included in this workspace's plan`.

## Suspending a tenant

On the tenant page, **Suspend** sets the status to `SUSPENDED`; **Activate** sets it back to
`ACTIVE`. The status is checked on every request, so a suspension takes effect on the next API
call, even for tokens issued earlier: sign-in answers 403 "This workspace is suspended", and
the workspace's ingest API keys and form tokens stop working. Its data is untouched.
Platform billing also suspends a workspace on an immediate cancel, or when a `PAST_DUE`
subscription outlives `BILLING_GRACE_DAYS` (3), and reactivates it on payment
([platform-billing.md](../architecture/platform-billing.md)). **Operators** and **Audit** list
the operator users and every operator action.

## Platform billing in simulate mode

`BILLING_SIMULATE=true` (the compose default, and on AWS whenever `simulate_providers = true`,
the aws-dev default) makes platform billing create canned customers, subscriptions and
checkout links with no network calls, even when real keys are present. Under tests it is
always on.

The simulated checkout never completes on its own: its URL is `BILLING_RETURN_URL?sim_sub=...`
and the payment poll reports simulated links as unpaid. A tenant onboarded with Razorpay or
Stripe in this mode stays `SUSPENDED` until an operator presses **Activate** (or a signed
webhook arrives). For real billing, set `BILLING_SIMULATE=false` (on AWS,
`simulate_providers = false`, which also makes WhatsApp, telephony and invoice payments live),
the platform Razorpay or Stripe keys and the webhook secrets
([connect-providers.md](connect-providers.md#platform-billing-the-operator-charges-workspaces)).
