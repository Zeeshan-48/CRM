import { Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { DB } from "../../db/types";

export interface StageSpec {
  name: string;
  won: boolean;
  lost: boolean;
}

class PipelinesRepository {
  async createWithStages(
    data: { tenantId: string; name: string; isDefault: boolean; stages: StageSpec[] },
    trx?: Transaction<DB>
  ): Promise<{ pipelineId: string }> {
    const t = new Date();
    const pipelineId = ulid();
    await (trx || db)
      .insertInto("pipelines")
      .values({
        id: pipelineId,
        tenant_id: data.tenantId,
        name: data.name,
        is_default: data.isDefault,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await (trx || db)
      .insertInto("stages")
      .values(
        data.stages.map((stage, index) => ({
          id: ulid(),
          tenant_id: data.tenantId,
          pipeline_id: pipelineId,
          name: stage.name,
          sort_order: index,
          won: stage.won,
          lost: stage.lost,
          created_at: t,
          updated_at: t,
        }))
      )
      .execute();
    return { pipelineId };
  }
}

export default new PipelinesRepository();
