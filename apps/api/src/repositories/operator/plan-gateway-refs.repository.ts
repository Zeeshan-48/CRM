import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { billing_interval } from "../../db/enums";
import type { plan_gateway_refs } from "../../db/types";

export type PlanGatewayRefRow = Selectable<plan_gateway_refs>;

class PlanGatewayRefsRepository {
  // The external gateway plan/price id for a plan on a gateway + interval.
  async find(
    planKey: string,
    gateway: string,
    billingInterval: billing_interval = "MONTHLY"
  ): Promise<PlanGatewayRefRow | undefined> {
    return db
      .selectFrom("plan_gateway_refs")
      .selectAll()
      .where("plan_key", "=", planKey)
      .where("gateway", "=", gateway)
      .where("billing_interval", "=", billingInterval)
      .where("active", "=", true)
      .executeTakeFirst();
  }

  async listByPlan(planKey: string): Promise<PlanGatewayRefRow[]> {
    return db
      .selectFrom("plan_gateway_refs")
      .selectAll()
      .where("plan_key", "=", planKey)
      .orderBy("gateway", "asc")
      .execute();
  }

  // Idempotent upsert keyed on (plan_key, gateway, billing_interval).
  async upsert(data: {
    planKey: string;
    gateway: string;
    billingInterval: billing_interval;
    externalPlanId: string;
    amount: number;
    currency: string;
    active?: boolean;
  }): Promise<PlanGatewayRefRow> {
    const t = new Date();
    return db
      .insertInto("plan_gateway_refs")
      .values({
        id: ulid(),
        plan_key: data.planKey,
        gateway: data.gateway,
        billing_interval: data.billingInterval,
        external_plan_id: data.externalPlanId,
        amount: data.amount,
        currency: data.currency,
        active: data.active ?? true,
        created_at: t,
        updated_at: t,
      })
      .onConflict((oc) =>
        oc.columns(["plan_key", "gateway", "billing_interval"]).doUpdateSet({
          external_plan_id: data.externalPlanId,
          amount: data.amount,
          currency: data.currency,
          active: data.active ?? true,
          updated_at: t,
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

export default new PlanGatewayRefsRepository();
