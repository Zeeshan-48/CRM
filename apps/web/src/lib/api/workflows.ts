import { apiDelete, apiGet, apiPost, apiPut } from "./client";

// ---- Types (mirror open-crm-api workflows.service.ts) ----

export interface WorkflowAction {
  type: string;
  params?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  tenant_id: string;
  name: string;
  trigger: string;
  actions: WorkflowAction[];
  active: boolean;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowCatalogue {
  triggers: string[];
  actions: string[];
}

/** A persisted automation run from GET /workflows/runs. */
export interface WorkflowRun {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  workflow_name: string;
  event: string;
  log: string[];
  created_at: string;
}

/** In-memory run record returned by POST /workflows/:id/run. */
export interface WorkflowTestRun {
  id: string;
  workflowName: string;
  event: string;
  log: string[];
}

export interface WorkflowTestRunResult {
  fired: number;
  runs: WorkflowTestRun[];
}

export interface WorkflowInput {
  name: string;
  trigger: string;
  actions: WorkflowAction[];
}

export type WorkflowUpdateInput = Partial<WorkflowInput> & { active?: boolean };

// ---- Calls ----

export const getWorkflowCatalogue = () =>
  apiGet<WorkflowCatalogue>("/workflows/catalogue");

export const listWorkflows = () => apiGet<Workflow[]>("/workflows");

export const listWorkflowRuns = () => apiGet<WorkflowRun[]>("/workflows/runs");

export const createWorkflow = (input: WorkflowInput) =>
  apiPost<Workflow>("/workflows", input);

export const updateWorkflow = (id: string, input: WorkflowUpdateInput) =>
  apiPut<Workflow>(`/workflows/${id}`, input);

export const deleteWorkflow = (id: string) =>
  apiDelete<{ ok: boolean }>(`/workflows/${id}`);

export const testRunWorkflow = (id: string) =>
  apiPost<WorkflowTestRunResult>(`/workflows/${id}/run`);
