# Deploy to AWS

Deploy the CRM to your own AWS account with the Terraform in
[`infra/terraform`](../../infra/terraform) and one script. The result is two host names: the
workspace app on `https://<domain>` and the operator console on `https://<console_domain>`,
each a static app on S3 behind CloudFront, with the API under `/api/*` on both hosts. The API
runs on ECS Fargate in private subnets with RDS PostgreSQL, ElastiCache Redis, SES, Secrets
Manager and a customer-managed KMS key. Paths are relative to the repository root. The system
view is in [HLD.md](../architecture/HLD.md).

## What gets created

The whole deployment is one module, [`modules/deployment`](../../infra/terraform/modules/deployment/main.tf);
the environments [`envs/aws-dev`](../../infra/terraform/envs/aws-dev/main.tf) and
[`envs/aws-prod`](../../infra/terraform/envs/aws-prod/main.tf) only pick sizes and safety
switches.

| Path | Served by | Role |
| --- | --- | --- |
| `https://<domain>/*` | CloudFront and a private S3 bucket | The workspace app (`apps/web`) |
| `https://<console_domain>/*` | CloudFront and a private S3 bucket | The operator console (`apps/console`) |
| `https://<either host>/api/*` | CloudFront, the load balancer, the `api` ECS service | The API: tenant plane, operator plane, product ingest, provider webhooks |
| one-off | the `migrate` task definition on the API image | SQL migrations, and the first operator |

The browser calls the API on the host it loaded the app from, so every API call is
same-origin. There is no separate worker service: each API task runs a Node cluster, and one
cluster worker per task also runs the background jobs ([operations.md](operations.md#processes)).

| Module | Creates |
| --- | --- |
| [`network`](../../infra/terraform/modules/network) | VPC (`10.70.0.0/16`), public and private subnets, NAT, VPC flow logs, optional interface endpoints |
| [`kms`](../../infra/terraform/modules/kms) | The customer-managed key that encrypts the database, cache, secrets, logs, buckets and images |
| [`secrets`](../../infra/terraform/modules/secrets/main.tf) | `<name_prefix>/app` and, when you pass provider keys, `<name_prefix>/providers` |
| [`database`](../../infra/terraform/modules/database/main.tf) | RDS PostgreSQL 16 (database `crm`, master user `crm_admin`), TLS forced, Performance Insights, the `<name_prefix>/database` secret |
| [`cache`](../../infra/terraform/modules/cache/main.tf) | ElastiCache Redis 7 with TLS and an AUTH token, `noeviction` for BullMQ, its `REDIS_URL` secret |
| [`email`](../../infra/terraform/modules/email/main.tf) | The SES domain identity with DKIM and a `bounce.` MAIL FROM domain, a configuration set, the delivery-events SNS topic and SQS queue with a dead-letter queue, optional inbound mail |
| [`storage`](../../infra/terraform/modules/storage) | The CRM file bucket `<name_prefix>-files-<account id>`, versioned |
| [`ecr`](../../infra/terraform/modules/ecr) | The `api` image repository |
| [`edge`](../../infra/terraform/modules/edge) | The load balancer, reachable only from CloudFront's origin ranges |
| [`cdn`](../../infra/terraform/modules/cdn/main.tf), [`waf`](../../infra/terraform/modules/waf/main.tf) | One CloudFront distribution and site bucket per app; one WAF web ACL in `us-east-1` shared by both |
| [`service`](../../infra/terraform/modules/service) | The `api` ECS service and the `migrate` task definition |
| [`observability`](../../infra/terraform/modules/observability/main.tf) | An SNS alarm topic, alarms and a dashboard ([operations.md](operations.md#logs-alarms-and-the-dashboard)) |

CloudFront adds a secret `X-Origin-Verify` header to every request it sends to the load
balancer and the API listener rule requires it, so neither the WAF nor CloudFront can be
bypassed. The WAF runs the AWS common and known-bad-inputs rule sets and blocks an IP after
3000 requests in 5 minutes, except on `/api/v1/wa/webhooks`, `/api/v1/telephony/webhooks`,
`/api/v1/operator/webhooks` and `/api/v1/ingest`.

| | aws-dev | aws-prod |
| --- | --- | --- |
| Availability zones, NAT | 2, one shared NAT, no interface endpoints | 3, one NAT per AZ, interface endpoints |
| RDS PostgreSQL | `db.t4g.small`, single AZ, 3 days of backups, no deletion protection | `db.t4g.medium`, Multi-AZ, 14 days, deletion protection |
| ElastiCache Redis | `cache.t4g.small`, 1 node, 1 day of snapshots | `cache.m7g.large`, 2 nodes with automatic failover, 7 days |
| API tasks | 0.5 vCPU, 1 GB; 1 to 2 tasks | 1 vCPU, 2 GB; 2 to 10 tasks |
| `simulate_providers` default | `true` | `false` |
| KMS deletion window, secret recovery window | 7 days, 0 | 30 days, 30 days |
| Log and flow-log retention | 14 days | 365 days |

WAF is on in both. The API scales on average CPU (target 60%) and rolls out with the ECS
deployment circuit breaker and automatic rollback.

## Prerequisites

- An AWS account and credentials for it (a profile with administrator rights for the first
  apply).
- `terraform` (1.10 or later; the Makefile pins 1.16.6 for its container), `docker` with
  buildx, the AWS CLI and `python3`. [`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh)
  checks for all four.
- Two host names, for example `crm.example.com` and `console.crm.example.com`. With a Route 53
  hosted zone (`route53_zone_id`) the certificates, their validation and every DNS record are
  created for you. Otherwise bring two ACM certificates that cover both hosts: one in your
  deployment region (`certificate_arn`, for the load balancer) and one in `us-east-1`
  (`cdn_certificate_arn`, for CloudFront), then publish the records from the outputs.
- A sending domain for SES (`mail_domain`, defaults to `domain`). Mail goes out as
  `no-reply@<mail_domain>`. New SES accounts are in the sandbox: request production access, or
  verify every recipient address while testing.
- Optional: platform provider accounts (AI, WhatsApp, Twilio, Razorpay, Stripe, Google
  Calendar). Without them every provider runs simulated and AI uses the offline engine.

## Configure

```bash
cp infra/terraform/envs/aws-dev/terraform.tfvars.example infra/terraform/envs/aws-dev/terraform.tfvars
cp infra/terraform/envs/aws-dev/backend.tf.example infra/terraform/envs/aws-dev/backend.tf   # remote state (recommended)
```

`*.tfvars` is git-ignored. The state contains generated secrets (the JWT secret, the
credentials key, the database password, the origin header): keep the state bucket private,
versioned and encrypted ([`backend.tf.example`](../../infra/terraform/envs/aws-dev/backend.tf.example)
uses S3-native locking, no DynamoDB table).

The environment variables ([`envs/aws-dev/variables.tf`](../../infra/terraform/envs/aws-dev/variables.tf);
`aws-prod` has the same set with production defaults):

| Variable | Default | Purpose |
| --- | --- | --- |
| `region` | required | Deployment region |
| `name_prefix` | required | Prefix of every resource name, 3 to 24 lowercase letters, digits and hyphens |
| `domain` | required | The workspace app's host; its `/api/*` is the API |
| `console_domain` | required | The operator console's host |
| `route53_zone_id` | null | Hosted zone for both hosts: automatic certificates and DNS |
| `certificate_arn`, `cdn_certificate_arn` | null | Your own regional and `us-east-1` certificates, when the zone is not in Route 53 |
| `mail_domain` | `domain` | SES sending domain |
| `inbound_domain` | null | Domain whose mail SES receives for the CRM inbox; null disables inbound mail |
| `product_name` | `Open CRM` | `BRAND_NAME` and the sender name |
| `alarm_email` | null | Who receives the CloudWatch alarms (confirm the SNS subscription email) |
| `provider_secrets` | `{}` | Platform provider keys by variable name ([below](#provider-keys)) |
| `simulate_providers` | `true` in aws-dev, `false` in aws-prod | Forces simulated WhatsApp, telephony, Razorpay, Stripe and platform billing even with keys present |
| `api_extra_environment` | `{}` | Anything else the API should read ([configuration.md](configuration.md)). Never secrets |
| `api_extra_secrets` | `[]` | Extra ECS secret references, `{ name, valueFrom }` |
| `db_instance_class`, `cache_node_type` | see the table above | Sizes |
| `cpu_architecture` | `X86_64` | `ARM64` runs the tasks on Graviton |
| `log_level` | `info` | The API's `LOG_LEVEL` |
| `image_tag` | passed by the Makefile | The image to deploy; set it in tfvars only to pin a release |
| `environment`, `extra_tags` | `dev` or `prod`, `{}` | Tags on every resource |

The deployment module takes more inputs that the environments do not expose, with defaults in
[`modules/deployment/variables.tf`](../../infra/terraform/modules/deployment/variables.tf):
`vpc_cidr`, `dmarc_policy` (`none`), `alb_idle_timeout` (120 s), `cdn_origin_read_timeout`
(60 s), `alb_access_logs_bucket`, `db_allocated_storage` (20 GB, growing to
`db_max_allocated_storage`, 100 GB), `db_monitoring_interval` (60 s), `db_pool_max` (8),
`storage_noncurrent_version_days` (30), `kms_admin_principal_arns`, and `jwt_secret` and
`credentials_encryption_key` (generated when null; set them only when moving an existing
installation). The per-environment sizes (`az_count`, `api_cpu`, `api_memory`,
`api_min_count`, `api_max_count`, retention days) are set in
[`envs/<env>/main.tf`](../../infra/terraform/envs/aws-dev/main.tf). Change any of them there.

### Cost knobs

The main drivers are the NAT gateways, RDS, ElastiCache, the API tasks and the interface
endpoints. The cheaper choices, all already used by `aws-dev`: `single_nat_gateway = true`,
`az_count = 2`, `enable_interface_endpoints = false`, `db_multi_az = false`, one cache node,
`api_min_count = 1`, and smaller `db_instance_class`, `cache_node_type`, `api_cpu` and
`api_memory`. `cpu_architecture = "ARM64"` moves every task to Graviton (about 20% cheaper per
vCPU) and needs `linux/arm64` images, which the deploy script builds automatically when
tfvars says `ARM64`.

## What Terraform sets for the API

You do not configure these by hand ([`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf)):

| Variable | Value |
| --- | --- |
| `NODE_ENV`, `TZ`, `PORT` | `production`, `UTC`, `5066` |
| `CRM_APP_URL`, `APP_PUBLIC_URL` | `https://<domain>` |
| `OPERATOR_APP_URL` | `https://<console_domain>` |
| `CORS_ORIGINS` | `https://<domain>,https://<console_domain>` |
| `TRUST_PROXY` | `2` (CloudFront, then the load balancer) |
| `PG_DATABASE_HOST`, `PG_DATABASE_PORT`, `PG_DATABASE_USER`, `PG_DATABASE`, `PG_POOL_MAX` | From the database module; `PG_POOL_MAX` is `db_pool_max` |
| `PGSSLMODE`, `NODE_EXTRA_CA_CERTS` | `verify-full` and the RDS bundle in the image |
| `AWS_REGION`, `AWS_SES_REGION`, `SES_INBOUND_REGION` | The deployment region |
| `AWS_S3_BUCKET` | The file bucket (`LOCAL_STORAGE_DIR` is `/tmp/local-storage`, unused) |
| `AWS_SES_FROM_EMAIL`, `AWS_SES_FROM_NAME` | `no-reply@<mail_domain>`, `product_name` |
| `SES_EVENTS_SNS_TOPIC_ARN`, `SES_EVENTS_QUEUE_URL`, `SES_INBOUND_QUEUE_URL` | From the email module |
| Every `*_SIMULATE` switch | `simulate_providers` |
| Secrets | `JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` (`<name_prefix>/app`), `PG_DATABASE_PASSWORD` (`<name_prefix>/database`), `REDIS_URL` (the cache secret), every key in `provider_secrets` |

The task role may read and write the file bucket, send through SES (the platform identity and
the per-tenant sending domains the API creates, with their configuration sets) and consume the
two SES queues. Nothing else.

## Deploy

```bash
make aws-deploy ENV=aws-dev
```

[`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) tags the image with the current commit
(`TAG`, override it to pin a release; it warns when the working tree has uncommitted changes)
and runs seven steps:

1. `terraform apply` of the image registry (and the KMS key that encrypts it);
2. `docker buildx build --push` of the API image for `PLATFORM`, which follows
   `cpu_architecture` in tfvars (`linux/amd64` for `X86_64`, `linux/arm64` for `ARM64`) and
   must agree with it: a mismatch builds fine and the tasks then die with `exec format error`.
   Building for the other architecture than your machine needs QEMU binfmt for buildx;
3. `terraform apply` of what the migrate task needs (network, database, task definition);
4. the migrate task, waited for ([`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh));
   it must exit 0;
5. `terraform apply` of everything else: cache, mail, storage, edge, CloudFront, the API service;
6. a wait until the API service is stable;
7. both apps built with `VITE_API_BASE_URL` for their host, uploaded to their buckets (hashed
   assets cached for a year, `index.html` uploaded last with `no-cache`), and a CloudFront
   invalidation.

It ends by printing the app and console URLs and the next steps.

| Command | Does |
| --- | --- |
| `make aws-plan ENV=aws-dev` | `terraform init` and `plan` with the current commit as `image_tag` |
| `make aws-deploy ENV=aws-dev` | The seven steps above |
| `make aws-migrate ENV=aws-dev` | Apply pending migrations as a one-off task |
| `scripts/aws-run-task.sh aws-dev migrate --status` | List applied and pending migrations, change nothing |
| `make aws-operator ENV=aws-dev EMAIL=you@example.com` | Create the first operator |

`ENV` defaults to `aws-dev`. The scripts take the region from `region` in tfvars unless
`AWS_REGION` is set.

## DNS and certificates

With `route53_zone_id`, Terraform requests the certificates (a regional one for the load
balancer, a `us-east-1` one for CloudFront), validates them through DNS, and creates the host
records pointing at CloudFront and the SES records (DKIM, the MAIL FROM MX and SPF, DMARC with
`dmarc_policy`, and the inbound MX when `inbound_domain` is set).

Without a Route 53 zone, set `certificate_arn` and `cdn_certificate_arn` and publish the records
these outputs list:

```bash
terraform -chdir=infra/terraform/envs/aws-dev output cdn_dns_records    # CNAME each host to its distribution
terraform -chdir=infra/terraform/envs/aws-dev output mail_dns_records   # DKIM CNAMEs, MAIL FROM MX + TXT, inbound MX
terraform -chdir=infra/terraform/envs/aws-dev output certificate_validation_records
```

The DMARC record is only created for you in Route 53; publish one yourself otherwise.

## SES

The SES domain identity verifies once its DKIM records resolve; with Route 53 that happens on
its own. Check it in the SES console, then:

- **Sandbox.** A new account can only mail verified addresses. Request production access
  before onboarding real tenants: tenant onboarding emails the first admin their temporary
  password.
- **Sender.** `AWS_SES_FROM_EMAIL` is `no-reply@<mail_domain>`
  (`terraform output mail_from`).
- **Delivery events** for per-tenant sending domains flow through the SNS topic and SQS queue
  the email module creates; nothing to configure.
- **Inbound mail** (optional, `inbound_domain`): SES receives mail only in some regions, and a
  region has one active receipt rule set, so enabling it replaces whatever rule set was active
  in that account and region.

## Provider keys

Every provider the API has no platform key for runs simulated, so the deployment boots with
none. Platform keys go in `provider_secrets`, a map from variable name to value; each key
becomes an environment variable of the API (names from [configuration.md](configuration.md)):
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_KEY`,
`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `TWILIO_*`, `RAZORPAY_*`,
`STRIPE_SECRET_KEY`, `RAZORPAY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and so on.

Values in `provider_secrets` land in Terraform state. To keep them out, pass `set-me` for each
key you want injected, apply, then replace the whole JSON by hand:

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform -chdir=infra/terraform/envs/aws-dev output -raw providers_secret_name)" \
  --secret-string '{"OPENAI_API_KEY":"<key>","TWILIO_ACCOUNT_SID":"<sid>","TWILIO_AUTH_TOKEN":"<token>"}'
```

Terraform never overwrites a secret value after it is created (`ignore_changes`), so values you
put in by hand stay. The secret only exists once at least one key is in `provider_secrets`.
ECS reads secrets when a task starts, so roll the API afterwards: run `make aws-deploy` again,
or

```bash
aws ecs update-service --cluster "$(terraform -chdir=infra/terraform/envs/aws-dev output -raw cluster_name)" \
  --service <the api service from: terraform output services> --force-new-deployment
```

On `aws-dev`, also set `simulate_providers = false`, or the keys are ignored for WhatsApp,
telephony, Razorpay, Stripe and platform billing.

Provider webhooks reach the API through the workspace host, `https://<domain>/api/v1/...`:

| Provider | URL |
| --- | --- |
| WhatsApp (shared Embedded Signup app) | `https://<domain>/api/v1/wa/webhooks/whatsapp` |
| Razorpay platform billing | `https://<domain>/api/v1/operator/webhooks/razorpay` |
| Stripe platform billing | `https://<domain>/api/v1/operator/webhooks/stripe` |
| Google Calendar OAuth redirect | `https://<domain>/api/v1/oauth/google/calendar/callback` |
| Exotel | Per workspace: the Telephony page shows its webhook URLs ([telephony-exotel.md](telephony-exotel.md)) |

In production the shared WhatsApp webhook answers 401 until `META_APP_SECRET` is set. The
"Connect WhatsApp" button (Meta Embedded Signup) needs `VITE_META_APP_ID`,
`VITE_META_WA_ES_CONFIG_ID` and `VITE_META_GRAPH_API_VERSION` exported in the shell that runs
`make aws-deploy`; the script passes them to the workspace app's build. Every
provider in detail: [connect-providers.md](connect-providers.md).

## First sign-in

```bash
make aws-operator ENV=aws-dev EMAIL=you@example.com
```

This runs `node dist-scripts/scripts/bootstrap-operator.js --email you@example.com` on the
migrate task definition ([`apps/api/scripts/bootstrap-operator.ts`](../../apps/api/scripts/bootstrap-operator.ts)).
It creates a `SUPERADMIN` operator with a generated password and prints the password once in
the task's log, which the script echoes to your terminal. When the email already exists it
changes nothing. The demo seed (`make demo`) is for local stacks only and refuses production.

Then:

1. Open `https://<console_domain>`, sign in, and change the password under **Profile** (the
   one-time password stays in CloudWatch Logs for the log retention period).
2. **Plans**: create the plans you sell with **New Plan** (modules and limits). A fresh
   database has none.
3. **Tenants**: **Onboard Tenant** creates a workspace on a plan with its first admin, who
   receives a temporary password by email ([operations.md](operations.md#onboarding-a-tenant)).
4. The admin signs in at `https://<domain>`.

## Updating

Commit, then `make aws-deploy ENV=aws-prod` again: a new image, pending migrations, a rolling
update of the API, then both apps. Migrations are forward-only and checksummed; an applied one
is never edited ([operations.md](operations.md#migrations-on-upgrade)). A bad image is rolled
back by the circuit breaker; redeploy an earlier commit with
`make aws-deploy ENV=aws-prod TAG=<commit>` (the image for that tag is rebuilt from your
working tree, so check out that commit first).

## Using real AWS from your laptop

`make up-aws` runs the local containers against real S3, SES and the SES event queue of an
`aws-dev` deployment, with Postgres and Redis still local. Copy
[`deploy/compose/.env.aws.example`](../../deploy/compose/.env.aws.example) to
`deploy/compose/.env.aws` and fill it from `terraform output` (`storage_bucket`, `mail_from`,
`ses_queues`). `AWS_SES_FROM_EMAIL` must be a verified SES sender, and the SES and SQS keys go
in `deploy/compose/.env` ([configuration.md](configuration.md#local-compose-variables)).

## Tearing down

`aws-dev` has no deletion protection: the database skips its final snapshot and the buckets
and image repository are deleted with their contents.

```bash
terraform -chdir=infra/terraform/envs/aws-dev destroy -var image_tag=unused
```

`aws-prod` has `deletion_protection = true`: the database and the load balancer refuse
deletion, RDS takes a final snapshot named `<name_prefix>-db-final`, and the file bucket and
image repository refuse to be deleted while they hold objects. To tear it down, set
`deletion_protection = false` in [`envs/aws-prod/main.tf`](../../infra/terraform/envs/aws-prod/main.tf),
apply, then destroy. Turning it off also turns off the final snapshot and lets the buckets go
with their contents, so take a manual RDS snapshot (and copy the files) first. Secrets stay recoverable for 30 days and the KMS key is scheduled for deletion after its
30-day window, so a new deployment with the same `name_prefix` cannot reuse those secret names
until the window ends.
