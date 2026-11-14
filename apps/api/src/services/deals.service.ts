import { db } from "../db/connection";
import { BadRequestError, NotFoundError } from "../errors";
import { assertCanManageRecord } from "../utils/record-policy";
import accountsRepository from "../repositories/accounts.repository";
import dealsRepository, {
  DealRow,
  PipelineRow,
  StageRow,
} from "../repositories/deals.repository";
import logger from "../utils/logger";
import { bestTimeToCall, dealHealth, nextBestAction } from "./ai/heuristics";
import { isModelGenerated, rememberInsight } from "./ai/insight-cache";
import { aiProvider } from "./ai/provider";
import engineService from "./engine.service";
import { DEAL_STAGES } from "../constants/deal-stages.const";

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const toMoney = (value: unknown): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
};

const toDateInput = (value: unknown, field: string): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new BadRequestError(`${field} must be a valid date`);
  return d;
};

const toArrayInput = (value: unknown, field: string): unknown[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new BadRequestError(`${field} must be an array`);
  return value;
};

export interface CreateDealBody {
  title?: string;
  value?: unknown;
  owner_id?: string;
  lead_id?: string;
  account_id?: string;
  contact_id?: string;
  pipeline_id?: string;
  stage_id?: string;
  expected_close_at?: string;
  competitors?: unknown;
  stakeholders?: unknown;
}

export interface UpdateDealBody {
  title?: string;
  value?: unknown;
  owner_id?: string | null;
  expected_close_at?: string | null;
  competitors?: unknown;
  stakeholders?: unknown;
}

class DealsService {
  // ---- Pipelines ----

  async listPipelines(tenantId: string) {
    const [pipelines, stages] = await Promise.all([
      dealsRepository.listPipelines(tenantId),
      dealsRepository.listStagesByTenant(tenantId),
    ]);
    return pipelines.map((p) => ({
      ...p,
      stages: stages.filter((s) => s.pipeline_id === p.id),
    }));
  }

  // Stages are fixed platform-wide (see DEAL_STAGES), any `stages` in the body
  // is intentionally ignored so every pipeline gets the same seven.
  async createPipeline(tenantId: string, body: { name?: string }) {
    if (!body.name || typeof body.name !== "string") throw new BadRequestError("name required");

    const isDefault = !(await dealsRepository.hasDefaultPipeline(tenantId));

    return db.transaction().execute(async (trx) => {
      const pipeline = await dealsRepository.createPipeline(
        { tenant_id: tenantId, name: body.name as string, is_default: isDefault },
        trx
      );
      const stages: StageRow[] = [];
      for (let i = 0; i < DEAL_STAGES.length; i++) {
        const spec = DEAL_STAGES[i];
        stages.push(
          await dealsRepository.createStage(
            {
              tenant_id: tenantId,
              pipeline_id: pipeline.id,
              name: spec.name,
              sort_order: i,
              won: spec.won,
              lost: spec.lost,
            },
            trx
          )
        );
      }
      return { ...pipeline, stages };
    });
  }

  // ---- Board ----

  async board(tenantId: string, pipelineId?: string) {
    let pipeline: PipelineRow | undefined;
    if (pipelineId) {
      pipeline = await dealsRepository.findPipelineById(pipelineId, tenantId);
    } else {
      pipeline = await dealsRepository.findDefaultPipeline(tenantId);
    }
    if (!pipeline) throw new NotFoundError("Pipeline not found");

    const [stages, deals] = await Promise.all([
      dealsRepository.listStagesByPipeline(tenantId, pipeline.id),
      dealsRepository.listDealsByPipeline(tenantId, pipeline.id),
    ]);

    const board = stages.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage_id === stage.id);
      return {
        stage,
        deals: stageDeals,
        total: stageDeals.reduce((acc, d) => acc + Number(d.value), 0),
      };
    });

    return { pipeline, stages, board };
  }

  // ---- Forecast ----

  async forecast(tenantId: string) {
    return dealsRepository.forecast(tenantId);
  }

  // ---- Deal detail ----

  async detail(tenantId: string, dealId: string) {
    const deal = await dealsRepository.findDealById(dealId, tenantId);
    if (!deal) throw new NotFoundError("Deal not found");

    const [stages, activities] = await Promise.all([
      dealsRepository.listStagesByPipeline(tenantId, deal.pipeline_id),
      dealsRepository.dealActivities(tenantId, deal.id),
    ]);
    const health = dealHealth(deal, stages, activities);

    return {
      ...deal,
      winProbability: health.winProbability,
      health: health.label,
      healthScore: health.score,
      nextBestAction: nextBestAction(deal, stages, activities),
      bestTimeToCall: bestTimeToCall(),
      activities,
    };
  }

  // ---- Create / update ----

  async create(tenantId: string, actorId: string, body: CreateDealBody) {
    if (!body.title || typeof body.title !== "string") {
      throw new BadRequestError("title is required");
    }

    let pipeline: PipelineRow | undefined;
    let stage: StageRow | undefined;
    if (body.stage_id) {
      stage = await dealsRepository.findStageById(body.stage_id, tenantId);
      if (!stage) throw new BadRequestError("Invalid stage");
      pipeline = await dealsRepository.findPipelineById(stage.pipeline_id, tenantId);
    } else {
      pipeline = body.pipeline_id
        ? await dealsRepository.findPipelineById(body.pipeline_id, tenantId)
        : await dealsRepository.findDefaultPipeline(tenantId);
      if (!pipeline) throw new BadRequestError("No pipeline configured");
      const stages = await dealsRepository.listStagesByPipeline(tenantId, pipeline.id);
      stage = stages[0];
    }
    if (!pipeline || !stage) throw new BadRequestError("Pipeline has no stages");

    const deal = await dealsRepository.createDeal({
      tenant_id: tenantId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      title: body.title,
      value: toMoney(body.value),
      currency: "INR",
      owner_id: body.owner_id || actorId,
      lead_id: body.lead_id ?? null,
      account_id: body.account_id ?? null,
      contact_id: body.contact_id ?? null,
      expected_close_at: toDateInput(body.expected_close_at, "expected_close_at") ?? null,
      competitors: toArrayInput(body.competitors, "competitors") ?? [],
      stakeholders: toArrayInput(body.stakeholders, "stakeholders") ?? [],
    });

    const fresh = await this.recomputeStored(tenantId, deal);
    engineService.audit(tenantId, actorId, "deal.created", "deal", deal.id, {
      value: deal.value,
    });
    return fresh;
  }

  async update(tenantId: string, dealId: string, body: UpdateDealBody) {
    const existing = await dealsRepository.findDealById(dealId, tenantId);
    if (!existing) throw new NotFoundError("Deal not found");

    const updated = await dealsRepository.updateDeal(dealId, tenantId, {
      title: typeof body.title === "string" ? body.title : undefined,
      value: body.value !== undefined ? toMoney(body.value) : undefined,
      owner_id: body.owner_id !== undefined ? body.owner_id : undefined,
      expected_close_at: toDateInput(body.expected_close_at, "expected_close_at"),
      competitors: toArrayInput(body.competitors, "competitors"),
      stakeholders: toArrayInput(body.stakeholders, "stakeholders"),
    });
    if (!updated) throw new NotFoundError("Deal not found");

    return this.recomputeStored(tenantId, updated);
  }

  async remove(tenantId: string, actorId: string, actorRole: string, dealId: string) {
    const deal = await dealsRepository.findDealById(dealId, tenantId);
    if (!deal) throw new NotFoundError("Deal not found");
    assertCanManageRecord(actorId, actorRole, deal.owner_id, "delete", "deal");
    await dealsRepository.deleteDeal(dealId, tenantId);
    engineService.audit(tenantId, actorId, "deal.deleted", "deal", dealId, {});
    return { ok: true };
  }

  // ---- Stage moves ----

  async move(tenantId: string, actorId: string, dealId: string, body: { stageId?: string }) {
    const deal = await dealsRepository.findDealById(dealId, tenantId);
    if (!deal) throw new NotFoundError("Deal not found");

    if (!body.stageId) throw new BadRequestError("stageId required");
    const stage = await dealsRepository.findStageById(body.stageId, tenantId);
    if (!stage) throw new BadRequestError("Invalid stage");

    const status = stage.won ? "WON" : stage.lost ? "LOST" : "OPEN";
    const updated = await dealsRepository.updateDeal(dealId, tenantId, {
      stage_id: stage.id,
      pipeline_id: stage.pipeline_id,
      status,
      closed_at: status === "OPEN" ? null : new Date(),
    });
    if (!updated) throw new NotFoundError("Deal not found");

    const fresh = await this.recomputeStored(tenantId, updated);
    const ctx = await this.workflowCtx(tenantId, fresh);
    await engineService.emit(tenantId, actorId, "deal.stage_changed", ctx);
    if (stage.won) {
      await engineService.emit(tenantId, actorId, "deal.won", ctx);
      await this.syncWonContract(tenantId, actorId, fresh);
      await this.markContactAsCustomer(tenantId, actorId, fresh);
    } else {
      await this.syncContactLifecycleFromDeals(tenantId, actorId, fresh);
    }
    engineService.audit(tenantId, actorId, "deal.moved", "deal", deal.id, {
      stage: stage.name,
    });
    return fresh;
  }

  async win(tenantId: string, actorId: string, dealId: string) {
    return this.moveTerminal(tenantId, actorId, dealId, "won");
  }

  async lost(tenantId: string, actorId: string, dealId: string, reason?: string) {
    return this.moveTerminal(tenantId, actorId, dealId, "lost", reason);
  }

  private async moveTerminal(
    tenantId: string,
    actorId: string,
    dealId: string,
    kind: "won" | "lost",
    reason?: string
  ) {
    const deal = await dealsRepository.findDealById(dealId, tenantId);
    if (!deal) throw new NotFoundError("Deal not found");

    const stages = await dealsRepository.listStagesByPipeline(tenantId, deal.pipeline_id);
    const stage = stages.find((s) => (kind === "won" ? s.won : s.lost));
    if (!stage) throw new BadRequestError(`Pipeline has no ${kind} stage`);

    const updated = await dealsRepository.updateDeal(dealId, tenantId, {
      stage_id: stage.id,
      status: kind === "won" ? "WON" : "LOST",
      closed_at: new Date(),
      lost_reason: kind === "lost" ? reason || "" : undefined,
    });
    if (!updated) throw new NotFoundError("Deal not found");

    const fresh = await this.recomputeStored(tenantId, updated);
    if (kind === "won") {
      const ctx = await this.workflowCtx(tenantId, fresh);
      await engineService.emit(tenantId, actorId, "deal.won", ctx);
      await this.syncWonContract(tenantId, actorId, fresh);
      await this.markContactAsCustomer(tenantId, actorId, fresh);
    } else {
      await this.syncContactLifecycleFromDeals(tenantId, actorId, fresh);
    }
    engineService.audit(tenantId, actorId, `deal.${kind}`, "deal", deal.id, {});
    return fresh;
  }

  // When a deal leaves the WON state (e.g. reverted to Qualified or marked Lost),
  // check if the contact has any other WON deals. If none remain and the contact
  // was CUSTOMER, safely revert its lifecycle back to PROSPECT.
  private async syncContactLifecycleFromDeals(
    tenantId: string,
    actorId: string,
    deal: DealRow
  ): Promise<void> {
    if (!deal.contact_id) return;
    try {
      const otherWonDeal = await db
        .selectFrom("deals")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("contact_id", "=", deal.contact_id)
        .where("status", "=", "WON")
        .executeTakeFirst();

      if (!otherWonDeal) {
        const contact = await db
          .selectFrom("contacts")
          .select(["id", "lifecycle"])
          .where("tenant_id", "=", tenantId)
          .where("id", "=", deal.contact_id)
          .executeTakeFirst();

        if (contact && contact.lifecycle === "CUSTOMER") {
          await db
            .updateTable("contacts")
            .set({ lifecycle: "PROSPECT", updated_at: new Date() })
            .where("tenant_id", "=", tenantId)
            .where("id", "=", deal.contact_id)
            .execute();
          engineService.audit(
            tenantId,
            actorId,
            "contact.lifecycle_changed",
            "contact",
            deal.contact_id,
            { lifecycle: "PROSPECT", source: "deal.stage_reverted", dealId: deal.id }
          );
        }
      }
    } catch (err) {
      logger.warn(`sync contact lifecycle failed (deal ${deal.id}): ${String(err)}`);
    }
  }

  // When a deal is won, materialise it as an ACTIVE contract on its account so
  // the post-sale relationship is on file. Idempotent (keyed on deal_id, so
  // re-winning never duplicates) and best-effort (a failure here must never
  // break the win). Deals with no account_id are skipped, a contract needs an
  // account to live on.
  private async syncWonContract(tenantId: string, actorId: string, deal: DealRow): Promise<void> {
    if (!deal.account_id) return;
    try {
      const existing = await accountsRepository.findContractByDeal(tenantId, deal.id);
      if (existing) return;
      const contract = await accountsRepository.addContract({
        tenant_id: tenantId,
        account_id: deal.account_id,
        deal_id: deal.id,
        title: deal.title,
        value: deal.value,
        status: "ACTIVE",
        start_at: deal.closed_at ?? new Date(),
      });
      engineService.audit(tenantId, actorId, "account.contract_added", "account", deal.account_id, {
        contractId: contract.id,
        title: contract.title,
        source: "deal.won",
        dealId: deal.id,
      });
    } catch (err) {
      logger.warn(`won-deal contract auto-create failed (deal ${deal.id}): ${String(err)}`);
    }
  }

  // When a deal is won, promote its linked contact to CUSTOMER. This is the ONLY
  // path that marks a customer, conversion alone leaves a contact as PROSPECT.
  // Idempotent (skips if already CUSTOMER) and best-effort (a failure here must
  // never break the win). Deals with no contact_id are skipped.
  private async markContactAsCustomer(
    tenantId: string,
    actorId: string,
    deal: DealRow
  ): Promise<void> {
    if (!deal.contact_id) return;
    try {
      const contact = await db
        .selectFrom("contacts")
        .select(["id", "lifecycle"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", deal.contact_id)
        .executeTakeFirst();
      if (!contact || contact.lifecycle === "CUSTOMER") return;
      await db
        .updateTable("contacts")
        .set({ lifecycle: "CUSTOMER", updated_at: new Date() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", deal.contact_id)
        .execute();
      engineService.audit(
        tenantId,
        actorId,
        "contact.lifecycle_changed",
        "contact",
        deal.contact_id,
        { lifecycle: "CUSTOMER", source: "deal.won", dealId: deal.id }
      );
    } catch (err) {
      logger.warn(`won-deal customer promote failed (deal ${deal.id}): ${String(err)}`);
    }
  }

  // ---- AI coach ----

  async coach(tenantId: string, dealId: string) {
    const deal = await dealsRepository.findDealById(dealId, tenantId);
    if (!deal) throw new NotFoundError("Deal not found");

    let grade = "WARM";
    if (deal.lead_id) {
      const lead = await db
        .selectFrom("leads")
        .select(["score_grade"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", deal.lead_id)
        .executeTakeFirst();
      if (lead) grade = lead.score_grade;
    }
    return aiProvider.coach({ grade, value: deal.value });
  }

  // ---- AI deal assessment (real LLM: reads the deal's signals) ----

  async insight(tenantId: string, dealId: string) {
    const deal = await dealsRepository.findDealById(dealId, tenantId);
    if (!deal) throw new NotFoundError("Deal not found");

    const [stages, activities] = await Promise.all([
      dealsRepository.listStagesByPipeline(tenantId, deal.pipeline_id),
      dealsRepository.dealActivities(tenantId, deal.id),
    ]);
    const health = dealHealth(deal, stages, activities);
    const stageName = stages.find((s) => s.id === deal.stage_id)?.name ?? null;

    let leadGrade: string | null = null;
    if (deal.lead_id) {
      const lead = await db
        .selectFrom("leads")
        .select(["score_grade"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", deal.lead_id)
        .executeTakeFirst();
      leadGrade = lead?.score_grade ?? null;
    }

    const lastActivityAt = activities
      .map((a) => new Date(a.created_at).getTime())
      .sort((x, y) => y - x)[0];

    const assessInput = {
      title: deal.title,
      value: Number(deal.value),
      stageName,
      winProbability: health.winProbability,
      healthLabel: health.label,
      daysSinceActivity: lastActivityAt ? (Date.now() - lastActivityAt) / 86_400_000 : null,
      competitors: parseStringArray(deal.competitors),
      stakeholders: parseStringArray(deal.stakeholders),
      leadGrade,
      recentActivities: activities
        .slice(0, 12)
        .map((a) => ({ type: a.type, when: new Date(a.created_at).toISOString().slice(0, 10) })),
    };

    const insight = await rememberInsight(
      "deal-insight",
      tenantId,
      assessInput,
      () => aiProvider.assessDeal(assessInput),
      isModelGenerated
    );

    return {
      dealId: deal.id,
      winProbability: health.winProbability,
      health: health.label,
      healthScore: health.score,
      insight,
    };
  }

  // ---- Stored AI fields ----

  private async recomputeStored(tenantId: string, deal: DealRow): Promise<DealRow> {
    const [stages, activities] = await Promise.all([
      dealsRepository.listStagesByPipeline(tenantId, deal.pipeline_id),
      dealsRepository.dealActivities(tenantId, deal.id),
    ]);
    const health = dealHealth(deal, stages, activities);
    const updated = await dealsRepository.updateDeal(deal.id, tenantId, {
      win_probability: health.winProbability,
      health_score: health.score,
      health_label: health.label,
    });
    return updated ?? deal;
  }

  private async workflowCtx(tenantId: string, deal: DealRow) {
    const lead = deal.lead_id
      ? await db
          .selectFrom("leads")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("id", "=", deal.lead_id)
          .executeTakeFirst()
      : undefined;

    let contact = deal.contact_id
      ? await db
          .selectFrom("contacts")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("id", "=", deal.contact_id)
          .executeTakeFirst()
      : undefined;
    if (!contact && deal.lead_id) {
      contact = await db
        .selectFrom("contacts")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("converted_from_lead_id", "=", deal.lead_id)
        .executeTakeFirst();
    }

    return { deal, lead: lead ?? null, contact: contact ?? null };
  }
}

export default new DealsService();
