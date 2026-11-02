import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { billing_interval, billing_mode, subscription_status } from "../../db/enums";
import type { DB, tenant_subscriptions } from "../../db/types";

export type SubscriptionRow = Selectable<tenant_subscriptions>;

// Non-terminal statuses: a tenant may have at most one of these "live" at a time.
export const LIVE_STATUSES: subscription_status[] = ["PENDING", "ACTIVE", "PAST_DUE"];

export interface CreateSubscriptionData {
  tenantId: string;
  planKey: string;
  gateway: string;
  billingInterval: billing_interval;
  billingMode: billing_mode;
  status: subscription_status;
  gatewayCustomerId: string | null;
  gatewaySubscriptionId: string | null;
  checkoutUrl: string | null;
  checkoutRef: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  amount: number;
  currency: string;
}

class SubscriptionsRepository {
  // Latest subscription for a tenant (the "current" one; history is kept).
  async currentForTenant(tenantId: string): Promise<SubscriptionRow | undefined> {
    return db
      .selectFrom("tenant_subscriptions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  async findById(id: string): Promise<SubscriptionRow | undefined> {
    return db.selectFrom("tenant_subscriptions").selectAll().where("id", "=", id).executeTakeFirst();
  }

  async findByGatewaySubscriptionId(
    gatewaySubscriptionId: string
  ): Promise<SubscriptionRow | undefined> {
    return db
      .selectFrom("tenant_subscriptions")
      .selectAll()
      .where("gateway_subscription_id", "=", gatewaySubscriptionId)
      .executeTakeFirst();
  }

  // The current live (non-terminal, non-grandfathered) subscription, if any.
  async liveForTenant(tenantId: string): Promise<SubscriptionRow | undefined> {
    return db
      .selectFrom("tenant_subscriptions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "in", LIVE_STATUSES)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  async create(data: CreateSubscriptionData, trx?: Transaction<DB>): Promise<SubscriptionRow> {
    const t = new Date();
    return (trx || db)
      .insertInto("tenant_subscriptions")
      .values({
        id: ulid(),
        tenant_id: data.tenantId,
        plan_key: data.planKey,
        gateway: data.gateway,
        billing_interval: data.billingInterval,
        billing_mode: data.billingMode,
        status: data.status,
        gateway_customer_id: data.gatewayCustomerId,
        gateway_subscription_id: data.gatewaySubscriptionId,
        checkout_url: data.checkoutUrl,
        checkout_ref: data.checkoutRef,
        current_period_start: data.currentPeriodStart,
        current_period_end: data.currentPeriodEnd,
        cancel_at_period_end: false,
        amount: data.amount,
        currency: data.currency,
        created_at: t,
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    data: Partial<{
      status: subscription_status;
      billing_mode: billing_mode;
      gateway_subscription_id: string | null;
      gateway_customer_id: string | null;
      checkout_url: string | null;
      checkout_ref: string | null;
      current_period_start: Date | null;
      current_period_end: Date | null;
      cancel_at_period_end: boolean;
      canceled_at: Date | null;
      grace_until: Date | null;
    }>,
    trx?: Transaction<DB>
  ): Promise<SubscriptionRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) patch[k] = v;
    }
    return (trx || db)
      .updateTable("tenant_subscriptions")
      .set(patch)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  // --- Metrics / sweep helpers ---

  async statusCounts(): Promise<Array<{ status: string; n: number }>> {
    const rows = await db
      .selectFrom("tenant_subscriptions")
      .select(["status", db.fn.count<number>("id").as("n")])
      .groupBy("status")
      .execute();
    return rows.map((r) => ({ status: r.status, n: Number(r.n) }));
  }

  // Sum of monthly amount across ACTIVE subscriptions = MRR (in smallest unit).
  async activeMrr(): Promise<number> {
    const row = await db
      .selectFrom("tenant_subscriptions")
      .select(db.fn.sum<number>("amount").as("total"))
      .where("status", "=", "ACTIVE")
      .executeTakeFirst();
    return Number(row?.total ?? 0);
  }

  async upcomingRenewals(withinDays: number): Promise<SubscriptionRow[]> {
    const until = new Date(Date.now() + withinDays * 86400000);
    return db
      .selectFrom("tenant_subscriptions")
      .selectAll()
      .where("status", "=", "ACTIVE")
      .where("current_period_end", "is not", null)
      .where("current_period_end", "<=", until)
      .orderBy("current_period_end", "asc")
      .execute();
  }

  // MANUAL subscriptions awaiting payment confirmation via polling: an
  // outstanding hosted link (checkout_ref) and not yet settled for the cycle.
  async pollCandidates(): Promise<SubscriptionRow[]> {
    return db
      .selectFrom("tenant_subscriptions")
      .selectAll()
      .where("billing_mode", "=", "MANUAL")
      .where("checkout_ref", "is not", null)
      .where("status", "in", ["PENDING", "PAST_DUE"])
      .execute();
  }

  // Subscriptions the enforcement sweep must evaluate: live, non-grandfathered,
  // with a known period end. GRANDFATHERED and terminal rows are excluded.
  async sweepCandidates(): Promise<SubscriptionRow[]> {
    return db
      .selectFrom("tenant_subscriptions")
      .selectAll()
      .where("status", "in", ["ACTIVE", "PAST_DUE"])
      .where("current_period_end", "is not", null)
      .execute();
  }

  // Every tenant that has ever had a subscription, the set the entitlement
  // reconciliation pass walks. Tenants with no subscription row are comp/legacy
  // and are deliberately excluded.
  async distinctTenantIds(): Promise<string[]> {
    const rows = await db
      .selectFrom("tenant_subscriptions")
      .select("tenant_id")
      .distinct()
      .execute();
    return rows.map((r) => r.tenant_id);
  }
}

export default new SubscriptionsRepository();
