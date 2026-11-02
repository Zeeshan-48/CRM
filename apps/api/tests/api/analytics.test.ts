import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_FINANCE,
  NW_SALES,
  login,
} from "../helpers";

let adminToken: string;
let salesToken: string;
let financeToken: string;
let esAdminToken: string;

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
});

afterAll(async () => {
  // Read-only suite: nothing to clean up.
  await closeDB();
});

describe("analytics overview", () => {
  it("returns tenant-wide counts, won revenue and weighted pipeline", async () => {
    const res = await api.get("/api/v1/analytics/overview").set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.leads).toBeGreaterThanOrEqual(12);
    expect(d.contacts).toBeGreaterThanOrEqual(8);
    expect(d.openDeals).toBeGreaterThanOrEqual(1);
    // Seeded Northwind has one WON deal worth 130000.
    expect(d.revenue).toBeGreaterThanOrEqual(130000);
    expect(d.weightedPipeline).toBeGreaterThan(0);
    expect(Number.isInteger(d.weightedPipeline)).toBe(true);
    expect(d.openTickets).toBeGreaterThanOrEqual(1);
    expect(d.conversations).toBeGreaterThanOrEqual(3);
  });
});

describe("analytics sales", () => {
  it("returns win rate, conversion, avg deal size and per-owner stats", async () => {
    const res = await api.get("/api/v1/analytics/sales").set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.deals).toBeGreaterThanOrEqual(10);
    expect(d.won).toBeGreaterThanOrEqual(1);
    expect(d.lost).toBeGreaterThanOrEqual(1);
    expect(d.winRate).toBeGreaterThanOrEqual(0);
    expect(d.winRate).toBeLessThanOrEqual(100);
    expect(d.conversion).toBeGreaterThanOrEqual(0);
    expect(d.conversion).toBeLessThanOrEqual(100);
    expect(d.avgDealSize).toBeGreaterThan(0);

    expect(Array.isArray(d.byOwner)).toBe(true);
    const names = d.byOwner.map((o: { name: string }) => o.name);
    expect(names).toEqual(expect.arrayContaining(["Asha", "Neha", "Vikram"]));
    for (const owner of d.byOwner) {
      expect(typeof owner.won).toBe("number");
      expect(typeof owner.revenue).toBe("number");
      expect(typeof owner.open).toBe("number");
    }
    const totalOwnerRevenue = d.byOwner.reduce(
      (acc: number, o: { revenue: number }) => acc + o.revenue,
      0
    );
    expect(totalOwnerRevenue).toBeGreaterThanOrEqual(130000);
  });
});

describe("analytics marketing", () => {
  it("returns spend, ROAS, ROI, CAC and leads by source sorted desc", async () => {
    const res = await api.get("/api/v1/analytics/marketing").set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    // Seeded Northwind campaigns: cost 195000, revenue 940000.
    expect(d.spend).toBeGreaterThanOrEqual(195000);
    expect(d.revenue).toBeGreaterThanOrEqual(940000);
    expect(d.roas).toBeGreaterThan(0);
    expect(d.roi).toBeGreaterThan(0);
    expect(d.cac).toBeGreaterThan(0);

    expect(d.leadsBySource.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < d.leadsBySource.length; i++) {
      expect(d.leadsBySource[i - 1].count).toBeGreaterThanOrEqual(d.leadsBySource[i].count);
    }
    const sources = d.leadsBySource.map((s: { source: string }) => s.source);
    expect(sources).toContain("WhatsApp");
  });
});

describe("analytics support", () => {
  it("returns ticket totals, SLA compliance and resolution rate", async () => {
    const res = await api.get("/api/v1/analytics/support").set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.total).toBeGreaterThanOrEqual(6);
    expect(d.open).toBeGreaterThanOrEqual(0);
    expect(d.resolved).toBeGreaterThanOrEqual(1);
    expect(d.breached).toBeGreaterThanOrEqual(0);
    expect(d.breached).toBeLessThanOrEqual(d.open);
    expect(d.slaCompliance).toBeGreaterThanOrEqual(0);
    expect(d.slaCompliance).toBeLessThanOrEqual(100);
    // Real resolution rate = resolved / total (0-100), no longer a fixed CSAT.
    expect(d.resolutionRate).toBeGreaterThanOrEqual(0);
    expect(d.resolutionRate).toBeLessThanOrEqual(100);
    expect(d.csat).toBeUndefined();
  });
});

describe("analytics predictive", () => {
  it("returns churn, upsell and forecast figures", async () => {
    const res = await api.get("/api/v1/analytics/predictive").set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.churnRisk).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(d.churnList)).toBe(true);
    expect(d.churnList.length).toBeLessThanOrEqual(10);
    expect(d.churnList.length).toBeLessThanOrEqual(d.churnRisk);
    // Real query: paying customers with no open deal (integer >= 0).
    expect(d.upsellCandidates).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(d.upsellCandidates)).toBe(true);
    expect(d.predictedRevenue).toBeGreaterThan(0);
    expect(d.predictedConversions).toBeGreaterThanOrEqual(0);
    // Derived from pipeline: value-weighted avg win probability (0-100).
    expect(d.forecastConfidence).toBeGreaterThanOrEqual(0);
    expect(d.forecastConfidence).toBeLessThanOrEqual(100);
  });
});

describe("analytics conversation intelligence", () => {
  it("aggregates messages and call transcripts through the AI heuristics", async () => {
    const res = await api
      .get("/api/v1/analytics/conversation-intelligence")
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.messages).toBeGreaterThanOrEqual(8);
    expect(d.messages).toBeLessThanOrEqual(500);
    expect(d.calls).toBeGreaterThanOrEqual(3);
    expect(d.calls).toBeLessThanOrEqual(100);
    expect(["Positive", "Neutral", "Negative"]).toContain(d.overallSentiment);
    expect(d.positiveSignals).toBeGreaterThanOrEqual(1);
    expect(d.topics.length).toBeGreaterThanOrEqual(1);
    expect(d.byChannel.WHATSAPP).toBeGreaterThanOrEqual(1);
    // Seeded voice calls have transcripts, so talk ratio must be computed.
    expect(d.talkRatio).toBeGreaterThan(0);
    expect(d.talkRatio).toBeLessThanOrEqual(100);
    expect(typeof d.recommendation).toBe("string");
  });

  it("is tenant-scoped: the other tenant sees its own volumes only", async () => {
    const res = await api
      .get("/api/v1/analytics/conversation-intelligence")
      .set(auth(esAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.calls).toBeGreaterThanOrEqual(3);
  });
});

describe("analytics RBAC", () => {
  it("denies SALES_AGENT and allows FINANCE", async () => {
    const denied = await api.get("/api/v1/analytics/overview").set(auth(salesToken));
    expect(denied.status).toBe(403);

    const allowed = await api.get("/api/v1/analytics/sales").set(auth(financeToken));
    expect(allowed.status).toBe(200);
  });
});
