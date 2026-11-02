import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, automation_runs, leads, workflows } from "../db/types";

export type WorkflowRow = Selectable<workflows>;
export type AutomationRunRow = Selectable<automation_runs>;
export type LatestLeadRow = Selectable<leads>;

export interface CreateWorkflowData {
  tenant_id: string;
  name: string;
  trigger: string;
  actions: unknown[];
  active: boolean;
}

class WorkflowsRepository {
  async list(tenantId: string): Promise<WorkflowRow[]> {
    return db
      .selectFrom("workflows")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async findById(id: string, tenantId: string): Promise<WorkflowRow | undefined> {
    return db
      .selectFrom("workflows")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async create(data: CreateWorkflowData, trx?: Transaction<DB>): Promise<WorkflowRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("workflows")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        trigger: data.trigger,
        actions: JSON.stringify(data.actions),
        active: data.active,
        run_count: 0,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<{ name: string; trigger: string; actions: unknown[]; active: boolean }>,
    trx?: Transaction<DB>
  ): Promise<WorkflowRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.trigger !== undefined) patch.trigger = data.trigger;
    if (data.actions !== undefined) patch.actions = JSON.stringify(data.actions);
    if (data.active !== undefined) patch.active = data.active;

    return (trx || db)
      .updateTable("workflows")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("workflows")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  async listRuns(tenantId: string, limit = 100): Promise<AutomationRunRow[]> {
    return db
      .selectFrom("automation_runs")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  // Sample record for test-firing a workflow against real data.
  async latestLead(tenantId: string): Promise<LatestLeadRow | undefined> {
    return db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }
}

export default new WorkflowsRepository();
