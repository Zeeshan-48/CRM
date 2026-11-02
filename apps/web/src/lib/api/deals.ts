import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { Activity } from "./activities";

export type DealStatus = "OPEN" | "WON" | "LOST";

export interface Stage {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  won: boolean;
  lost: boolean;
  created_at: string;
  updated_at: string;
}

export interface Pipeline {
  id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineWithStages extends Pipeline {
  stages: Stage[];
}

export interface Deal {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  currency: string;
  owner_id: string | null;
  lead_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  status: DealStatus;
  expected_close_at: string | null;
  closed_at: string | null;
  competitors: string[] | null;
  stakeholders: string[] | null;
  lost_reason: string | null;
  win_probability: number;
  health_score: number;
  health_label: string | null;
  created_at: string;
  updated_at: string;
  // Present on the lead-detail aggregate (deals joined to their stage); absent
  // on the board payload, where deals are already grouped by stage.
  stage_name?: string | null;
}

export interface BoardColumn {
  stage: Stage;
  deals: Deal[];
  total: number;
}

export interface BoardResponse {
  pipeline: Pipeline;
  stages: Stage[];
  board: BoardColumn[];
}

export interface Forecast {
  openDeals: number;
  pipelineValue: number;
  weighted: number;
  committed: number;
}

/**
 * GET /deals/:id. Note: the backend returns `health` as the label string
 * ("Healthy" | "At risk" | "Critical") and the numeric score separately in
 * `healthScore` (not a nested { score, label } object).
 */
export interface DealDetail extends Deal {
  winProbability: number;
  health: string;
  healthScore: number;
  nextBestAction: string;
  bestTimeToCall: string;
  activities: Activity[];
}

export interface CoachResult {
  strategy: string;
  talkingPoints: string[];
  objectionHandling: Array<{ objection: string; response: string }>;
  script: string;
  coach: string;
}

export interface DealInsight {
  assessment: string;
  nextBestAction: string;
  risks: string[];
  generatedBy: string;
}

export interface DealInsightResult {
  dealId: string;
  winProbability: number;
  health: string;
  healthScore: number;
  insight: DealInsight;
}

export const listPipelines = () => apiGet<PipelineWithStages[]>("/deals/pipelines");

// Stages are fixed platform-wide; only the pipeline name is sent.
export const createPipeline = (body: { name: string }) =>
  apiPost<PipelineWithStages>("/deals/pipelines", body);

export const getBoard = (pipelineId?: string) =>
  apiGet<BoardResponse>("/deals/board", {
    params: pipelineId ? { pipelineId } : undefined,
  });

export const getForecast = () => apiGet<Forecast>("/deals/forecast");

export const getDeal = (id: string) => apiGet<DealDetail>(`/deals/${id}`);

export const createDeal = (body: {
  title: string;
  value: number;
  owner_id?: string;
  pipeline_id?: string;
  stage_id?: string;
  lead_id?: string;
  contact_id?: string;
  account_id?: string;
  expected_close_at?: string;
}) => apiPost<Deal>("/deals", body);

export const updateDeal = (
  id: string,
  body: Partial<{
    title: string;
    value: number;
    owner_id: string | null;
    expected_close_at: string | null;
  }>
) => apiPut<Deal>(`/deals/${id}`, body);

export const moveDeal = (id: string, stageId: string) =>
  apiPost<Deal>(`/deals/${id}/move`, { stageId });

export const winDeal = (id: string) => apiPost<Deal>(`/deals/${id}/win`);

export const loseDeal = (id: string, reason?: string) =>
  apiPost<Deal>(`/deals/${id}/lost`, { reason });

export const deleteDeal = (id: string) => apiDelete<{ ok: boolean }>(`/deals/${id}`);

export const getDealCoach = (id: string) => apiGet<CoachResult>(`/deals/${id}/coach`);

export const getDealInsight = (id: string) => apiGet<DealInsightResult>(`/deals/${id}/insight`);
