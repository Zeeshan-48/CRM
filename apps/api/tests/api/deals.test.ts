// The server entry pins the process to UTC before pg serializes Dates
// (src/index.ts); tests import app.ts directly, so pin it here too.
process.env.TZ = "UTC";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEAL_STAGES, DEAL_STAGE_NAMES } from "../../src/constants/deal-stages.const";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_FINANCE, login } from "../helpers";

interface StageShape {
  id: string;
  name: string;
  sort_order: number;
  won: boolean;
  lost: boolean;
}

// Imported, not restated. The stage set is fixed product-wide (every tenant gets
// exactly these, in this order), so a literal copy here would silently rot the
// moment the ladder changes, which is exactly how this file went stale before.
const DEFAULT_STAGE_NAMES = DEAL_STAGE_NAMES;
const WON_STAGE = DEAL_STAGES.find((s) => s.won)!.name;
const LOST_STAGE = DEAL_STAGES.find((s) => s.lost)!.name;
const FIRST_STAGE = DEAL_STAGES[0].name;

// Mirrors the deterministic part of winProbability for deals with no activities.
const expectedWp = (stages: StageShape[], stageId: string, value: number): number => {
  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const idx = ordered.findIndex((s) => s.id === stageId);
  let p = 10 + (ordered.length > 1 && idx >= 0 ? idx / (ordered.length - 1) : 0) * 70;
  if (value > 500000) p -= 6;
  return Math.max(0, Math.min(100, Math.round(p)));
};

let adminToken: string;
let financeToken: string;
let esAdminToken: string;
let nwTenantId: string;
let defaultPipeline: { id: string; is_default: boolean };
let defaultStages: StageShape[] = [];
const testStart = new Date();
const createdDealIds: string[] = [];
const createdPipelineIds: string[] = [];

const stageByName = (name: string): StageShape => {
  const stage = defaultStages.find((s) => s.name === name);
  if (!stage) throw new Error(`stage ${name} missing from default pipeline`);
  return stage;
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;

  const res = await api.get("/api/v1/deals/pipelines").set(auth(adminToken));
  defaultPipeline = res.body.data.find((p: { is_default: boolean }) => p.is_default);
  defaultStages = defaultPipeline ? (defaultPipeline as { stages?: StageShape[] }).stages ?? [] : [];
});

afterAll(async () => {
  for (const id of createdDealIds) {
    await db.deleteFrom("deals").where("id", "=", id).execute();
  }
  for (const id of createdPipelineIds) {
    await db.deleteFrom("stages").where("pipeline_id", "=", id).execute();
    await db.deleteFrom("pipelines").where("id", "=", id).execute();
  }
  await db
    .deleteFrom("automation_runs")
    .where("tenant_id", "=", nwTenantId)
    .where("event", "in", ["deal.stage_changed", "deal.won"])
    .where("created_at", ">=", testStart)
    .execute();
  await db
    .deleteFrom("notifications")
    .where("tenant_id", "=", nwTenantId)
    .where("text", "=", "New won deal, raise invoice")
    .where("created_at", ">=", testStart)
    .execute();
  await closeDB();
});

describe("pipelines", () => {
  it("lists pipelines with their ordered stages", async () => {
    const res = await api.get("/api/v1/deals/pipelines").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(defaultPipeline).toBeTruthy();
    expect(defaultStages.length).toBeGreaterThanOrEqual(7);
    for (let i = 1; i < defaultStages.length; i++) {
      expect(defaultStages[i].sort_order).toBeGreaterThanOrEqual(defaultStages[i - 1].sort_order);
    }
    expect(stageByName(WON_STAGE).won).toBe(true);
    expect(stageByName(LOST_STAGE).lost).toBe(true);
  });

  it("requires a name to create a pipeline", async () => {
    const res = await api.post("/api/v1/deals/pipelines").set(auth(adminToken)).send({});
    expect(res.status).toBe(400);
  });

  it("creates a pipeline with default stages when none are given", async () => {
    const res = await api
      .post("/api/v1/deals/pipelines")
      .set(auth(adminToken))
      .send({ name: "Deals Test Default Pipeline" });
    expect(res.status).toBe(201);
    const pipeline = res.body.data;
    createdPipelineIds.push(pipeline.id);

    // Northwind already has a default pipeline, so this one must not steal the flag.
    expect(pipeline.is_default).toBe(false);
    expect(pipeline.stages.map((s: StageShape) => s.name)).toEqual(DEFAULT_STAGE_NAMES);
    // Flags are asserted against the spec rather than fixed indices, so adding a
    // stage mid-ladder does not need this test edited.
    expect(pipeline.stages.map((s: StageShape) => ({ won: s.won, lost: s.lost }))).toEqual(
      DEAL_STAGES.map((s) => ({ won: s.won, lost: s.lost }))
    );
    expect(pipeline.stages.map((s: StageShape) => s.sort_order)).toEqual(
      DEAL_STAGES.map((_, i) => i)
    );
  });

  it("ignores caller-supplied stages: the ladder is fixed product-wide", async () => {
    // Stages used to be customizable per pipeline. They are not any more, the
    // reporting, forecast and agent logic all key off the fixed ladder, so a
    // tenant-defined stage set would silently break them. A payload that still
    // sends `stages` must be ignored rather than half-honoured.
    const res = await api
      .post("/api/v1/deals/pipelines")
      .set(auth(adminToken))
      .send({
        name: "Deals Test Custom Pipeline",
        stages: ["Intake", "Review", "Contract Won", "Contract Lost"],
      });
    expect(res.status).toBe(201);
    const pipeline = res.body.data;
    createdPipelineIds.push(pipeline.id);

    expect(pipeline.stages.map((s: StageShape) => s.name)).toEqual(DEFAULT_STAGE_NAMES);
    expect(pipeline.stages.filter((s: StageShape) => s.won)).toHaveLength(1);
    expect(pipeline.stages.filter((s: StageShape) => s.lost)).toHaveLength(1);
  });
});

describe("board and forecast", () => {
  it("returns the default pipeline board grouped by stage with totals", async () => {
    const res = await api.get("/api/v1/deals/board").set(auth(adminToken));
    expect(res.status).toBe(200);
    const { pipeline, stages, board } = res.body.data;
    expect(pipeline.id).toBe(defaultPipeline.id);
    expect(board.length).toBe(stages.length);

    const populated = board.find((b: { deals: unknown[] }) => b.deals.length > 0);
    expect(populated).toBeTruthy();
    const sum = populated.deals.reduce((acc: number, d: { value: number }) => acc + d.value, 0);
    expect(populated.total).toBe(sum);
    expect(typeof populated.deals[0].win_probability).toBe("number");
    expect(typeof populated.deals[0].health_score).toBe("number");
    expect(populated.deals[0].health_label).toBeTruthy();
  });

  it("scopes the board to a requested pipeline", async () => {
    const res = await api
      .get(`/api/v1/deals/board?pipelineId=${createdPipelineIds[0]}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.pipeline.id).toBe(createdPipelineIds[0]);
    expect(res.body.data.board.every((b: { deals: unknown[] }) => b.deals.length === 0)).toBe(true);
  });

  it("returns 404 for a cross-tenant pipelineId", async () => {
    const res = await api
      .get(`/api/v1/deals/board?pipelineId=${defaultPipeline.id}`)
      .set(auth(esAdminToken));
    expect(res.status).toBe(404);
  });

  it("computes the forecast from open deals and stored win probabilities", async () => {
    const res = await api.get("/api/v1/deals/forecast").set(auth(adminToken));
    expect(res.status).toBe(200);
    const { openDeals, pipelineValue, weighted, committed } = res.body.data;
    expect(openDeals).toBeGreaterThanOrEqual(1);
    expect(pipelineValue).toBeGreaterThan(0);
    expect(weighted).toBeGreaterThanOrEqual(0);
    expect(weighted).toBeLessThanOrEqual(pipelineValue);
    expect(committed).toBeLessThanOrEqual(pipelineValue);
  });
});

describe("deal crud", () => {
  let dealId: string;

  it("requires a title", async () => {
    const res = await api.post("/api/v1/deals").set(auth(adminToken)).send({ value: 1000 });
    expect(res.status).toBe(400);
  });

  it("creates a deal in the default pipeline's first stage with stored AI fields", async () => {
    const res = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Alpha", value: 120000 });
    expect(res.status).toBe(201);
    const deal = res.body.data;
    dealId = deal.id;
    createdDealIds.push(deal.id);

    expect(deal.pipeline_id).toBe(defaultPipeline.id);
    expect(deal.stage_id).toBe(stageByName(FIRST_STAGE).id);
    expect(deal.status).toBe("OPEN");
    expect(deal.value).toBe(120000);
    expect(deal.currency).toBe("INR");
    expect(deal.owner_id).toBeTruthy();
    expect(deal.win_probability).toBe(expectedWp(defaultStages, deal.stage_id, deal.value));
    expect(typeof deal.health_score).toBe("number");
    expect(deal.health_label).toBe("Critical");
  });

  it("creates a deal directly into a given stage", async () => {
    const stage = stageByName("Qualified");
    const res = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Staged", value: 90000, stage_id: stage.id });
    expect(res.status).toBe(201);
    createdDealIds.push(res.body.data.id);
    expect(res.body.data.stage_id).toBe(stage.id);
    expect(res.body.data.win_probability).toBe(expectedWp(defaultStages, stage.id, 90000));
  });

  it("returns deal detail with live AI enrichment", async () => {
    const res = await api.get(`/api/v1/deals/${dealId}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const detail = res.body.data;
    expect(detail.winProbability).toBe(expectedWp(defaultStages, detail.stage_id, detail.value));
    expect(["Healthy", "At risk", "Critical"]).toContain(detail.health);
    expect(typeof detail.healthScore).toBe("number");
    expect(typeof detail.nextBestAction).toBe("string");
    expect(typeof detail.bestTimeToCall).toBe("string");
    expect(Array.isArray(detail.activities)).toBe(true);
  });

  it("updates editable fields and recomputes stored win probability", async () => {
    const res = await api
      .put(`/api/v1/deals/${dealId}`)
      .set(auth(adminToken))
      .send({
        title: "Deals Test Alpha Renamed",
        value: 700000,
        expected_close_at: "2026-07-15T00:00:00.000Z",
        competitors: ["Competitor X"],
        stakeholders: [{ name: "Buyer One", role: "Buyer" }],
      });
    expect(res.status).toBe(200);
    const deal = res.body.data;
    expect(deal.title).toBe("Deals Test Alpha Renamed");
    expect(deal.value).toBe(700000);
    expect(deal.competitors).toEqual(["Competitor X"]);
    expect(deal.stakeholders).toEqual([{ name: "Buyer One", role: "Buyer" }]);
    expect(new Date(deal.expected_close_at).getTime()).toBe(
      new Date("2026-07-15T00:00:00.000Z").getTime()
    );
    // Big-ticket penalty kicks in above 500000, so the stored value must drop.
    expect(deal.win_probability).toBe(expectedWp(defaultStages, deal.stage_id, 700000));
  });

  it("deletes a deal and blocks cross-tenant deletion", async () => {
    const created = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Deletable", value: 42000 });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const cross = await api.delete(`/api/v1/deals/${id}`).set(auth(esAdminToken));
    expect(cross.status).toBe(404);

    const del = await api.delete(`/api/v1/deals/${id}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    expect(del.body.data.ok).toBe(true);

    const gone = await api.get(`/api/v1/deals/${id}`).set(auth(adminToken));
    expect(gone.status).toBe(404);

    const again = await api.delete(`/api/v1/deals/${id}`).set(auth(adminToken));
    expect(again.status).toBe(404);
  });
});

describe("stage moves, win and lost", () => {
  let dealId: string;

  beforeAll(async () => {
    const res = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Mover", value: 100000 });
    dealId = res.body.data.id;
    createdDealIds.push(dealId);
  });

  it("rejects a move without a valid stage", async () => {
    const missing = await api.post(`/api/v1/deals/${dealId}/move`).set(auth(adminToken)).send({});
    expect(missing.status).toBe(400);

    const invalid = await api
      .post(`/api/v1/deals/${dealId}/move`)
      .set(auth(adminToken))
      .send({ stageId: "01AAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(invalid.status).toBe(400);
  });

  it("moves a deal across open stages and recomputes stored fields", async () => {
    const target = stageByName("Demo Scheduled");
    const res = await api
      .post(`/api/v1/deals/${dealId}/move`)
      .set(auth(adminToken))
      .send({ stageId: target.id });
    expect(res.status).toBe(200);
    const deal = res.body.data;
    expect(deal.stage_id).toBe(target.id);
    expect(deal.status).toBe("OPEN");
    expect(deal.closed_at).toBeNull();
    expect(deal.win_probability).toBe(expectedWp(defaultStages, target.id, deal.value));
  });

  it("moving into the won stage marks WON, sets closed_at and emits deal.won", async () => {
    const target = stageByName(WON_STAGE);
    const res = await api
      .post(`/api/v1/deals/${dealId}/move`)
      .set(auth(adminToken))
      .send({ stageId: target.id });
    expect(res.status).toBe(200);
    const deal = res.body.data;
    expect(deal.status).toBe("WON");
    expect(deal.closed_at).toBeTruthy();
    expect(deal.win_probability).toBe(100);

    const runs = await db
      .selectFrom("automation_runs")
      .selectAll()
      .where("tenant_id", "=", nwTenantId)
      .where("event", "=", "deal.won")
      .where("created_at", ">=", testStart)
      .execute();
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it("moving back to an open stage reopens the deal", async () => {
    const target = stageByName(FIRST_STAGE);
    const res = await api
      .post(`/api/v1/deals/${dealId}/move`)
      .set(auth(adminToken))
      .send({ stageId: target.id });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("OPEN");
    expect(res.body.data.closed_at).toBeNull();
  });

  it("POST /:id/win jumps straight to the pipeline's won stage", async () => {
    const created = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Winner", value: 80000 });
    createdDealIds.push(created.body.data.id);

    const res = await api
      .post(`/api/v1/deals/${created.body.data.id}/win`)
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(200);
    const deal = res.body.data;
    expect(deal.stage_id).toBe(stageByName(WON_STAGE).id);
    expect(deal.status).toBe("WON");
    expect(deal.closed_at).toBeTruthy();
    expect(deal.win_probability).toBe(100);
    expect(deal.health_label).toBe("Healthy");
  });

  it("POST /:id/lost records the reason and zeroes the win probability", async () => {
    const created = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Loser", value: 60000 });
    createdDealIds.push(created.body.data.id);

    const res = await api
      .post(`/api/v1/deals/${created.body.data.id}/lost`)
      .set(auth(adminToken))
      .send({ reason: "Budget cut" });
    expect(res.status).toBe(200);
    const deal = res.body.data;
    expect(deal.stage_id).toBe(stageByName(LOST_STAGE).id);
    expect(deal.status).toBe("LOST");
    expect(deal.lost_reason).toBe("Budget cut");
    expect(deal.win_probability).toBe(0);
    expect(deal.health_label).toBe("Critical");
  });
});

describe("AI coach", () => {
  it("coaches with WARM defaults when the deal has no lead", async () => {
    const created = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Coach", value: 300000 });
    createdDealIds.push(created.body.data.id);

    const res = await api
      .get(`/api/v1/deals/${created.body.data.id}/coach`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const result = res.body.data;
    expect(result.coach).toBe("AI Coach");
    expect(result.strategy).toContain("Build value first");
    expect(result.talkingPoints.length).toBe(3);
    expect(result.talkingPoints.join(" ")).toContain("senior stakeholder");
    expect(result.objectionHandling.length).toBe(4);
  });

  it("uses the linked lead's stored grade", async () => {
    const lead = await db
      .selectFrom("leads")
      .select(["id", "score_grade"])
      .where("tenant_id", "=", nwTenantId)
      .orderBy("score_total", "desc")
      .executeTakeFirstOrThrow();

    const created = await api
      .post("/api/v1/deals")
      .set(auth(adminToken))
      .send({ title: "Deals Test Graded Coach", value: 50000, lead_id: lead.id });
    createdDealIds.push(created.body.data.id);

    const res = await api
      .get(`/api/v1/deals/${created.body.data.id}/coach`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);

    const openers: Record<string, string> = {
      HOT: "This lead is hot",
      WARM: "Build value first",
      COLD: "Re-qualify",
    };
    expect(res.body.data.strategy).toContain(openers[lead.score_grade]);
  });
});

describe("multi-tenant isolation and RBAC", () => {
  it("cross-tenant deal access returns 404", async () => {
    const get = await api.get(`/api/v1/deals/${createdDealIds[0]}`).set(auth(esAdminToken));
    expect(get.status).toBe(404);

    const move = await api
      .post(`/api/v1/deals/${createdDealIds[0]}/move`)
      .set(auth(esAdminToken))
      .send({ stageId: defaultStages[0]?.id });
    expect(move.status).toBe(404);
  });

  it("FINANCE role is denied the deals module", async () => {
    const res = await api.get("/api/v1/deals/board").set(auth(financeToken));
    expect(res.status).toBe(403);
  });
});
