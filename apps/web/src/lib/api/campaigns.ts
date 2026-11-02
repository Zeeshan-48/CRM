// Campaigns API. Types are colocated here and mirror
// open-crm-api/src/services/campaigns.service.ts response shapes.

import { apiGet, apiPost } from "./client";

export type CampaignStatus = "ACTIVE" | "PAUSED" | "COMPLETED";

export const CAMPAIGN_STATUSES: CampaignStatus[] = [
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
];

export const CAMPAIGN_CHANNELS = [
  "Google",
  "Facebook",
  "LinkedIn",
  "WhatsApp",
  "Email",
] as const;

/**
 * Real WhatsApp delivery counts for a sent campaign, aggregated from Meta's
 * status webhook. `accepted` = Meta acknowledged the send; the rest arrive
 * asynchronously. Null for non-WhatsApp or not-yet-sent campaigns.
 */
export interface CampaignDelivery {
  accepted: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
}

export interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  channel: string;
  cost: number;
  revenue: number;
  leads_generated: number;
  status: CampaignStatus;
  /** Execution (bulk send). Null/0 for ROI-only campaigns. */
  audience_tag: string | null;
  subject: string | null;
  body: string | null;
  /** WhatsApp template {{1}}..{{n}} values (may contain the {name} token). */
  template_params: string[] | null;
  recipients: number;
  sent: number;
  sent_at: string | null;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
  /** Percent ROI, computed server-side: ((revenue - cost) / cost) * 100. */
  roi: number;
  /** Revenue / cost, 2 decimals. */
  roas: number;
  /** Real WhatsApp delivery breakdown (sent campaigns only). */
  delivery?: CampaignDelivery | null;
}

export interface CampaignTotals {
  cost: number;
  revenue: number;
  leadsGenerated: number;
  roi: number;
}

export interface CampaignsListResponse {
  campaigns: Campaign[];
  totals: CampaignTotals;
}

export interface CreateCampaignInput {
  name: string;
  channel: string;
  cost?: number;
  revenue?: number;
  status?: CampaignStatus;
  audienceTag?: string;
  subject?: string;
  body?: string;
  /** WhatsApp: one value per template {{n}} variable ({name} allowed). */
  templateParams?: string[];
}

export interface SendCampaignResult extends Campaign {
  recipients: number;
  /** Messages Meta accepted at send time (accepted ≠ delivered). */
  sent: number;
  /** Attempted but not really sent (no SES/marketing sender, WA window…). */
  simulated: number;
  /** Recipients with no email/phone for this channel. */
  skipped: number;
}

export const listCampaigns = () => apiGet<CampaignsListResponse>("/campaigns");

export const getCampaign = (id: string) => apiGet<Campaign>(`/campaigns/${id}`);

export const createCampaign = (input: CreateCampaignInput) =>
  apiPost<Campaign>("/campaigns", input);

export const sendCampaign = (id: string) =>
  apiPost<SendCampaignResult>(`/campaigns/${id}/send`);
