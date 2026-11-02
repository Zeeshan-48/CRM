import entitlementsRepository from "../../repositories/operator/entitlements.repository";
import plansRepository from "../../repositories/operator/plans.repository";
import subscriptionsRepository from "../../repositories/operator/subscriptions.repository";
import tenantsRepository from "../../repositories/operator/tenants.repository";
import type { subscription_status } from "../../db/enums";
import logger from "../../utils/logger";
import entitlementsService from "../entitlements.service";
import { planSnapshotSpecs } from "./plan-snapshot";

// Subscription states that keep the tenant's plan entitlements in place.
//  - PENDING: onboarding, awaiting first payment. The workspace is SUSPENDED, so
//    tenant status already blocks access; stripping the freshly-written snapshot
//    here would be pure churn.
//  - PAST_DUE: inside the grace window, access is intentionally retained.
//  - GRANDFATHERED: legacy tenants, never billed.
// Everything else (CANCELED, EXPIRED, PAUSED) revokes.
const ENTITLED_STATUSES: subscription_status[] = [
  "PENDING",
  "ACTIVE",
  "PAST_DUE",
  "GRANDFATHERED",
];

/**
 * Reconciles a tenant's plan-sourced entitlements with its subscription state.
 *
 * Before this existed, a lapsed or canceled subscription only flipped
 * `tenants.status` to SUSPENDED, the plan entitlements stayed fully intact, so
 * anything that set the tenant back to ACTIVE silently restored paid access.
 * Enforcement now has two legs instead of one.
 *
 * Properties that make this safe to call from anywhere:
 *  - Idempotent. Derives the desired state from the DB every time, so repeated
 *    or out-of-order calls converge. That also lets the hourly sweep re-run it
 *    across all tenants to self-heal a transition we forgot to hook.
 *  - Never touches a tenant with no subscription row at all (comp / legacy).
 *  - Only ever deletes `source: PLAN` rows. An operator's ADMIN override is a
 *    deliberate grant and survives a lapse untouched, and, because
 *    insertPlanSnapshot is onConflict-do-nothing, survives reinstatement too.
 *  - Reinstating is a no-op when plan rows are already present, so an ACTIVE
 *    tenant's entitlements are never rewritten out from under a live request.
 *
 * Never throws: entitlement drift must not fail a webhook or a billing sweep.
 * A failure leaves the previous state, and the next sync call repairs it.
 */
class EntitlementsSyncService {
  async sync(tenantId: string): Promise<void> {
    try {
      await this.reconcile(tenantId);
    } catch (err) {
      logger.error(`entitlements sync failed for tenant ${tenantId}: ${String(err)}`);
    }
  }

  private async reconcile(tenantId: string): Promise<void> {
    const sub = await subscriptionsRepository.currentForTenant(tenantId);
    // No subscription has ever existed: a comp/manual tenant whose entitlements
    // are operator-managed. Not ours to revoke.
    if (!sub) return;

    const entitled = ENTITLED_STATUSES.includes(sub.status);

    if (!entitled) {
      const rows = await entitlementsRepository.listByTenant(tenantId);
      if (!rows.some((r) => r.source === "PLAN")) return; // already revoked
      await entitlementsRepository.deletePlanSourced(tenantId);
      entitlementsService.invalidate(tenantId);
      logger.info(
        `entitlements revoked for tenant ${tenantId} (subscription ${sub.status})`
      );
      return;
    }

    // Entitled. Only act when the plan rows are missing (i.e. a previous lapse
    // revoked them and payment has now reinstated the subscription).
    const rows = await entitlementsRepository.listByTenant(tenantId);
    if (rows.some((r) => r.source === "PLAN")) return;

    const tenant = await tenantsRepository.findById(tenantId);
    const planKey = tenant?.plan_key ?? sub.plan_key;
    if (!planKey) {
      logger.warn(`entitlements sync: tenant ${tenantId} has no plan_key; nothing to reinstate`);
      return;
    }
    const plan = await plansRepository.findByKey(planKey);
    if (!plan) {
      logger.warn(`entitlements sync: plan ${planKey} not found for tenant ${tenantId}`);
      return;
    }

    await entitlementsRepository.insertPlanSnapshot(tenantId, planSnapshotSpecs(plan));
    entitlementsService.invalidate(tenantId);
    logger.info(`entitlements reinstated for tenant ${tenantId} on plan ${planKey}`);
  }
}

export default new EntitlementsSyncService();
