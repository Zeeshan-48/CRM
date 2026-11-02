import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { DB, tenant_entitlements } from "../../db/types";

export type EntitlementRow = Selectable<tenant_entitlements>;

export interface EntitlementSpec {
  code: string;
  enabled: boolean;
  limit_value: number | null;
}

class EntitlementsRepository {
  async listByTenant(tenantId: string, trx?: Transaction<DB>): Promise<EntitlementRow[]> {
    return (trx || db)
      .selectFrom("tenant_entitlements")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("code", "asc")
      .execute();
  }

  async deletePlanSourced(tenantId: string, trx?: Transaction<DB>): Promise<void> {
    await (trx || db)
      .deleteFrom("tenant_entitlements")
      .where("tenant_id", "=", tenantId)
      .where("source", "=", "PLAN")
      .execute();
  }

  // Plan snapshot rows. ADMIN-sourced rows win on conflict: an operator
  // override for a code survives plan changes untouched.
  async insertPlanSnapshot(
    tenantId: string,
    specs: EntitlementSpec[],
    trx?: Transaction<DB>
  ): Promise<void> {
    if (!specs.length) return;
    const t = new Date();
    await (trx || db)
      .insertInto("tenant_entitlements")
      .values(
        specs.map((spec) => ({
          id: ulid(),
          tenant_id: tenantId,
          code: spec.code,
          enabled: spec.enabled,
          limit_value: spec.limit_value,
          source: "PLAN" as const,
          created_at: t,
          updated_at: t,
        }))
      )
      .onConflict((oc) => oc.columns(["tenant_id", "code"]).doNothing())
      .execute();
  }

  async upsertAdminOverride(
    tenantId: string,
    code: string,
    data: { enabled?: boolean; limit_value?: number | null }
  ): Promise<EntitlementRow> {
    const t = new Date();
    return db
      .insertInto("tenant_entitlements")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        code,
        enabled: data.enabled ?? true,
        limit_value: data.limit_value ?? null,
        source: "ADMIN",
        created_at: t,
        updated_at: t,
      })
      .onConflict((oc) =>
        oc.columns(["tenant_id", "code"]).doUpdateSet({
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.limit_value !== undefined ? { limit_value: data.limit_value } : {}),
          source: "ADMIN",
          updated_at: t,
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

export default new EntitlementsRepository();
