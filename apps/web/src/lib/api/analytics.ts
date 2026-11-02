import type { AnalyticsOverview } from "@/types";
import { apiGet } from "./client";

// ---- Types (mirror open-crm-api analytics.service.ts) ----

export interface SalesOwnerRow {
  name: string;
  won: number;
  revenue: number;
  /** Open deal count (current backend shape). */
  open?: number;
  /** Activity count (older shape, kept for compatibility). */
  activities?: number;
}

export interface SalesAnalytics {
  revenue: number;
  deals: number;
  won: number;
  lost: number;
  winRate: number;
  conversion: number;
  avgDealSize: number;
  byOwner: SalesOwnerRow[];
}

export interface LeadSourceRow {
  source: string;
  count: number;
}

export interface MarketingAnalytics {
  spend: number;
  revenue: number;
  roas: number;
  roi: number;
  cac: number;
  leadsBySource: LeadSourceRow[];
}

export interface SupportAnalytics {
  total: number;
  open: number;
  resolved: number;
  breached: number;
  slaCompliance: number;
  /** Share of all tickets that reached RESOLVED (0-100). */
  resolutionRate: number;
}

export interface ChurnRiskRow {
  name: string;
  company: string | null;
}

export interface PredictiveAnalytics {
  churnRisk: number;
  churnList: ChurnRiskRow[];
  upsellCandidates: number;
  predictedRevenue: number;
  predictedConversions: number;
  forecastConfidence: number;
}

export interface ConversationIntelligence {
  messages: number;
  calls: number;
  overallSentiment: string;
  positiveSignals: number;
  riskSignals: number;
  topics: string[];
  /** Percent of call turns spoken by agents (0-100), null when no calls. */
  talkRatio: number | null;
  byChannel: Record<string, number>;
  recommendation: string;
}

// ---- Calls ----

export const getAnalyticsOverview = () =>
  apiGet<AnalyticsOverview>("/analytics/overview");

export const getSalesAnalytics = () => apiGet<SalesAnalytics>("/analytics/sales");

export const getMarketingAnalytics = () =>
  apiGet<MarketingAnalytics>("/analytics/marketing");

export const getSupportAnalytics = () =>
  apiGet<SupportAnalytics>("/analytics/support");

export const getPredictiveAnalytics = () =>
  apiGet<PredictiveAnalytics>("/analytics/predictive");

export const getConversationIntelligence = () =>
  apiGet<ConversationIntelligence>("/analytics/conversation-intelligence");
