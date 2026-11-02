import { useAuthStore } from "@/stores/auth-store";
import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { Activity } from "./activities";
import type { Contact, CrmMessage, VoiceCall } from "./contacts";
import type { Deal } from "./deals";

export type LeadStatus =
  | "NEW"
  | "ATTEMPTED"
  | "CONNECTED"
  | "QUALIFIED"
  | "NURTURE"
  | "NOT_INTERESTED"
  | "DISQUALIFIED"
  | "CONVERTED";
export type LeadGrade = "HOT" | "WARM" | "COLD";

// Funnel order (the "lead half" of the pipeline; the deal pipeline continues
// from Qualified). CONVERTED is a terminal, system-set state after hand-off.
export const LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "ATTEMPTED",
  "CONNECTED",
  "QUALIFIED",
  "NURTURE",
  "NOT_INTERESTED",
  "DISQUALIFIED",
  "CONVERTED",
];

/** Human labels for statuses (the raw enum has underscores/casing unfit for UI). */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  ATTEMPTED: "Attempted",
  CONNECTED: "Connected",
  QUALIFIED: "Qualified",
  NURTURE: "Nurture",
  NOT_INTERESTED: "Not interested",
  DISQUALIFIED: "Disqualified",
  CONVERTED: "Converted",
};
export const LEAD_GRADES: LeadGrade[] = ["HOT", "WARM", "COLD"];

export interface LeadScore {
  interest: number;
  intent: number;
  engagement: number;
  risk: number;
  total: number;
  grade: LeadGrade;
}

export interface LeadInsight {
  summary: string;
  reasons: string[];
  recommendedAction: string;
  temperature: LeadGrade;
  generatedBy: string;
}

export interface LeadInsightResult {
  leadId: string;
  score: LeadScore;
  insight: LeadInsight;
}

export interface Lead {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string;
  source: string | null;
  campaign: string | null;
  status: LeadStatus;
  owner_id: string | null;
  tags: string[] | null;
  /** Website + social profile links, keyed by network (website/linkedin/…). */
  socials: Record<string, string> | null;
  notes: string | null;
  budget: boolean;
  score_total: number;
  score_grade: LeadGrade;
  score_breakdown: LeadScore | null;
  scored_at: string | null;
  converted_contact_id: string | null;
  converted_deal_id: string | null;
  /** Rolled-up platform snapshot (from external-platform activity sync). */
  custom_fields: PlatformSnapshot | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
  /** Normalized score breakdown, always present on list/detail responses. */
  score: LeadScore;
}

/** The rolled-up "what is this lead doing on our platform" snapshot, maintained
 * by the CRM from synced platform events. Shown in the lead's summary panel. */
export interface PlatformSnapshot {
  plan_status?: string;
  plan_name?: string;
  checkout_abandoned?: boolean;
  content_created?: number;
  content_published?: number;
  /** Published count keyed by the product's own content_type (e.g. ARTICLE, TEMPLATE). */
  published_by_type?: Record<string, number>;
  first_published_at?: string;
  last_platform_active_at?: string;
}

/** One platform-activity event on a lead's stream (distinct from CRM activities:
 * this is what the lead DID on an external platform, not what an agent did). */
export interface PlatformEvent {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  event: string;
  title: string | null;
  status: string;
  /** The acted-on type for content.* events (the product's own content_type); null otherwise. */
  content_type: string | null;
  occurred_at: string;
  created_at: string;
  /** Connected product that reported the event; null for legacy platform rows. */
  app_id?: string | null;
  product_id?: string | null;
  /** Display label from the product's event definition, else derived from `event`. */
  label?: string;
  /** PAGE | ACTION | LIFECYCLE | COMMERCE | SUPPORT (drives the timeline icon). */
  category?: string;
  /** Set on the event definition, a buying signal worth interrupting an agent for. */
  is_high_intent?: boolean;
  page_url?: string | null;
  session_id?: string | null;
  /** Money in minor units (paise/cents), as the catalog stores it. */
  value_minor?: string | number | null;
  currency?: string | null;
}

export interface LeadsListParams {
  q?: string;
  source?: string;
  /** Exact tag the lead must carry (e.g. "CSV Import"). */
  tag?: string;
  status?: string;
  owner?: string;
  grade?: string;
  /** ISO cutoff, only leads created at/after this instant. */
  createdFrom?: string;
  /** ISO cutoff, only leads with activity at/after this instant. */
  lastActivityFrom?: string;
  /** ISO cutoff, only leads with activity at/before this instant. */
  lastActivityTo?: string;
  page?: number;
  limit?: number;
}

export interface LeadsListResponse {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
}

export interface LeadDocument {
  id: string;
  tenant_id: string;
  lead_id: string;
  name: string;
  doc_type: string | null;
  file_key: string | null;
  url: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface LeadDetail extends Lead {
  activities: Activity[];
  messages: CrmMessage[];
  deals: Deal[];
  calls: VoiceCall[];
  documents: LeadDocument[];
}

export interface CreateLeadBody {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  source?: string;
  campaign?: string;
  notes?: string;
  budget?: boolean;
  tags?: string[];
}

export interface BulkLeadRow {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  source?: string;
  country?: string;
  tags?: string[];
  notes?: string;
}

export const listLeads = (params?: LeadsListParams) =>
  apiGet<LeadsListResponse>("/leads", { params });

export const getLeadSources = () => apiGet<string[]>("/leads/sources");

/** Distinct tags in use across the tenant's leads (for the Tag filter). */
export const getLeadTags = () => apiGet<string[]>("/leads/tags");

export const getAssignmentStrategies = () =>
  apiGet<string[]>("/leads/assignment-strategies");

export const createLead = (body: CreateLeadBody) => apiPost<Lead>("/leads", body);

export const bulkImportLeads = (rows: BulkLeadRow[]) =>
  // Large imports (hundreds of rows) can take longer than the default 30s HTTP
  // timeout, so give this request a generous ceiling, the import must never be
  // abandoned mid-flight.
  apiPost<{ imported: number; skipped: number }>(
    "/leads/bulk",
    { rows },
    { timeout: 300_000 }
  );

export const bulkLeadAction = (body: {
  ids: string[];
  action: "assign" | "tag" | "delete";
  value?: string;
  ownerId?: string;
}) => apiPost<{ affected: number; action: string }>("/leads/bulk-action", body);

export const getLead = (id: string) => apiGet<LeadDetail>(`/leads/${id}`);

export const updateLead = (
  id: string,
  body: Partial<{
    name: string;
    email: string;
    phone: string;
    city: string;
    source: string;
    campaign: string;
    status: LeadStatus;
    tags: string[];
    socials: Record<string, string>;
    notes: string;
    budget: boolean;
    owner_id: string | null;
  }>
) => apiPut<Lead>(`/leads/${id}`, body);

export const assignLead = (id: string, body: { strategy: string; ownerId?: string }) =>
  apiPost<{
    ok: boolean;
    owner: { id: string; name: string };
    strategy: string;
    /** Present for the AI strategy: a short, human-readable routing reason. */
    reason?: string;
  }>(`/leads/${id}/assign`, body);

export const listLeadDocuments = (id: string) =>
  apiGet<LeadDocument[]>(`/leads/${id}/documents`);

export const addLeadDocument = (
  id: string,
  body: { name: string; doc_type?: string; url?: string }
) => apiPost<LeadDocument>(`/leads/${id}/documents`, body);

export const getLeadPlatformEvents = (id: string) =>
  apiGet<PlatformEvent[]>(`/leads/${id}/platform-events`);

export const getLeadScore = (id: string) => apiGet<LeadScore>(`/leads/${id}/score`);

export const getLeadInsight = (id: string) => apiGet<LeadInsightResult>(`/leads/${id}/insight`);

export const convertLead = (id: string, body: { createDeal: boolean; value?: number }) =>
  apiPost<{ contact: Contact; deal: Deal | null }>(`/leads/${id}/convert`, body);

export const deleteLead = (id: string) => apiDelete<{ ok: boolean }>(`/leads/${id}`);

/**
 * Downloads the CSV export (raw text/csv response, not the JSON envelope).
 * Pass ids to export a selection; omit to export the first 500 leads.
 */
export const downloadLeadsCsv = async (ids?: string[]): Promise<void> => {
  const base = import.meta.env.VITE_API_BASE_URL || "http://localhost:5066/api/v1";
  const query = ids && ids.length > 0 ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
  const token = useAuthStore.getState().token;

  const response = await fetch(`${base}/leads/export.csv${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error("Export failed");

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "leads.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
