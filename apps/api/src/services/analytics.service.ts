import analyticsRepository from "../repositories/analytics.repository";
import {
  conversationIntelligence,
  ConversationIntelResult,
  MessageLike,
  TranscriptTurn,
  VoiceCallLike,
} from "./ai/heuristics";

const MESSAGES_CAP = 500;
const CALLS_CAP = 100;
const CHURN_STALE_DAYS = 30;
const HOT_LEAD_SCORE = 70;

const parseTranscript = (value: unknown): TranscriptTurn[] => {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is TranscriptTurn =>
      !!t &&
      typeof t === "object" &&
      typeof (t as TranscriptTurn).text === "string" &&
      ((t as TranscriptTurn).speaker === "agent" || (t as TranscriptTurn).speaker === "user")
  );
};

class AnalyticsService {
  async overview(tenantId: string) {
    const [leads, contacts, dealTotals, ticketTotals, conversations] = await Promise.all([
      analyticsRepository.countLeads(tenantId),
      analyticsRepository.countContacts(tenantId),
      analyticsRepository.dealTotals(tenantId),
      analyticsRepository.ticketTotals(tenantId),
      analyticsRepository.countConversations(tenantId),
    ]);
    return {
      leads,
      contacts,
      openDeals: dealTotals.open,
      revenue: dealTotals.wonRevenue,
      weightedPipeline: Math.round(dealTotals.weightedOpenPipeline),
      openTickets: ticketTotals.open,
      conversations,
    };
  }

  async sales(tenantId: string) {
    const [dealTotals, leads, byOwner] = await Promise.all([
      analyticsRepository.dealTotals(tenantId),
      analyticsRepository.countLeads(tenantId),
      analyticsRepository.salesByOwner(tenantId),
    ]);
    const { won, lost, total, wonRevenue } = dealTotals;
    return {
      revenue: wonRevenue,
      deals: total,
      won,
      lost,
      winRate: won + lost ? Math.round((won / (won + lost)) * 100) : 0,
      conversion: leads ? Math.round((won / leads) * 100) : 0,
      avgDealSize: won ? Math.round(wonRevenue / won) : 0,
      byOwner,
    };
  }

  async marketing(tenantId: string) {
    const [campaigns, leadsBySource, leads] = await Promise.all([
      analyticsRepository.campaignTotals(tenantId),
      analyticsRepository.leadsBySource(tenantId),
      analyticsRepository.countLeads(tenantId),
    ]);
    const { cost, revenue } = campaigns;
    const acquired = campaigns.leadsGenerated || leads;
    return {
      spend: cost,
      revenue,
      roas: cost ? +(revenue / cost).toFixed(2) : 0,
      roi: cost ? Math.round(((revenue - cost) / cost) * 100) : 0,
      cac: acquired ? Math.round(cost / acquired) : 0,
      leadsBySource,
    };
  }

  async support(tenantId: string) {
    const totals = await analyticsRepository.ticketTotals(tenantId);
    const { total, open, resolved, breached } = totals;
    return {
      total,
      open,
      resolved,
      slaCompliance: open ? Math.round(((open - breached) / open) * 100) : 100,
      // Real, DB-derived: share of all tickets that reached RESOLVED. (There is
      // no survey source, so we report resolution rate rather than a fake CSAT.)
      resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
      breached,
    };
  }

  async predictive(tenantId: string) {
    const [customers, lastActivity, dealTotals, hotLeads, upsellCandidates] = await Promise.all([
      analyticsRepository.customers(tenantId),
      analyticsRepository.lastActivityByContact(tenantId),
      analyticsRepository.dealTotals(tenantId),
      analyticsRepository.countHotLeads(tenantId, HOT_LEAD_SCORE),
      analyticsRepository.upsellCandidates(tenantId),
    ]);

    const staleCutoffMs = CHURN_STALE_DAYS * 86400000;
    const churnRisk = customers.filter((c) => {
      const last = lastActivity.get(c.id) ?? new Date(c.created_at);
      return Date.now() - last.getTime() > staleCutoffMs;
    });

    // Value-weighted average win probability of the open pipeline (0-100).
    const forecastConfidence =
      dealTotals.openPipelineValue > 0
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round((dealTotals.weightedOpenPipeline / dealTotals.openPipelineValue) * 100)
            )
          )
        : 0;

    return {
      churnRisk: churnRisk.length,
      churnList: churnRisk.slice(0, 10).map((c) => ({ name: c.name, company: c.company })),
      upsellCandidates,
      predictedRevenue: Math.round(dealTotals.weightedOpenPipeline),
      predictedConversions: Math.round(hotLeads * 0.35),
      forecastConfidence,
    };
  }

  async conversationIntelligence(tenantId: string): Promise<ConversationIntelResult> {
    const [messageRows, callRows] = await Promise.all([
      analyticsRepository.recentMessages(tenantId, MESSAGES_CAP),
      analyticsRepository.recentVoiceCallTranscripts(tenantId, CALLS_CAP),
    ]);
    const messages: MessageLike[] = messageRows.map((m) => ({
      body: m.body,
      channel: m.channel,
    }));
    const calls: VoiceCallLike[] = callRows.map((c) => ({
      transcript: parseTranscript(c.transcript),
    }));
    return conversationIntelligence(messages, calls);
  }
}

export default new AnalyticsService();
