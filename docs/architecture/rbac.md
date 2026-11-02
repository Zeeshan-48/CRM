# Roles and access

Who inside a workspace can use what. The plan side (what the workspace bought) is in
[multi-tenancy-and-entitlements.md](multi-tenancy-and-entitlements.md). Paths are relative to
the repository root.

## 1. Access keys

Everything a role can hold is a string key from
[`constants/modules.const.ts`](../../apps/api/src/constants/modules.const.ts). There are two
kinds.

**Feature modules** (21). Each one is gated twice: the tenant must be entitled to
`module.<key>`, and the user's role must grant `<key>`.

| Group | Modules |
| --- | --- |
| Sales | `leads`, `contacts`, `accounts`, `deals` (Pipeline), `activities`, `calendar`, `products` |
| Conversations | `inbox`, `whatsapp`, `voice` (Telephony), `email` |
| Marketing | `campaigns` |
| Service | `tickets`, `kb` |
| Automation | `workflows`, `agents`, `copilot` |
| Insights | `analytics`, `finance` |
| Administration | `integrations`, `audit` |

**Governance capabilities** (4). Role only, no entitlement: every workspace has them whatever
its plan.

| Capability | Guards |
| --- | --- |
| `channels` | Provider and channel setup: email sending domains and sender identities, WhatsApp config, telephony config and numbers |
| `team` | Inviting, editing, removing users, resetting their passwords, creating and editing roles |
| `billing` | The workspace's own subscription (`/api/v1/billing`) |
| `settings` | Workspace settings (`PUT /tenant/me`), connected-product setup and keys, catalog writes from the CRM, ingest token rotation, security settings |

`MODULE_CATALOGUE` in the same file gives each key a label, a description and a group; the
role editor in the tenant app is built from it.

## 2. Built-in roles

Seven roles, defined in code as `ROLE_MODULES`. `*` means every key.

| Role | Feature modules | Governance |
| --- | --- | --- |
| `ADMIN` | `*` | `*` |
| `MANAGER` | leads, contacts, accounts, deals, activities, inbox, whatsapp, voice, email, campaigns, tickets, kb, calendar, workflows, copilot, agents, analytics, integrations, audit, products | channels, team |
| `SALES_AGENT` | leads, contacts, accounts, deals, activities, inbox, whatsapp, voice, calendar, copilot, agents, kb, products | none |
| `SUPPORT_AGENT` | tickets, kb, inbox, contacts, whatsapp, calendar, copilot | none |
| `MARKETING_AGENT` | campaigns, email, whatsapp, leads, analytics, copilot, agents, products | none |
| `HR` | kb, calendar, copilot | none |
| `FINANCE` | finance, analytics, accounts, copilot | none |

`ADMIN` and `MANAGER` are the **elevated** roles (`ELEVATED_ROLES`). Only an `ADMIN` may
invite, edit, reassign or remove a user who holds an elevated role, promote anyone into one,
or edit or reset the `MANAGER` role. The `ADMIN` role itself cannot be edited, a user cannot
delete their own account, and the last admin of a workspace cannot be removed
([`users.service.ts`](../../apps/api/src/services/users.service.ts)).

## 3. Custom roles and overrides

Stored in the `roles` table, one row per `(tenant_id, key)`
([`users.service.ts`](../../apps/api/src/services/users.service.ts)):

| Operation | Endpoint | Effect |
| --- | --- | --- |
| Create a custom role | `POST /api/v1/users/roles` | Key derived from the name (upper case, underscores); must not collide with a built-in key or an existing role. Every key in `permissions` must be a known module or capability, or the request is a 400 |
| Edit a custom role | `PUT /api/v1/users/roles/:key` | Name and permissions |
| Override a built-in role | `PUT /api/v1/users/roles/:key` with a built-in key | Upserts a row with `builtin=true` holding this tenant's module set for that role. Not allowed for `ADMIN` |
| Reset a built-in role | `DELETE /api/v1/users/roles/:key` with a built-in key | Deletes the override row; the role falls back to `ROLE_MODULES` |
| Delete a custom role | `DELETE /api/v1/users/roles/:key` | Refused (409) while any user holds it |
| Catalogue | `GET /api/v1/users/roles` | Built-in keys, custom roles, the effective module set of each built-in role, and which are customised |

All of these require the `team` capability. Every write calls `rbacService.invalidate(tenantId)`
on the worker that handled it.

### Per-user overrides

`permissions` on `POST /api/v1/users` and `PUT /api/v1/users/:id` replaces the role's module
set for that one user. `checkPermissionOverride` in
[`users.service.ts`](../../apps/api/src/services/users.service.ts) enforces two rules:

- only an `ADMIN` may set it (anyone else gets 403 `Only an admin can set per-user permissions.`);
- it must be an array of real module or capability keys, checked by `sanitizeCapabilities`
  like role permissions. Unknown keys, and `*`, are a 400.

Sending `null` or leaving it out keeps the role's modules. Covered by
[`tests/api/user-permissions.test.ts`](../../apps/api/tests/api/user-permissions.test.ts).

## 4. Resolution

`rbacService.getModulesForUser` ([`rbac.service.ts`](../../apps/api/src/services/rbac.service.ts))
returns the first of:

1. the user's own `users.permissions`, when it is a non-empty array (a per-user override);
2. the tenant's stored row for the user's role key (a custom role, or an override of a
   built-in role);
3. `ROLE_MODULES[role]` when the role is built-in;
4. nothing.

`canAccessModule(user, key)` is true when that list contains `*` or `key`. The `roles` rows of
a tenant are cached per worker for 60 seconds; the per-user override is read fresh on every
request, because `authenticateUser` loads `users.permissions` with the user row.

### Visible modules

Sign-in (`POST /api/v1/auth/login`) and `GET /api/v1/auth/me` return `user.modules`, computed
by `resolveVisibleModules` in [`auth.service.ts`](../../apps/api/src/services/auth.service.ts):

```text
entitled   = codes of enabled tenant_entitlements starting with "module."
if role modules contain "*":   modules = entitled + all governance capabilities
else:                          modules = (role modules that are in entitled)
                                       + (role modules that are governance capabilities)
```

Feature modules are the intersection of what the role grants and what the plan includes, so an
`ADMIN` on a smaller plan does not see navigation for modules the API would refuse.
Governance capabilities are never filtered by the plan. The tenant app builds its navigation
and route guards from this list ([`apps/web/src/routes.tsx`](../../apps/web/src/routes.tsx)).

## 5. Where each check runs

| Check | Middleware or code | Failure |
| --- | --- | --- |
| Tenant entitled to the module | `requireModule` then `entitlementsService.ensureModuleEnabled` | 403 `The <key> module is not included in this workspace's plan` |
| Role grants the module | `requireModule` then `rbacService.canAccessModule` | 403 `You do not have access to the <key> module` |
| Role holds a governance capability | `requireCapability(...)` | 403 `Your role does not allow this action` |
| User's role key is exactly one of a list | `requireRole(...)`: `ADMIN` for tenant payment gateway config (Razorpay, Stripe, the default gateway) and calendar working hours; `ADMIN` or `MANAGER` for adding and removing email suppressions | 403 |
| Record ownership | [`utils/record-policy.ts`](../../apps/api/src/utils/record-policy.ts) in the leads, contacts, accounts, deals, activities and calendar services | 403 |

`ADMIN` passes every RBAC check through `*` but never the entitlement gate: an admin on a plan
without `campaigns` gets the same 403 as anyone else.

`requireRole` compares the role key, not the module set. A custom role cannot be given the
`ADMIN`-only routes above, whatever its permissions.

### Record-level policy

Viewing and editing records is collaborative: anyone with the module sees and edits every
record of the tenant. Destructive and ownership-changing actions are narrower:

| Action | Allowed for |
| --- | --- |
| Delete a record | Its owner, or an elevated role |
| Reassign a record's owner | Its owner, anyone when it is unassigned, or an elevated role for any record |
| Bulk actions | Elevated roles only |

## 6. Operator roles

The operator plane has its own users (`operator_users`) and two roles. Every operator route
needs an operator token ([`operator-auth.middleware.ts`](../../apps/api/src/middlewares/operator-auth.middleware.ts));
creating and editing plans, onboarding and editing tenants, changing subscriptions and managing
operator users also need `SUPERADMIN` (`requireSuperadmin` in
[`routes/operator`](../../apps/api/src/routes/operator)). `OPERATOR` can read tenants, plans,
metrics, billing and the audit log.

## 7. Limits of the model

- **Role caches are per worker.** A role edit is visible at once on the worker that handled it
  and within 60 seconds on the others.
- **Role changes do not end sessions.** The JWT carries the role key, but the role and
  permissions are reloaded from the database on every request, so a demotion takes effect on
  the next request. A disabled user is refused at the next request too. There is no way to
  revoke a token itself ([security.md](security.md)).
