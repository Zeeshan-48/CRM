# ADR 0003: Entitlements are the runtime source of truth; plans are snapshotted

## Status

Accepted.

## Context

The operator sells plans (Starter, Growth, Enterprise in the demo seed). A plan lists
modules and limits and has a price. Plans change over time: a module is added to Growth,
a limit is raised, a plan is retired. Tenants already on a plan should not change
underneath them when the operator edits it, and the operator needs to grant or withhold
one feature for one tenant without inventing a plan for it.

If the runtime read the plan on every request, every plan edit would be a silent change to
every tenant on it, and per-tenant exceptions would need special cases in the gate.

## Decision

- Runtime code never reads `plans`. It reads `tenant_entitlements` only
  ([`apps/api/src/services/entitlements.service.ts`](../../../apps/api/src/services/entitlements.service.ts)).
- A plan is copied into entitlement rows by one function,
  [`planSnapshotSpecs`](../../../apps/api/src/services/operator/plan-snapshot.ts):
  `module.<key>` per module, plus `limit.seats`, `limit.leads`, `limit.ai_credits_monthly`
  and, when the plan includes `products`, `limit.connected_apps`. It runs at onboarding, on
  a plan change, and when a lapsed subscription is paid again. Editing a plan never touches
  existing tenants ([`apps/api/src/services/operator/plans.service.ts`](../../../apps/api/src/services/operator/plans.service.ts)).
- Each row has a `source`: `PLAN` (from the snapshot) or `ADMIN` (an operator override).
  Snapshots never overwrite an existing row, and plan changes and billing lapses delete only
  `PLAN` rows, so overrides persist.
- Every module-gated route checks the entitlement first and RBAC second
  ([`apps/api/src/middlewares/module.middleware.ts`](../../../apps/api/src/middlewares/module.middleware.ts)).
  No role, `ADMIN` included, passes a module the tenant is not entitled to.
- Platform billing controls access by removing and restoring the `PLAN` rows, in addition
  to suspending the tenant ([`apps/api/src/services/operator/entitlements-sync.service.ts`](../../../apps/api/src/services/operator/entitlements-sync.service.ts)).

Details: [multi-tenancy-and-entitlements.md](../multi-tenancy-and-entitlements.md),
[platform-billing.md](../platform-billing.md).

## Consequences

Positive:

- Plan edits are safe: existing customers keep what they bought until the operator moves
  them.
- Per-tenant exceptions are data (one override row), not code.
- The gate is one indexed lookup per tenant, cached.

Trade-offs:

- Moving every tenant on a plan to its new definition is an explicit plan change per
  tenant; there is no bulk "re-snapshot all" action.
- Entitlements are cached for 60 seconds per process, so a change can take up to a minute
  to reach every worker.
- Some limits are snapshotted but not enforced: `limit.ai_credits_monthly` is never
  checked, and the operator plan editor cannot set `limit.connected_apps`. Both are listed
  in [multi-tenancy-and-entitlements.md](../multi-tenancy-and-entitlements.md).

## Alternatives considered

- **Read the plan at runtime.** Simpler storage, but every plan edit changes every tenant
  on it, and overrides need a second mechanism.
- **Version plans and pin tenants to a version.** Gives the same stability, but still
  needs an override mechanism and makes the gate join plans, versions and overrides on
  every request.
