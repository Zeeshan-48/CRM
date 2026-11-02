# Low-level design

How the code is organised and how a request travels through it. The big picture is in
[HLD.md](HLD.md). Paths are relative to the repository root.

## 1. Repository layout

| Path | What it is |
| --- | --- |
| [`apps/api`](../../apps/api) | `@open-crm/api`: Express 5 API, background jobs, scripts, tests |
| [`apps/web`](../../apps/web) | `@open-crm/web`: the tenant SPA |
| [`apps/console`](../../apps/console) | `@open-crm/console`: the operator SPA |
| [`packages/sdk`](../../packages/sdk) | `@open-crm/sdk`: server-side ingest client |
| [`db`](../../db) | The SQL migrations and their runner |
| [`infra`](../../infra) | Dockerfiles and Terraform |
| [`deploy/compose`](../../deploy/compose) | Docker Compose files for local stacks |
| [`e2e`](../../e2e) | Playwright configuration |

One pnpm and Turborepo workspace ([`pnpm-workspace.yaml`](../../pnpm-workspace.yaml),
[`turbo.json`](../../turbo.json), [ADR 0001](adr/0001-monorepo-and-spa.md)).

## 2. API layers

Pattern: routes, controllers, services, repositories, Kysely.

| Layer | Folder | Rule |
| --- | --- | --- |
| Routes | [`apps/api/src/routes`](../../apps/api/src/routes) | Mount path and guards. [`routes/index.ts`](../../apps/api/src/routes/index.ts) is the single gating map for the tenant plane; [`routes/operator/index.ts`](../../apps/api/src/routes/operator/index.ts) for the operator plane |
| Controllers | [`apps/api/src/controllers`](../../apps/api/src/controllers) | Read `req`, call one service, answer with `sendSuccessResponse` ([`utils/response.util.ts`](../../apps/api/src/utils/response.util.ts)). No business rules |
| Services | [`apps/api/src/services`](../../apps/api/src/services) | Business rules, transactions, provider calls. Singletons (`export default new XService()`). Throw typed errors from [`errors/index.ts`](../../apps/api/src/errors/index.ts) |
| Repositories | [`apps/api/src/repositories`](../../apps/api/src/repositories) | Kysely queries only, every tenant query filtered by `tenant_id`. Mint ULID ids. Accept an optional transaction: `(trx \|\| db).selectFrom(...)` |
| Validators | [`apps/api/src/validators`](../../apps/api/src/validators) | zod schemas applied by `validateBody` ([`middlewares/validate.middleware.ts`](../../apps/api/src/middlewares/validate.middleware.ts)) on 12 of the route files: auth, leads, contacts, deals, campaigns, products, connected apps, ingest and the operator routes. The schemas reject bad input early but tolerate unknown keys and do not replace `req.body` |
| Jobs | [`apps/api/src/jobs`](../../apps/api/src/jobs) | Recurring sweeps and SQS consumers (section 5) |
| Database | [`apps/api/src/db`](../../apps/api/src/db) | Pool and Kysely instance ([`connection.ts`](../../apps/api/src/db/connection.ts)), generated types ([`types.ts`](../../apps/api/src/db/types.ts), [`enums.ts`](../../apps/api/src/db/enums.ts)), Redis client ([`redis.ts`](../../apps/api/src/db/redis.ts)) |

### Response and error envelope

Success: `{ data, statusCode, message, success: true }`. Errors go through
[`globalErrorHandler`](../../apps/api/src/middlewares/error-handler.middleware.ts):

```json
{ "success": false, "statusCode": 404, "error": { "message": "Lead not found" },
  "message": "route: /leads/01J..., errorMsg: Lead not found, rayId: ..." }
```

| Error class | Status |
| --- | --- |
| `BadRequestError` | 400 |
| `UnauthorizedError` | 401 |
| `ForbiddenError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `UnprocessableError` | 422 |
| `TooManyRequestError` | 429 |
| `InternalServerError` | 500 |

Each error gets a `rayId` that is also logged. An unexpected exception answers 500; in
production both `error.message` and the top-level `message` are generic (route, `INTERNAL
SERVER ERROR`, `rayId`); the exception text is only in the log.

### Time

`process.env.TZ = "UTC"` is set before any import in [`index.ts`](../../apps/api/src/index.ts)
and again in [`db/connection.ts`](../../apps/api/src/db/connection.ts), because `pg`
serialises `Date` with local getters. Columns are `timestamp(3)` without time zone; the pool
parses them as UTC (`setTypeParser(1114, ...)`).

### Database pool

[`db/connection.ts`](../../apps/api/src/db/connection.ts) builds one `pg.Pool` per worker from
the `PG_DATABASE_*` variables (`max` 8 in production, 10 otherwise, overridable with
`PG_POOL_MAX`; `statement_timeout` 30 s). The API does not read `DATABASE_URL`; the migration
runner does ([`db/migrate.ts`](../../db/migrate.ts)). Size the database's connection limit for
tasks times workers times `PG_POOL_MAX`.

## 3. The request pipeline

Order of middleware in [`app.ts`](../../apps/api/src/app.ts):

| Step | What | Notes |
| --- | --- | --- |
| 1 | `trust proxy` = `TRUST_PROXY` | Number of proxies in front (ALB 1, CloudFront plus ALB 2). Decides `req.ip` for rate limits |
| 2 | `GET /up` | Load balancer liveness, before everything else |
| 3 | CORS | `Access-Control-Allow-Origin` for origins in `CORS_ORIGINS` (default: `CRM_APP_URL` and `OPERATOR_APP_URL`; `*` is dropped), and for any origin on `/api/v1/ingest/*`. Other origins get no CORS headers. Allowed headers include `Authorization` and `X-API-Key`. `OPTIONS` answers 204 |
| 4 | `compression()` | |
| 5 | Raw-body webhook routers | `/api/v1/wa/webhooks`, `/api/v1/operator/webhooks`, `/api/v1/telephony/webhooks/exotel`. Before the JSON parser and before the global limiter |
| 6 | `express.json` and `urlencoded` | 10 MB limit |
| 7 | `helmet()` | Default headers, `Cross-Origin-Resource-Policy: cross-origin` |
| 8 | `GET /local-files/*key` | Local-disk downloads, valid only with an unexpired HMAC signature |
| 9 | `GET /api/health` | JSON health |
| 10 | `globalApiLimiter` | 600 requests per minute per IP ([`rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts)) |
| 11 | `/api/v1/ingest` | API-key auth per route ([`api-key.middleware.ts`](../../apps/api/src/middlewares/api-key.middleware.ts)) |
| 12 | `/api/v1/operator` | Operator JWT per route group ([`operator-auth.middleware.ts`](../../apps/api/src/middlewares/operator-auth.middleware.ts)) |
| 13 | `/api/v1` | Tenant routes (below) |
| 14 | 404, then `globalErrorHandler` | |

Tenant route groups are mounted by one of three helpers in
[`routes/index.ts`](../../apps/api/src/routes/index.ts):

| Helper | Chain | Groups |
| --- | --- | --- |
| none (public) | route only | `/auth`, `/unsubscribe`, `/oauth/google`, `/public/booking` |
| `A(path, router)` | `authenticateUser` | `/tenant`, `/users`, `/notifications`, `/search`, `/views`, `/reminders`, `/billing` |
| `M(path, module, router)` | `authenticateUser`, `requireModule(module)` | Every feature module, for example `M("/deals", "deals", ...)`. Channel setup routes are gated on the module they serve: the `/email-*` groups on `email`, `/telephony` on `voice`; `/connected-apps`, `/products` and `/signals` on `products` |

`authenticateUser` ([`auth.middleware.ts`](../../apps/api/src/middlewares/auth.middleware.ts))
verifies the JWT (`type` must be `tenant`), then loads the user joined to the tenant with
both `users.id` and `users.tenant_id` from the token. A user who is not `ACTIVE` gets 401; a
tenant that is not `ACTIVE` gets 403. It sets `req.authUser`, `req.tenantId` and `req.tenant`.
There is one database read per authenticated request for this.

`requireModule` ([`module.middleware.ts`](../../apps/api/src/middlewares/module.middleware.ts))
runs two checks in order: `entitlementsService.ensureModuleEnabled` (403 when the plan does
not include `module.<key>`), then `rbacService.canAccessModule` (403 when the role does not
grant it). Inside a group, `requireCapability("channels" | "team" | "billing" | "settings")`
guards setup and administration routes by role only, and a few routes use
`requireRole("ADMIN")` or `requireRole("ADMIN", "MANAGER")` ([rbac.md](rbac.md)).

Write paths on leads, contacts, accounts, deals, activities and calendar also go through
[`utils/record-policy.ts`](../../apps/api/src/utils/record-policy.ts): delete needs ownership
or an elevated role, reassignment is allowed for your own or unassigned records, bulk actions
are elevated only.

## 4. Rate limits

Fixed windows in [`rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts),
counted in Redis when `REDIS_URL` is set and in process memory otherwise
([`rate-limit.service.ts`](../../apps/api/src/services/rate-limit.service.ts)). A Redis error
fails open. Every limiter is off under tests and when `RATE_LIMIT_ENABLED=false`.

| Limiter | Window | Max | Key |
| --- | --- | --- | --- |
| `globalApiLimiter` | 1 min | 600 | IP |
| `loginIpLimiter`, `loginEmailLimiter` | 5 min | 10, 5 | IP, email |
| `forgotIpLimiter`, `forgotEmailLimiter` | 15 min | 5, 3 | IP, email |
| `resetPasswordLimiter` | 15 min | 10 | IP |
| `changePasswordLimiter` (operator) | 15 min | 10 | operator |
| `publicBookingLimiter` | 60 min | 10 | IP |
| `leadIngestLimiter` | 1 min | 120 | API key, URL token or IP |
| `activityEventsLimiter` | 1 min | 120 | API key, URL token or IP |
| `catalogSyncLimiter` | 1 min | 30 | API key, URL token or IP |
| `trackerLimiter` | 1 min | 240 | API key and IP. Applied to `POST /ingest/identify` and `POST /ingest/events` for publishable keys only (`browserLimiter` in [`routes/ingest.route.ts`](../../apps/api/src/routes/ingest.route.ts)), before `activityEventsLimiter` |
| `llmLimiter` (copilot ask, agent run) | 1 min | 20 | user |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and
`Retry-After` on a 429.

## 5. Jobs

[`index.ts`](../../apps/api/src/index.ts) forks the cluster; the worker started with
`RUN_JOBS=true` calls `startJobs()` ([`jobs/index.ts`](../../apps/api/src/jobs/index.ts)):
the SES events consumer, the SES inbound consumer, then the scheduler
([`jobs/scheduler.ts`](../../apps/api/src/jobs/scheduler.ts)). With Redis, each entry in
[`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts) becomes a BullMQ job scheduler on the
`crm-jobs` queue (concurrency 4), and schedulers for removed jobs are deleted at boot. Without
Redis, each runs on `setInterval`. Every job is a "find due rows, process" sweep, safe to rerun.

| Job | Every | Does |
| --- | --- | --- |
| `verify-domains` | 1 min | Rechecks `PENDING` email sending domains against SES and records transitions; a no-op while SES is simulated (`AWS_SES_FROM_EMAIL` unset) |
| `reputation-recovery` | 10 min | Recovery sweep for tenants whose email sending was throttled or paused on reputation |
| `health-sweep` | 24 h | Rechecks `VERIFIED` sending domains; a domain broken across two checks more than 24 h apart is failed and sends revert to the platform sender |
| `calls-poll` | 15 s | Polls Twilio for the final status and duration of calls in progress (no webhook needed) |
| `exotel-sync` | 30 s | Safety net for Exotel: fetches the state of calls whose callback never arrived and retries the recording mirror |
| `meeting-reminders` | 1 min | One reminder (email and WhatsApp) per lead or contact meeting, idempotent on `reminder_sent_at` |
| `task-reminders` | 1 h | Daily reminder emails for open tasks with `remind_daily`, at most one per task per day |
| `sales-agent-runner` | 5 min | For tenants that opted in: enrols leads from fresh signals and advances due sequence touches, auto-sending only when enabled |
| `payments-poll` | 30 s | Polls pending tenant payment links and sessions (Razorpay, Stripe) and marks paid invoices `PAID` |
| `billing-sweep` | 1 h | Platform billing safety net: expires lapsed subscriptions past grace, suspends the workspace, reconciles plan entitlements |
| `billing-payment-poll` | 30 s | Confirms `MANUAL` platform payments by polling the gateway (payment links, checkout sessions) |
| `catalog-pull` | 10 min | Refetches PULL-mode product catalogs older than an hour |
| `engagement-rollup` | 15 min | Recomputes intent so it decays without new events |
| `webhook-dispatch` | 15 s | Claims and sends queued outbound webhook deliveries |

Channel-specific jobs are described in [channels.md](channels.md), billing jobs in
[platform-billing.md](platform-billing.md), product jobs in
[product-integration.md](product-integration.md).

## 6. Process lifecycle

The primary restarts a dead worker, at most 10 times per 60 seconds, and keeps the jobs role
on the replacement. On `SIGTERM` or `SIGINT` each worker stops jobs (if it owns them), stops
accepting connections, closes Redis and the pool, and exits; a 30 second timer forces exit.
`keepAliveTimeout` is 65 s, above the ALB's 60 s default idle timeout. `EPIPE` and
`ECONNRESET` are ignored; any other uncaught exception exits the worker and the primary forks
a new one. Production refuses to boot on development secrets (`assertProductionConfig` in
[`config/index.ts`](../../apps/api/src/config/index.ts), [security.md](security.md#10-the-production-guard)).

## 7. Side effects that are not transactional

Audit rows (`engineService.audit`) and notifications (`engineService.notify`) are inserted
without being awaited and outside any business transaction; a failed write is logged and
dropped ([`engine.service.ts`](../../apps/api/src/services/engine.service.ts)). Workflow runs
triggered by `emit` execute in the request process after the business write commits; in the
leads, deals and tickets paths `emit` is awaited, so an engine error can fail a request whose
data is already saved. There
is no outbox: if the process dies between the commit and the side effect, the side effect is
lost ([automation-engine.md](automation-engine.md)). Outbound webhooks are the exception: they
are written as `webhook_deliveries` rows and sent with retries by the `webhook-dispatch` job.

## 8. Frontends

Both SPAs are React 19 with Vite, React Router 7, TanStack Query 5, Zustand 5, Tailwind 3 and
Radix primitives ([`apps/web/package.json`](../../apps/web/package.json),
[`apps/console/package.json`](../../apps/console/package.json)).

| Concern | Tenant app | Operator console |
| --- | --- | --- |
| Routes | [`apps/web/src/routes.tsx`](../../apps/web/src/routes.tsx) | [`apps/console/src/routes.tsx`](../../apps/console/src/routes.tsx) |
| Session | [`stores/auth-store.ts`](../../apps/web/src/stores/auth-store.ts), persisted as `crm-auth` | [`stores/auth-store.ts`](../../apps/console/src/stores/auth-store.ts), persisted as `operator-auth` |
| API client | [`lib/api/client.ts`](../../apps/web/src/lib/api/client.ts) (Axios, `VITE_API_BASE_URL`, default `http://localhost:5066/api/v1`) | [`lib/api/client.ts`](../../apps/console/src/lib/api/client.ts) (default `http://localhost:5066/api/v1/operator`) |
| Dev server | Vite on port 3570 ([`vite.config.ts`](../../apps/web/vite.config.ts)) | Vite on port 3580 ([`vite.config.ts`](../../apps/console/vite.config.ts)) |
| UI kit | [`components/ui`](../../apps/web/src/components/ui) | [`components/ui`](../../apps/console/src/components/ui) (a smaller copy) |
| Branding | The tenant's `brand_color` from the sign-in response; default accent in [`lib/brand.ts`](../../apps/web/src/lib/brand.ts) | [`lib/brand.ts`](../../apps/console/src/lib/brand.ts) |

The tenant app's navigation and route guards read `user.modules` from the sign-in or
`/auth/me` response. The API enforces the same gates, so a hidden page is also a refused
request. Server state lives in TanStack Query; Zustand holds only the session and UI state.
