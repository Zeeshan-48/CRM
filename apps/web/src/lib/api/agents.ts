import type { AgentSummary } from "@/types";
import { apiGet, apiPatch, apiPost, apiPut } from "./client";

// ---- Types (mirror open-crm-api agents.service.ts) ----

/** A persisted agent run from GET /agents/runs. */
export interface AgentRun {
  id: string;
  tenant_id: string;
  agent: string;
  triggered_by: string | null;
  summary: string | null;
  actions: string[];
  created_at: string;
}

export interface AgentRunParams {
  limit?: number;
  audienceTag?: string;
  query?: string;
}

/** Result of POST /agents/:key/run (extras vary per agent). */
export interface AgentRunResult {
  agent: string;
  name: string;
  summary: string;
  actions: string[];
  run: AgentRun;
  [extra: string]: unknown;
}

// ---- Calls ----

export const listAgents = () => apiGet<AgentSummary[]>("/agents");

export const listAgentRuns = () => apiGet<AgentRun[]>("/agents/runs");

export const runAgent = (key: string, params: AgentRunParams = {}) => {
  const { limit, audienceTag, query } = params;
  return apiPost<AgentRunResult>(
    `/agents/${key}/run`,
    { audienceTag, query },
    { params: limit ? { limit } : undefined }
  );
};

// ---- Sales outreach approval queue (human-in-the-loop) ----

/** A single agent-drafted message awaiting review (GET /agents/outreach). */
export interface AgentOutreach {
  id: string;
  tenant_id: string;
  agent: string;
  lead_id: string | null;
  contact_id: string | null;
  channel: "WHATSAPP" | "EMAIL";
  status: "DRAFT" | "APPROVED" | "SENT" | "REJECTED" | "FAILED" | "SKIPPED";
  subject: string | null;
  body: string;
  reason: string | null;
  created_at: string;
  /** Who this draft is addressed to (joined from the lead/contact). */
  recipientName: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  /** The address this specific draft will be delivered to. */
  recipientAddress: string | null;
  recipientCity: string | null;
  recipientCompany: string | null;
  leadScore: number | null;
}

export const listOutreach = (status = "DRAFT") =>
  apiGet<AgentOutreach[]>("/agents/outreach", { params: { status } });

export const approveOutreach = (id: string, edits?: { subject?: string; body?: string }) =>
  apiPost<{ outreach: AgentOutreach; outcome: string; channel: string | null }>(
    `/agents/outreach/${id}/approve`,
    edits ?? {}
  );

export const rejectOutreach = (id: string) =>
  apiPost<AgentOutreach>(`/agents/outreach/${id}/reject`, {});

export const approveAllOutreach = () =>
  apiPost<{ total: number; sent: number; failed: number }>(
    "/agents/outreach/approve-all",
    {}
  );

export const editOutreach = (id: string, edits: { subject?: string; body?: string }) =>
  apiPatch<AgentOutreach>(`/agents/outreach/${id}`, edits);

// ---- Sales automation settings (Phase 2) ----

export interface CadenceStep {
  delayDays: number;
  angle: string;
}

export interface SalesSettings {
  enabled: boolean;
  scoreThreshold: number;
  channels: string[];
  tone: string | null;
  cadence: CadenceStep[];
  dailyCap: number;
  autoSend: boolean;
  escalateToCall: boolean;
  /**
   * Workspace-wide working hours (read-only here, edited in Settings). The
   * automation only runs inside this window. Only present on GET.
   */
  workingHours?: {
    timezone: string;
    days: number[];
    start: string;
    end: string;
  };
  /** Only present on GET. */
  activeEnrollments?: number;
}

export type SalesSettingsPatch = Partial<
  Pick<
    SalesSettings,
    | "enabled"
    | "scoreThreshold"
    | "channels"
    | "tone"
    | "dailyCap"
    | "autoSend"
    | "escalateToCall"
  >
>;

export const getSalesSettings = () => apiGet<SalesSettings>("/agents/sales/settings");

export const updateSalesSettings = (patch: SalesSettingsPatch) =>
  apiPut<SalesSettings>("/agents/sales/settings", patch);

/** Agent effectiveness over a rolling window (GET /agents/sales/metrics). */
export interface SalesMetrics {
  drafted: number;
  sent: number;
  replied: number;
  rejected: number;
  pending: number;
  meetings: number;
  replyRate: number;
  windowDays: number;
}

export const getSalesMetrics = (days = 30) =>
  apiGet<SalesMetrics>("/agents/sales/metrics", { params: { days } });
