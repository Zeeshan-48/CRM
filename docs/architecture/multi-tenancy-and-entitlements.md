# Multi-tenancy and entitlements

One deployment serves many tenants (workspaces) from one Postgres schema. Every tenant
row carries a `tenant_id`; what a tenant may use is decided at runtime by its
`tenant_entitlements` rows, never by reading its plan. Paths are relative to the
repository root. Decisions: [ADR 0002](adr/0002-multi-tenant-shared-schema.md),
[ADR 0003](adr/0003-entitlements-first.md). Roles and permissions inside a tenant:
[rbac.md](rbac.md).

## 1. The two planes

| Plane | Prefix | Who | Scope |
| --- | --- | --- | --- |
| Tenant | `/api/v1/*` | Users of one workspace (`users` rows), served by `apps/web` | Exactly one tenant, from the token |
| Operator | `/api/v1/operator/*` | The people running the deployment (`operator_users`), served by `apps/console` | Platform-wide: plans, tenants, billing, audit |

Both are in the same API process ([`apps/api/src/app.ts`](../../apps/api/src/app.ts)). The
operator router is mounted before the tenant router so routes with the same name
(`/auth`, `/audit`, `/tenants`) never collide.

## 2. Shared schema

72 tables in [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma). Five
are platform tables with no `tenant_id`: `tenants`, `plans`, `operator_users`,
`plan_gateway_refs`, `platform_webhook_events`. `operator_audit_logs` has a nullable
`tenant_id` (an operator action may concern no tenant). Every other table has a
required `tenant_id` with a foreign key to `tenants` and `onDelete: Cascade`, so deleting
a tenant removes all of its data. Indexes lead with `tenant_id`
(`@@index([tenant_id, status])` and similar), and natural keys are unique per tenant
(`users @@unique([tenant_id, email])`, `roles @@unique([tenant_id, key])`).

The same email can therefore exist in several tenants. Login tries every account with
that email and prefers an active one in an active tenant
([`apps/api/src/services/auth.service.ts`](../../apps/api/src/services/auth.service.ts)).

## 3. How a request gets its tenant

The tenant never comes from a URL parameter or a body field.

| Caller | How the tenant is resolved | Code |
| --- | --- | --- |
| Workspace user | Bearer JWT with `type: "tenant"`, `id`, `tenantId`. The middleware then loads the user joined to its tenant `WHERE users.id = :id AND users.tenant_id = :tenantId` and sets `req.authUser`, `req.tenantId`, `req.tenant` | [`apps/api/src/middlewares/auth.middleware.ts`](../../apps/api/src/middlewares/auth.middleware.ts), [`apps/api/src/utils/jwt.util.ts`](../../apps/api/src/utils/jwt.util.ts) |
| Connected product (ingest) | `crm_sk_` or `crm_pk_` key, looked up by SHA-256 hash; the key row gives the tenant and exactly one connected product | [`apps/api/src/middlewares/api-key.middleware.ts`](../../apps/api/src/middlewares/api-key.middleware.ts) |
| No-code form tool | `POST /api/v1/ingest/leads/t/:token`, the token matched against `tenants.config.ingestToken` | [`apps/api/src/services/ingest.service.ts`](../../apps/api/src/services/ingest.service.ts) `tenantForToken` |
| WhatsApp webhook | Shared callback: tenant found by the entry's WABA id; legacy path: per-tenant URL token | [`apps/api/src/routes/wa-webhook.route.ts`](../../apps/api/src/routes/wa-webhook.route.ts), [`apps/api/src/controllers/wa-webhook.controller.ts`](../../apps/api/src/controllers/wa-webhook.controller.ts) |
| Exotel webhook | Per-tenant unguessable token in the path, matched against `tenant_telephony.webhook_token` | [`apps/api/src/routes/exotel-webhook.route.ts`](../../apps/api/src/routes/exotel-webhook.route.ts), [`apps/api/src/repositories/telephony.repository.ts`](../../apps/api/src/repositories/telephony.repository.ts) |
| Google OAuth callback | HMAC-signed `state` | [`apps/api/src/routes/google-oauth.route.ts`](../../apps/api/src/routes/google-oauth.route.ts) |
| Operator | Bearer JWT with `type: "operator"`; no tenant | [`apps/api/src/middlewares/operator-auth.middleware.ts`](../../apps/api/src/middlewares/operator-auth.middleware.ts) |

Tenant and operator tokens are signed with the same `JWT_SECRET` but carry a different
`type`, and each verifier refuses the other's tokens.

## 4. Scoping inside the code

Controllers pass `req.tenantId` (or `req.authUser.tenantId`) to services, and repositories
put it in the `WHERE` clause of every read and write. For example
[`apps/api/src/repositories/leads.repository.ts`](../../apps/api/src/repositories/leads.repository.ts):

```ts
async findById(id: string, tenantId: string) {
  return db.selectFrom("leads").selectAll()
    .where("id", "=", id)
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
}
```

A row that belongs to another tenant is therefore indistinguishable from a missing one,
and services answer `404` (`NotFoundError("Deal not found")` in
[`apps/api/src/services/deals.service.ts`](../../apps/api/src/services/deals.service.ts),
and the same pattern across services). The API suites check this with the second seeded
tenant (`ACME_ADMIN` in [`apps/api/tests/helpers.ts`](../../apps/api/tests/helpers.ts)).

There is no database-level row security: isolation depends on every repository query
carrying `tenant_id`. Code that looks rows up without a tenant (webhook resolution,
`findByIdUnscoped` for connected products, the jobs that sweep all tenants) is named or
commented as such.

## 5. Tenant status

`tenant_status` is `ACTIVE`, `SUSPENDED` or `CLOSED`.

- Login refuses a non-active tenant with `403` "This workspace is suspended"
  ([`auth.service.ts`](../../apps/api/src/services/auth.service.ts)).
- `authenticateUser` checks the tenant's status on every request, so a suspension takes
  effect on the next call even for a token issued before it.
- The form-tool ingest token refuses a non-active tenant.
- Platform billing suspends a tenant on cancel or after the dunning grace window and
  reactivates it on payment ([platform-billing.md](platform-billing.md)).

Ingest calls authenticated with an API key stop with the tenant too: `findActiveApiKeyByHash`
([`integrations.repository.ts`](../../apps/api/src/repositories/integrations.repository.ts))
joins `tenants` and requires `status = 'ACTIVE'`, so a suspended or closed workspace's keys
answer 401. The no-code URL token path checks the tenant's status as well.

## 6. Onboarding a tenant

The operator onboards from the console, `POST /api/v1/operator/tenants` (`SUPERADMIN`
only), in [`apps/api/src/services/operator/tenants.service.ts`](../../apps/api/src/services/operator/tenants.service.ts):

1. Validates that `plan_key` names an active plan; derives a unique slug from the name.
2. In one transaction: inserts the tenant (name, slug, domain, industry, `plan_key`,
   optional `brand_color`), snapshots the plan into `tenant_entitlements`, creates the
   first `ADMIN` user (bcrypt cost 12; a random password when none is given), and creates
   the default "Sales Pipeline" with the stages from
   [`apps/api/src/constants/deal-stages.const.ts`](../../apps/api/src/constants/deal-stages.const.ts).
3. Optionally starts a paid subscription and suspends the tenant until it is paid.
4. Emails the admin their credentials (fire and forget; the response says whether email is
   configured).

Operators can also edit a tenant (`PUT /api/v1/operator/tenants/:id`: name, brand colour,
status, plan) and override one entitlement (`PUT /api/v1/operator/tenants/:id/entitlements`).
Every operator action is written to `operator_audit_logs`.

## 7. Plans and the snapshot

A plan (`plans`) is a sales artifact: `key`, `name`, `price_monthly`, `modules` (JSON list
of module keys) and `limits` (JSON). Creating or editing a plan never changes an existing
tenant ([`apps/api/src/services/operator/plans.service.ts`](../../apps/api/src/services/operator/plans.service.ts)).

The plan becomes runtime state only through
[`apps/api/src/services/operator/plan-snapshot.ts`](../../apps/api/src/services/operator/plan-snapshot.ts)
`planSnapshotSpecs(plan)`, which produces:

| Code | `enabled` | `limit_value` |
| --- | --- | --- |
| `module.<key>` for every module in the plan | `true` | `null` |
| `limit.seats` | `true` | `limits.seats`, or 0 |
| `limit.leads` | `true` | `limits.leads`, or 0 |
| `limit.ai_credits_monthly` | `true` | `limits.ai_credits_monthly`, or 0 |
| `limit.connected_apps`, only when the plan includes `products` | `true` | `limits.connected_apps`, or `null` (uncapped) |

The snapshot is written at onboarding, on a plan change, and when a lapsed subscription is
reinstated ([`entitlements-sync.service.ts`](../../apps/api/src/services/operator/entitlements-sync.service.ts)).
The seed uses the same function ([`apps/api/scripts/seed.ts`](../../apps/api/scripts/seed.ts)).

### Sources: PLAN and ADMIN

`tenant_entitlements` is unique on `(tenant_id, code)` and has a `source`
(`entitlement_source`: `PLAN` or `ADMIN`).

- Snapshot rows are inserted as `PLAN` with `ON CONFLICT DO NOTHING`, so an existing row
  for the same code is never overwritten.
- An operator override upserts the row and sets `source = ADMIN`
  ([`apps/api/src/repositories/operator/entitlements.repository.ts`](../../apps/api/src/repositories/operator/entitlements.repository.ts)).
- A plan change deletes the `PLAN` rows and re-snapshots; `ADMIN` rows survive. A billing
  lapse deletes only `PLAN` rows too. An override is a deliberate grant (or denial) that
  outlives plan changes and lapses until an operator changes it.

## 8. Module codes

The 21 feature modules are listed in
[`apps/api/src/constants/modules.const.ts`](../../apps/api/src/constants/modules.const.ts)
(`MODULES`): `leads`, `contacts`, `accounts`, `deals`, `activities`, `inbox`, `whatsapp`,
`voice`, `email`, `campaigns`, `tickets`, `kb`, `calendar`, `workflows`, `copilot`,
`agents`, `analytics`, `finance`, `products`, `integrations`, `audit`. Their entitlement
code is `module.<key>`.

Every module-gated route group in [`apps/api/src/routes/index.ts`](../../apps/api/src/routes/index.ts)
is mounted with `M(path, moduleKey, router)`, which runs `authenticateUser` and then
`requireModule(moduleKey)` ([`apps/api/src/middlewares/module.middleware.ts`](../../apps/api/src/middlewares/module.middleware.ts)):

1. **Entitlement**: `module.<key>` must exist with `enabled = true`, else `403` "The
   `<key>` module is not included in this workspace's plan". No role bypasses this,
   `ADMIN` included.
2. **RBAC**: the user's role must grant the module ([rbac.md](rbac.md)).

Channel setup routes are gated on the module they serve: the email sending domains,
identities, message log, suppressions and reputation routes on `email`, telephony on
`voice`. The product integration routes (`/connected-apps`, `/products`, `/signals`) all
sit on `products`.

The four governance capabilities (`channels`, `team`, `billing`, `settings`) have no
entitlement; every workspace has them and only RBAC decides
(`requireCapability`).

The plan editor in the operator plane accepts only keys from `MODULES`
(`validateModules` in [`plans.service.ts`](../../apps/api/src/services/operator/plans.service.ts)).

## 9. Limits and where they are enforced

`entitlementsService.getLimit(tenantId, code)` returns `null` when the code is absent or
disabled, `Infinity` when `limit_value` is `null`, and the number otherwise.
`ensureCapacity(tenantId, code, currentUsage, requested)` throws `403` "Workspace ...
limit reached" when `currentUsage + requested` exceeds the limit, and does nothing when
the code is absent ([`apps/api/src/services/entitlements.service.ts`](../../apps/api/src/services/entitlements.service.ts)).

| Code | Enforced | Where |
| --- | --- | --- |
| `limit.seats` | Yes, on inviting a user | [`apps/api/src/services/users.service.ts`](../../apps/api/src/services/users.service.ts) (count of the tenant's users) |
| `limit.leads` | Yes, on creating a lead and on bulk import | [`apps/api/src/services/leads.service.ts`](../../apps/api/src/services/leads.service.ts) `create` and `bulkImport`. Ingest and identity resolution create leads through `leadsService.create`, so they are covered |
| `limit.connected_apps` | Yes, on connecting a product | [`apps/api/src/services/connected-apps.service.ts`](../../apps/api/src/services/connected-apps.service.ts) |
| `limit.ai_credits_monthly` | **No** | Snapshotted, shown in the onboarding email and in the workspace's `GET /api/v1/tenant/me` response, but nothing counts or checks AI usage |

Two more gaps, stated plainly:

- The public booking flow in [`apps/api/src/services/calendar.service.ts`](../../apps/api/src/services/calendar.service.ts)
  creates leads with `leadsRepository.create` directly, so a booking can create a lead past
  `limit.leads`.
- The operator plan editor validates only `seats`, `leads` and `ai_credits_monthly`
  (`LIMIT_FIELDS` in [`plans.service.ts`](../../apps/api/src/services/operator/plans.service.ts)),
  so a plan created or edited through the API has no `connected_apps` limit and the snapshot
  grants connected products uncapped. The seeded plans carry it because the seed writes
  plan rows directly. An operator can still cap a tenant with an override on
  `limit.connected_apps`.

Usage counts are live `COUNT` queries at check time, not counters; two concurrent creates
can both pass the check at the boundary.

## 10. Caching and staleness

`entitlementsService.getAll` caches each tenant's rows for 60 seconds in a `Map` inside the
process. The RBAC role map is cached the same way ([rbac.md](rbac.md)). In production the
API runs one Node cluster worker per CPU ([`apps/api/src/index.ts`](../../apps/api/src/index.ts)),
and each has its own cache.

- `invalidate(tenantId)` clears only the calling worker's entry. It is called by the
  entitlement sync when it actually adds or removes rows, and by the workspace's own
  settings update.
- An operator override or plan change is not followed by an invalidation of its own.

So after any entitlement change, other workers (and other API tasks) can keep serving the
old answer for up to 60 seconds. Tenant status is not cached: it is read on every request
by `authenticateUser`, so a suspension is immediate.

## 11. What the client sees

Login and `GET /api/v1/auth/me` return `user.modules`, computed by `resolveVisibleModules`
in [`auth.service.ts`](../../apps/api/src/services/auth.service.ts): the feature modules
that are both entitled and granted by the role, plus the governance capabilities the role
grants. The web app uses it for navigation and route guards
([`apps/web/src/components/layout/nav.ts`](../../apps/web/src/components/layout/nav.ts),
[`apps/web/src/routes.tsx`](../../apps/web/src/routes.tsx)). It is a convenience; the API
gates every request again. `GET /api/v1/tenant/me` returns the entitled modules, the limits and
current usage ([`apps/api/src/services/tenants.service.ts`](../../apps/api/src/services/tenants.service.ts)).

## 12. Per-tenant branding

`tenants.brand_color` (default `#0a66c2`) is set at onboarding, by an operator, or by the
workspace in Settings. The login and `me` payloads carry it, and the web app paints it into
the `--brand` CSS variable, adjusting lightness until it reaches 4.5:1 contrast against the
light or dark canvas ([`apps/web/src/stores/auth-store.ts`](../../apps/web/src/stores/auth-store.ts)).
The seeded tenants use `#0a66c2` (Northwind Academy) and `#1d4ed8` (Acme Robotics).
`tenants` also holds `domain`, `email_domain`, `white_label` and a `config` JSON for
workspace preferences, which the workspace update shallow-merges.
