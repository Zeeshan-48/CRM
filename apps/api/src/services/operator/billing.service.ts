import config from "../../config";
import { BadRequestError, NotFoundError } from "../../errors";
import planGatewayRefsRepository from "../../repositories/operator/plan-gateway-refs.repository";
import platformTransactionsRepository, {
  PlatformTransactionRow,
} from "../../repositories/operator/platform-transactions.repository";
import plansRepository from "../../repositories/operator/plans.repository";
import subscriptionsRepository, {
  SubscriptionRow,
} from "../../repositories/operator/subscriptions.repository";
import tenantsRepository from "../../repositories/operator/tenants.repository";
import usersRepository from "../../repositories/operator/users.repository";
import auditService, { AuditActor } from "./audit.service";
import entitlementsSyncService from "./entitlements-sync.service";
import platformGateway, {
  BILLING_GATEWAYS,
  isBillingGateway,
} from "./platform-gateway.service";

export interface CreateSubscriptionResult {
  subscription: SubscriptionRow;
  checkoutUrl: string | null;
}

const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

// Platform billing orchestration (operator tier). Subscribes tenants on the operator's
// gateway account, cancels/suspends, and reports metrics. Webhook-driven state
// transitions live in the webhook handler (applyWebhook), see Phase 4.
class BillingService {
  async getForTenant(tenantId: string): Promise<{ subscription: SubscriptionRow | null }> {
    await this.requireTenant(tenantId);
    const subscription = await subscriptionsRepository.currentForTenant(tenantId);
    return { subscription: subscription ?? null };
  }

  async listTransactions(tenantId: string): Promise<PlatformTransactionRow[]> {
    await this.requireTenant(tenantId);
    return platformTransactionsRepository.listByTenant(tenantId);
  }

  // Starts (or changes) a tenant's subscription. Creates the gateway customer +
  // subscription and returns the hosted checkout URL the tenant admin completes.
  // The subscription is PENDING until the first successful charge activates it.
  async createForTenant(
    actor: AuditActor,
    tenantId: string,
    opts: { gateway?: string; planKey?: string; billingMode?: string }
  ): Promise<CreateSubscriptionResult> {
    const tenant = await this.requireTenant(tenantId);

    const gateway = typeof opts.gateway === "string" ? opts.gateway.toUpperCase() : "";
    if (!isBillingGateway(gateway)) {
      throw new BadRequestError(`gateway must be one of ${BILLING_GATEWAYS.join(", ")}`);
    }
    const billingMode = opts.billingMode === "MANUAL" ? "MANUAL" : "AUTO";

    const planKey = (opts.planKey ?? tenant.plan_key ?? "").trim();
    if (!planKey) throw new BadRequestError("planKey is required (tenant has no plan)");
    const plan = await plansRepository.findByKey(planKey);
    if (!plan || !plan.is_active) {
      throw new BadRequestError(`planKey must reference an active plan: ${planKey}`);
    }

    const ref = await planGatewayRefsRepository.find(planKey, gateway, "MONTHLY");
    if (!ref) {
      throw new BadRequestError(
        `Plan ${planKey} is not configured for ${gateway} billing (missing plan_gateway_refs)`
      );
    }

    // Customer identity = the tenant's first admin (created at onboarding).
    const admins = await usersRepository.listAdminsByTenant(tenantId);
    const admin = admins[0];
    const customer = { name: admin?.name ?? tenant.name, email: admin?.email ?? null };

    // Snapshot the existing live subscription but DON'T cancel it yet, we only
    // supersede it once the NEW gateway object is created successfully, so a
    // gateway error never leaves the tenant with no live subscription.
    const existingLive = await subscriptionsRepository.liveForTenant(tenantId);

    let subscription: SubscriptionRow;
    let checkoutUrl: string | null;

    if (billingMode === "AUTO") {
      // Gateway subscription (mandate) that auto-charges each cycle.
      const created = await platformGateway.createSubscription({
        gateway,
        planExternalId: ref.external_plan_id,
        referenceId: `${tenantId}-${Date.now().toString(36)}`,
        customer,
      });
      if (created.error) throw new BadRequestError(`Gateway subscription failed: ${created.error}`);
      await this.supersede(existingLive);
      checkoutUrl = created.checkoutUrl;
      subscription = await subscriptionsRepository.create({
        tenantId,
        planKey,
        gateway,
        billingInterval: "MONTHLY",
        billingMode: "AUTO",
        status: "PENDING",
        gatewayCustomerId: created.customerId,
        gatewaySubscriptionId: created.subscriptionId,
        checkoutUrl,
        checkoutRef: null,
        currentPeriodStart: null,
        currentPeriodEnd: created.currentPeriodEnd,
        amount: ref.amount,
        currency: ref.currency,
      });
    } else {
      // MANUAL: create the row first (its id anchors the payment-link reference),
      // then issue a one-time link for the first cycle.
      subscription = await subscriptionsRepository.create({
        tenantId,
        planKey,
        gateway,
        billingInterval: "MONTHLY",
        billingMode: "MANUAL",
        status: "PENDING",
        gatewayCustomerId: null,
        gatewaySubscriptionId: null,
        checkoutUrl: null,
        checkoutRef: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        amount: ref.amount,
        currency: ref.currency,
      });
      const link = await platformGateway.createPaymentLink({
        gateway,
        amountPaise: ref.amount,
        description: `${plan.name}, monthly subscription`,
        referenceId: `pmsub_${subscription.id}`,
        customer,
      });
      if (link.error) {
        // Roll back the just-created row so it never counts as live; leave the
        // existing subscription intact.
        await subscriptionsRepository.update(subscription.id, {
          status: "CANCELED",
          canceled_at: new Date(),
        });
        throw new BadRequestError(`Gateway payment link failed: ${link.error}`);
      }
      await this.supersede(existingLive);
      checkoutUrl = link.url;
      const updated = await subscriptionsRepository.update(subscription.id, {
        checkout_url: link.url,
        checkout_ref: link.ref,
      });
      if (updated) subscription = updated;
    }

    auditService.log(actor, "billing.subscription_created", "billing", {
      tenantId,
      resourceId: subscription.id,
      summary: `${actor.email} started a ${gateway} ${billingMode} subscription for tenant ${tenant.name} on plan ${planKey}`,
      metadata: { gateway, billingMode, planKey, subscriptionId: subscription.gateway_subscription_id },
    });

    return { subscription, checkoutUrl };
  }

  // Cancels a previous live subscription at the gateway and locally. Called only
  // after a replacement subscription has been created successfully.
  private async supersede(existingLive: SubscriptionRow | undefined): Promise<void> {
    if (!existingLive) return;
    if (existingLive.gateway_subscription_id && isBillingGateway(existingLive.gateway)) {
      await platformGateway
        .cancelSubscription(existingLive.gateway, existingLive.gateway_subscription_id)
        .catch(() => undefined);
    }
    await subscriptionsRepository.update(existingLive.id, {
      status: "CANCELED",
      canceled_at: new Date(),
    });
  }

  // Tenant "Pay now". MANUAL: issues a fresh one-time link for the next cycle.
  // AUTO+PENDING: returns the stored mandate checkout URL. AUTO+active: nothing
  // to pay (the gateway auto-charges).
  async payNow(tenantId: string): Promise<{ url: string | null }> {
    const tenant = await this.requireTenant(tenantId);
    const sub = await subscriptionsRepository.currentForTenant(tenantId);
    if (!sub) throw new BadRequestError("No subscription to pay for");
    if (sub.status === "GRANDFATHERED") {
      throw new BadRequestError("This workspace is not on a paid subscription");
    }

    if (sub.billing_mode === "AUTO") {
      if (sub.status === "PENDING" && sub.checkout_url) return { url: sub.checkout_url };
      throw new BadRequestError("Auto-renew is on, no manual payment is needed");
    }

    if (!isBillingGateway(sub.gateway)) {
      throw new BadRequestError("Subscription has no billing gateway");
    }
    const ref = await planGatewayRefsRepository.find(sub.plan_key, sub.gateway, "MONTHLY");
    if (!ref) {
      throw new BadRequestError(`Plan ${sub.plan_key} is not configured for ${sub.gateway} billing`);
    }
    const admins = await usersRepository.listAdminsByTenant(tenantId);
    const admin = admins[0];
    const link = await platformGateway.createPaymentLink({
      gateway: sub.gateway,
      amountPaise: ref.amount,
      description: `${sub.plan_key}, monthly subscription`,
      referenceId: `pmsub_${sub.id}`,
      customer: { name: admin?.name ?? tenant.name, email: admin?.email ?? null },
    });
    if (link.error) throw new BadRequestError(`Gateway payment link failed: ${link.error}`);
    await subscriptionsRepository.update(sub.id, {
      checkout_url: link.url,
      checkout_ref: link.ref,
    });
    return { url: link.url };
  }

  // Toggles auto-renew. AUTO->MANUAL cancels the gateway mandate but keeps access
  // through the current period. MANUAL->AUTO starts a mandate and returns the
  // authorization URL to complete.
  async setMode(
    actor: AuditActor,
    tenantId: string,
    mode: string
  ): Promise<{ subscription: SubscriptionRow; url: string | null }> {
    const tenant = await this.requireTenant(tenantId);
    const target = mode === "MANUAL" ? "MANUAL" : mode === "AUTO" ? "AUTO" : "";
    if (!target) throw new BadRequestError("mode must be AUTO or MANUAL");

    const sub = await subscriptionsRepository.liveForTenant(tenantId);
    if (!sub) throw new BadRequestError("No active subscription to change");
    if (sub.billing_mode === target) return { subscription: sub, url: sub.checkout_url };
    if (!isBillingGateway(sub.gateway)) {
      throw new BadRequestError("Subscription has no billing gateway");
    }

    if (target === "MANUAL") {
      if (sub.gateway_subscription_id) {
        await platformGateway
          .cancelSubscription(sub.gateway, sub.gateway_subscription_id)
          .catch(() => undefined);
      }
      const updated = await subscriptionsRepository.update(sub.id, {
        billing_mode: "MANUAL",
        gateway_subscription_id: null,
        cancel_at_period_end: false,
      });
      auditService.log(actor, "billing.mode_changed", "billing", {
        tenantId,
        resourceId: sub.id,
        summary: `Auto-renew turned OFF (manual billing) for tenant ${tenant.name}`,
        metadata: { mode: "MANUAL" },
      });
      return { subscription: updated ?? sub, url: null };
    }

    // MANUAL -> AUTO: start a mandate subscription; access continues meanwhile.
    const ref = await planGatewayRefsRepository.find(sub.plan_key, sub.gateway, "MONTHLY");
    if (!ref) {
      throw new BadRequestError(`Plan ${sub.plan_key} is not configured for ${sub.gateway} billing`);
    }
    const admins = await usersRepository.listAdminsByTenant(tenantId);
    const admin = admins[0];
    // Anchor the first auto-charge to the paid period's end so the tenant is not
    // charged again for time they already paid manually.
    const anchorAt =
      sub.current_period_end && sub.current_period_end > new Date()
        ? sub.current_period_end
        : undefined;
    const created = await platformGateway.createSubscription({
      gateway: sub.gateway,
      planExternalId: ref.external_plan_id,
      referenceId: `${tenantId}-${Date.now().toString(36)}`,
      customer: { name: admin?.name ?? tenant.name, email: admin?.email ?? null },
      anchorAt,
    });
    if (created.error) throw new BadRequestError(`Gateway subscription failed: ${created.error}`);
    const updated = await subscriptionsRepository.update(sub.id, {
      billing_mode: "AUTO",
      gateway_subscription_id: created.subscriptionId,
      gateway_customer_id: created.customerId ?? sub.gateway_customer_id,
      checkout_url: created.checkoutUrl,
    });
    auditService.log(actor, "billing.mode_changed", "billing", {
      tenantId,
      resourceId: sub.id,
      summary: `Auto-renew turned ON for tenant ${tenant.name}`,
      metadata: { mode: "AUTO" },
    });
    return { subscription: updated ?? sub, url: created.checkoutUrl };
  }

  // Cancels the current subscription. Immediate cancel suspends the whole
  // workspace now (decision: suspend on cancel); at-period-end leaves it live
  // and lets the enforcement sweep suspend it when the period lapses.
  async cancel(
    actor: AuditActor,
    tenantId: string,
    opts: { atPeriodEnd?: boolean }
  ): Promise<SubscriptionRow> {
    const tenant = await this.requireTenant(tenantId);
    const sub = await subscriptionsRepository.liveForTenant(tenantId);
    if (!sub) throw new BadRequestError("No active subscription to cancel");

    const atPeriodEnd = Boolean(opts.atPeriodEnd);

    if (sub.gateway_subscription_id && isBillingGateway(sub.gateway)) {
      await platformGateway
        .cancelSubscription(sub.gateway, sub.gateway_subscription_id, atPeriodEnd)
        .catch(() => undefined);
    }

    const updated = await subscriptionsRepository.update(sub.id, {
      status: atPeriodEnd ? sub.status : "CANCELED",
      cancel_at_period_end: atPeriodEnd,
      canceled_at: new Date(),
    });

    if (!atPeriodEnd) {
      await tenantsRepository.update(tenantId, { status: "SUSPENDED" });
      // Immediate cancel revokes plan entitlements now. An at-period-end cancel
      // keeps the subscription live, so the sweep revokes when the period lapses.
      await entitlementsSyncService.sync(tenantId);
    }

    auditService.log(actor, "billing.subscription_canceled", "billing", {
      tenantId,
      resourceId: sub.id,
      summary: `${actor.email} canceled the subscription for tenant ${tenant.name}${
        atPeriodEnd ? " (at period end)" : " (immediate, workspace suspended)"
      }`,
      metadata: { atPeriodEnd, gateway: sub.gateway },
    });

    return updated ?? sub;
  }

  async metrics(): Promise<{
    mrr: number;
    currency: string;
    byStatus: Record<string, number>;
    upcomingRenewals: Array<{
      tenant_id: string;
      plan_key: string;
      amount: number;
      current_period_end: Date | null;
    }>;
  }> {
    const [counts, mrr, renewals] = await Promise.all([
      subscriptionsRepository.statusCounts(),
      subscriptionsRepository.activeMrr(),
      subscriptionsRepository.upcomingRenewals(7),
    ]);
    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = c.n;
    return {
      mrr,
      currency: "INR",
      byStatus,
      upcomingRenewals: renewals.map((r) => ({
        tenant_id: r.tenant_id,
        plan_key: r.plan_key,
        amount: r.amount,
        current_period_end: r.current_period_end,
      })),
    };
  }

  // Enforcement safety net for missed webhooks. Runs on the jobs worker.
  //  - ACTIVE past its period end (no renewal webhook arrived) -> PAST_DUE + grace.
  //  - PAST_DUE past its grace window -> EXPIRED + suspend the workspace.
  // GRANDFATHERED and terminal subscriptions are excluded by sweepCandidates().
  async sweep(): Promise<{ pastDue: number; expired: number }> {
    const now = new Date();
    const graceMs = config.BILLING_GRACE_DAYS * 86400000;
    const candidates = await subscriptionsRepository.sweepCandidates();
    let pastDue = 0;
    let expired = 0;

    for (const sub of candidates) {
      if (sub.status === "PAST_DUE") {
        if (!sub.grace_until) {
          // Defensive: a PAST_DUE row without a grace window gets one now.
          await subscriptionsRepository.update(sub.id, {
            grace_until: new Date(now.getTime() + graceMs),
          });
        } else if (sub.grace_until < now) {
          await subscriptionsRepository.update(sub.id, { status: "EXPIRED" });
          await tenantsRepository.update(sub.tenant_id, { status: "SUSPENDED" });
          await entitlementsSyncService.sync(sub.tenant_id);
          expired++;
        }
      } else if (sub.status === "ACTIVE") {
        if (sub.current_period_end && sub.current_period_end < now) {
          await subscriptionsRepository.update(sub.id, {
            status: "PAST_DUE",
            grace_until: new Date(now.getTime() + graceMs),
          });
          pastDue++;
        }
      }
    }

    return { pastDue, expired };
  }

  // Self-healing reconciliation: re-derives plan entitlements from subscription
  // state for every tenant that has a subscription. Catches drift from a
  // transition we failed to hook, a sync that errored, or a tenant an operator
  // flipped back to ACTIVE without reinstating its subscription. Idempotent and
  // cheap (a no-op unless a tenant is actually out of sync). Runs on the sweep.
  async reconcileEntitlements(): Promise<{ checked: number }> {
    const tenantIds = await subscriptionsRepository.distinctTenantIds();
    for (const tenantId of tenantIds) {
      await entitlementsSyncService.sync(tenantId);
    }
    return { checked: tenantIds.length };
  }

  // Poll-based activation for MANUAL billing (no webhook needed). Checks each
  // outstanding hosted link for payment and activates on success. Runs on the
  // jobs worker; complements the webhook path (both are idempotent).
  async pollPendingPayments(): Promise<{ activated: number }> {
    const candidates = await subscriptionsRepository.pollCandidates();
    let activated = 0;
    for (const sub of candidates) {
      if (!sub.checkout_ref || !isBillingGateway(sub.gateway)) continue;
      const status = await platformGateway.fetchPaymentStatus(sub.gateway, sub.checkout_ref);
      if (status.paid) {
        await this.activateManual(sub, status.paymentId);
        activated++;
      }
    }
    return { activated };
  }

  // Activates a MANUAL subscription after a confirmed one-time payment: rolls the
  // period forward a month, records the invoice (de-duped by gateway id), and
  // lifts the workspace suspension.
  private async activateManual(sub: SubscriptionRow, paymentId: string | null): Promise<void> {
    const now = new Date();

    // Idempotent: if this payment was already applied (webhook or a prior poll),
    // just ensure the workspace is active and clear the pending link, never roll
    // the period a second time for the same payment.
    if (paymentId) {
      const existing = await platformTransactionsRepository.findByGatewayInvoiceId(paymentId);
      if (existing) {
        await subscriptionsRepository.update(sub.id, {
          status: "ACTIVE",
          grace_until: null,
          canceled_at: null,
          checkout_url: null,
          checkout_ref: null,
        });
        await tenantsRepository.update(sub.tenant_id, { status: "ACTIVE" });
        await entitlementsSyncService.sync(sub.tenant_id);
        return;
      }
    }

    const base =
      sub.current_period_end && sub.current_period_end > now ? sub.current_period_end : now;
    const periodEnd = addMonths(base, 1);
    await platformTransactionsRepository.create({
      tenantId: sub.tenant_id,
      subscriptionId: sub.id,
      gateway: sub.gateway,
      gatewayInvoiceId: paymentId,
      gatewayPaymentId: paymentId,
      amount: sub.amount,
      currency: sub.currency,
      status: "PAID",
      kind: "CYCLE",
      periodStart: null,
      periodEnd,
      hostedInvoiceUrl: null,
      failureReason: null,
      occurredAt: now,
    });
    await subscriptionsRepository.update(sub.id, {
      status: "ACTIVE",
      current_period_start: sub.current_period_start ?? now,
      current_period_end: periodEnd,
      grace_until: null,
      canceled_at: null,
      checkout_url: null,
      checkout_ref: null,
    });
    await tenantsRepository.update(sub.tenant_id, { status: "ACTIVE" });
    await entitlementsSyncService.sync(sub.tenant_id);
  }

  private async requireTenant(tenantId: string): Promise<{
    id: string;
    name: string;
    plan_key: string | null;
  }> {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Tenant not found");
    return { id: tenant.id, name: tenant.name, plan_key: tenant.plan_key };
  }
}

export default new BillingService();
