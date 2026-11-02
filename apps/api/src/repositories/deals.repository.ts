import { Selectable, Transaction, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, activities, deals, pipelines, stages } from "../db/types";
import type { deal_status } from "../db/enums";

export type PipelineRow = Selectable<pipelines>;
export type StageRow = Selectable<stages>;
export type DealRow = Selectable<deals>;
export type DealActivityRow = Selectable<activities>;

export interface CreateDealData {
  tenant_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value?: number;
  currency?: string;
  owner_id?: string | null;
  lead_id?: string | null;
  account_id?: string | null;
  contact_id?: string | null;
  expected_close_at?: Date | null;
  competitors?: unknown[];
  stakeholders?: unknown[];
}

export interface UpdateDealData {
  title?: string;
  value?: number;
  owner_id?: string | null;
  pipeline_id?: string;
  stage_id?: string;
  status?: deal_status;
  expected_close_at?: Date | null;
  closed_at?: Date | null;
  lost_reason?: string | null;
  competitors?: unknown[];
  stakeholders?: unknown[];
  win_probability?: number;
  health_score?: number;
  health_label?: string;
}

class DealsRepository {
  // ---- Pipelines ----

  async listPipelines(tenantId: string): Promise<PipelineRow[]> {
    return db
      .selectFrom("pipelines")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async findPipelineById(id: string, tenantId: string): Promise<PipelineRow | undefined> {
    return db
      .selectFrom("pipelines")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findDefaultPipeline(tenantId: string): Promise<PipelineRow | undefined> {
    const flagged = await db
      .selectFrom("pipelines")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("is_default", "=", true)
      .executeTakeFirst();
    if (flagged) return flagged;
    return db
      .selectFrom("pipelines")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .executeTakeFirst();
  }

  async hasDefaultPipeline(tenantId: string): Promise<boolean> {
    const row = await db
      .selectFrom("pipelines")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("is_default", "=", true)
      .executeTakeFirst();
    return !!row;
  }

  async createPipeline(
    data: { tenant_id: string; name: string; is_default: boolean },
    trx?: Transaction<DB>
  ): Promise<PipelineRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("pipelines")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        is_default: data.is_default,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Stages ----

  async listStagesByTenant(tenantId: string): Promise<StageRow[]> {
    return db
      .selectFrom("stages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("sort_order", "asc")
      .execute();
  }

  async listStagesByPipeline(tenantId: string, pipelineId: string): Promise<StageRow[]> {
    return db
      .selectFrom("stages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("pipeline_id", "=", pipelineId)
      .orderBy("sort_order", "asc")
      .execute();
  }

  async findStageById(id: string, tenantId: string): Promise<StageRow | undefined> {
    return db
      .selectFrom("stages")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async createStage(
    data: {
      tenant_id: string;
      pipeline_id: string;
      name: string;
      sort_order: number;
      won: boolean;
      lost: boolean;
    },
    trx?: Transaction<DB>
  ): Promise<StageRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("stages")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        pipeline_id: data.pipeline_id,
        name: data.name,
        sort_order: data.sort_order,
        won: data.won,
        lost: data.lost,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Deals ----

  async findDealById(id: string, tenantId: string): Promise<DealRow | undefined> {
    return db
      .selectFrom("deals")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async listDealsByPipeline(tenantId: string, pipelineId: string): Promise<DealRow[]> {
    return db
      .selectFrom("deals")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("pipeline_id", "=", pipelineId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async createDeal(data: CreateDealData, trx?: Transaction<DB>): Promise<DealRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("deals")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        pipeline_id: data.pipeline_id,
        stage_id: data.stage_id,
        title: data.title,
        value: data.value ?? 0,
        currency: data.currency ?? "INR",
        owner_id: data.owner_id ?? null,
        lead_id: data.lead_id ?? null,
        account_id: data.account_id ?? null,
        contact_id: data.contact_id ?? null,
        status: "OPEN",
        expected_close_at: data.expected_close_at ?? null,
        competitors: JSON.stringify(data.competitors ?? []),
        stakeholders: JSON.stringify(data.stakeholders ?? []),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateDeal(
    id: string,
    tenantId: string,
    data: UpdateDealData,
    trx?: Transaction<DB>
  ): Promise<DealRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    const direct = [
      "title",
      "value",
      "owner_id",
      "pipeline_id",
      "stage_id",
      "status",
      "expected_close_at",
      "closed_at",
      "lost_reason",
      "win_probability",
      "health_score",
      "health_label",
    ] as const;
    for (const key of direct) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (data.competitors !== undefined) patch.competitors = JSON.stringify(data.competitors);
    if (data.stakeholders !== undefined) patch.stakeholders = JSON.stringify(data.stakeholders);

    return (trx || db)
      .updateTable("deals")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteDeal(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("deals")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  async dealActivities(tenantId: string, dealId: string): Promise<DealActivityRow[]> {
    return db
      .selectFrom("activities")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("deal_id", "=", dealId)
      .orderBy("created_at", "desc")
      .execute();
  }

  // ---- Forecast (SQL aggregation over stored win_probability) ----

  async forecast(tenantId: string) {
    const row = await db
      .selectFrom("deals")
      .select([
        db.fn.count<number>("id").as("open_deals"),
        sql<string>`coalesce(sum(value), 0)`.as("pipeline_value"),
        sql<string>`coalesce(sum(value * win_probability / 100.0), 0)`.as("weighted"),
        sql<string>`coalesce(sum(value) filter (where win_probability >= 70), 0)`.as("committed"),
      ])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "OPEN")
      .executeTakeFirst();

    return {
      openDeals: Number(row?.open_deals ?? 0),
      pipelineValue: Number(row?.pipeline_value ?? 0),
      weighted: Math.round(Number(row?.weighted ?? 0)),
      committed: Number(row?.committed ?? 0),
    };
  }
}

export default new DealsRepository();
