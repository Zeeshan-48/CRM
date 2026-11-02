import { describe, expect, it } from "vitest";
import {
  coach,
  conversationIntelligence,
  copilot,
  dealHealth,
  ragSearch,
  scoreLead,
  sentiment,
  simulateVoiceCall,
  summarize,
  winProbability,
  writeEmail,
  type CopilotData,
} from "../src/services/ai/heuristics";

const now = new Date();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

const baseLead = {
  id: "L1",
  source: "WhatsApp",
  tags: ["priority"],
  notes: "Very interested in pricing, wants a demo soon",
  budget: true,
  city: "Bengaluru",
  name: "Asha Rao",
  last_activity_at: now,
  created_at: daysAgo(2),
};

describe("scoreLead", () => {
  it("returns all dimensions in 0..100 and a valid grade", () => {
    const s = scoreLead(baseLead, [], []);
    for (const k of ["interest", "intent", "engagement", "risk", "total"] as const) {
      expect(s[k]).toBeGreaterThanOrEqual(0);
      expect(s[k]).toBeLessThanOrEqual(100);
    }
    expect(["HOT", "WARM", "COLD"]).toContain(s.grade);
  });

  it("scores an engaged, positive lead HOT and a stale negative lead COLD", () => {
    const hot = scoreLead(
      baseLead,
      [
        { type: "DEMO", lead_id: "L1", created_at: now },
        { type: "MEETING", lead_id: "L1", created_at: now },
        { type: "CALL", lead_id: "L1", created_at: now },
      ],
      [
        { lead_id: "L1", body: "Yes, ready to buy. Great pricing, love the demo." },
        { lead_id: "L1", body: "Perfect, thanks! Interested in starting soon." },
      ]
    );
    expect(hot.grade).toBe("HOT");

    const cold = scoreLead(
      {
        id: "L2",
        source: "CSV Upload",
        tags: [],
        notes: "not interested, too expensive, cancel",
        budget: false,
        created_at: daysAgo(60),
        last_activity_at: daysAgo(45),
      },
      [],
      []
    );
    expect(cold.grade).toBe("COLD");
    expect(cold.risk).toBeGreaterThan(50);
  });

  it("only counts activities and messages belonging to the lead", () => {
    const withOthers = scoreLead(
      baseLead,
      [{ type: "DEMO", lead_id: "OTHER", created_at: now }],
      [{ lead_id: "OTHER", body: "yes buy now" }]
    );
    const without = scoreLead(baseLead, [], []);
    expect(withOthers.total).toBe(without.total);
  });
});

describe("winProbability / dealHealth", () => {
  const stages = [
    { id: "S1", sort_order: 0 },
    { id: "S2", sort_order: 1 },
    { id: "S3", sort_order: 2 },
    { id: "S4", sort_order: 3 },
  ];

  it("is 100 for WON and 0 for LOST regardless of stage", () => {
    expect(winProbability({ id: "D", stage_id: "S1", value: 1000, status: "WON" }, stages)).toBe(100);
    expect(winProbability({ id: "D", stage_id: "S4", value: 1000, status: "LOST" }, stages)).toBe(0);
  });

  it("increases with stage progress", () => {
    const early = winProbability({ id: "D", stage_id: "S1", value: 1000, status: "OPEN" }, stages);
    const late = winProbability({ id: "D", stage_id: "S4", value: 1000, status: "OPEN" }, stages);
    expect(late).toBeGreaterThan(early);
  });

  it("penalises very large deals and staleness", () => {
    const normal = winProbability({ id: "D", stage_id: "S3", value: 100000, status: "OPEN" }, stages);
    const big = winProbability({ id: "D", stage_id: "S3", value: 900000, status: "OPEN" }, stages);
    expect(big).toBeLessThan(normal);

    const fresh = winProbability(
      { id: "D", stage_id: "S3", value: 100000, status: "OPEN" },
      stages,
      [{ type: "CALL", deal_id: "D", created_at: now }]
    );
    const stale = winProbability(
      { id: "D", stage_id: "S3", value: 100000, status: "OPEN" },
      stages,
      [{ type: "CALL", deal_id: "D", created_at: daysAgo(30) }]
    );
    expect(stale).toBeLessThan(fresh);
  });

  it("labels health Healthy / At risk / Critical", () => {
    const h = dealHealth(
      { id: "D", stage_id: "S4", value: 100000, status: "OPEN" },
      stages,
      [
        { type: "DEMO", deal_id: "D", created_at: now },
        { type: "CALL", deal_id: "D", created_at: now },
      ]
    );
    expect(h.label).toBe("Healthy");
    const c = dealHealth({ id: "D", stage_id: "S1", value: 100000, status: "OPEN" }, stages, []);
    expect(c.label).toBe("Critical");
  });
});

describe("sentiment / summarize", () => {
  it("classifies positive, negative, neutral", () => {
    expect(sentiment("This is great, love it, perfect, thanks!").label).toBe("Positive");
    expect(sentiment("not interested, expensive, cancel my refund").label).toBe("Negative");
    expect(sentiment("Let me check the calendar").label).toBe("Neutral");
  });

  it("summarize keeps short text and extracts top sentences from long text", () => {
    expect(summarize("Short note.")).toBe("Short note.");
    const long =
      "We talked about many things. The pricing and demo were the main topics. The weather was nice. They want to buy next week. The office is in Pune.";
    const out = summarize(long);
    expect(out).toContain("pricing");
    expect(out.split(". ").length).toBeLessThanOrEqual(3);
  });
});

describe("writeEmail", () => {
  it("generates each blueprint with name interpolation", () => {
    const sales = writeEmail({ type: "sales", name: "Asha", company: "Acme" });
    expect(sales.subject).toContain("Asha");
    expect(sales.body).toContain("Acme");
    const follow = writeEmail({ type: "followup", name: "Ravi" });
    expect(follow.subject).toContain("Ravi");
    const fallback = writeEmail({ type: "unknown-type", name: "X" });
    expect(fallback.type).toBe("unknown-type");
    expect(fallback.generatedBy).toBe("AI Email Writer");
  });
});

describe("ragSearch", () => {
  const articles = [
    { id: "A1", title: "Refund policy", body: "Full refunds are processed within 7 days of purchase if requested." },
    { id: "A2", title: "Pricing plans", body: "Our pricing has three tiers: Starter, Growth and Enterprise with EMI options." },
    { id: "A3", title: "Technical setup", body: "Install the SDK and configure your API key to begin." },
  ];

  it("ranks title matches above body matches and filters zero scores", () => {
    const hits = ragSearch(articles, "what is the refund policy");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].article.id).toBe("A1");
    const none = ragSearch(articles, "zzzz qqqq");
    expect(none).toHaveLength(0);
  });

  it("returns a snippet around the first match", () => {
    const hits = ragSearch(articles, "pricing EMI");
    expect(hits[0].article.id).toBe("A2");
    expect(hits[0].snippet.toLowerCase()).toContain("pricing");
  });
});

describe("simulateVoiceCall", () => {
  it("qualify goal books a meeting with positive sentiment and action items", () => {
    const call = simulateVoiceCall({ goal: "qualify", contactName: "Asha" });
    expect(call.outcome).toBe("MEETING_BOOKED");
    expect(call.leadScoreDelta).toBe(14);
    expect(call.transcript[0].text).toContain("Asha");
    expect(call.actionItems).toContain("Send WhatsApp confirmation");
    expect(call.durationSec).toBeGreaterThan(60);
  });

  it("unknown goal falls back to qualify script", () => {
    const call = simulateVoiceCall({ goal: "nonexistent", contactName: "X" });
    expect(call.transcript.length).toBeGreaterThan(0);
  });
});

describe("copilot", () => {
  const data: CopilotData = {
    leads: [
      { ...baseLead, id: "L1", name: "Hot Lead", city: "Bengaluru" },
      {
        id: "L2",
        name: "Cold Lead",
        source: "CSV Upload",
        tags: [],
        notes: "not interested",
        budget: false,
        city: "Pune",
        created_at: daysAgo(50),
        last_activity_at: daysAgo(40),
      },
    ],
    deals: [
      { id: "D1", title: "Big deal", stage_id: "S3", value: 200000, status: "OPEN", owner_id: "U1", lead_id: "L1" },
      { id: "D2", title: "Lost deal", stage_id: "S1", value: 50000, status: "LOST", owner_id: "U2", lead_id: null },
    ],
    stages: [
      { id: "S1", sort_order: 0 },
      { id: "S2", sort_order: 1 },
      { id: "S3", sort_order: 2 },
      { id: "S4", sort_order: 3 },
    ],
    contacts: [
      { id: "C1", name: "Dormant Dan", company: "Acme", email: "dan@acme.example.com", created_at: daysAgo(90) },
    ],
    tickets: [
      { subject: "Refund stuck", priority: "HIGH", status: "OPEN", sla_due_at: daysAgo(1) },
      { subject: "Closed one", priority: "LOW", status: "CLOSED", sla_due_at: null },
    ],
    users: [
      { id: "U1", name: "Asha", role: "SALES_AGENT" },
      { id: "U2", name: "Neha", role: "SALES_AGENT" },
    ],
    activities: [
      { type: "DEMO", lead_id: "L1", owner_id: "U1", created_at: now },
      { type: "CALL", deal_id: "D1", owner_id: "U1", created_at: now },
    ],
    messages: [{ lead_id: "L1", body: "yes interested, ready to buy, great pricing demo" }],
  };

  it("answers hot leads queries", () => {
    const r = copilot(data, "Which leads are hot right now?");
    expect(r.intent).toBe("hot_leads");
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0][0]).toBe("Hot Lead");
  });

  it("answers forecast queries with weighted pipeline", () => {
    const r = copilot(data, "Which deals are likely to close? show forecast");
    expect(r.intent).toBe("forecast");
    expect(r.answer).toContain("Weighted pipeline");
  });

  it("answers agent performance queries", () => {
    const r = copilot(data, "Which agents are underperforming?");
    expect(r.intent).toBe("agent_performance");
    expect(r.rows).toHaveLength(2);
  });

  it("answers inactive customer queries", () => {
    const r = copilot(data, "Show inactive customers from the last 30 days");
    expect(r.intent).toBe("inactive_customers");
    expect(r.rows[0][0]).toBe("Dormant Dan");
  });

  it("answers SLA / ticket queries", () => {
    const r = copilot(data, "Which support tickets are overdue?");
    expect(r.intent).toBe("tickets");
    expect(r.answer).toContain("1 past their SLA");
  });

  it("falls back to search with guidance when nothing matches", () => {
    const r = copilot(data, "xyzzy nothing");
    expect(r.intent).toBe("search");
  });
});

describe("coach / conversationIntelligence", () => {
  it("coach adapts strategy to grade and value", () => {
    expect(coach({ grade: "HOT" }).strategy).toContain("hot");
    expect(coach({ grade: "COLD" }).strategy).toContain("Re-qualify");
    expect(coach({ grade: "WARM", value: 500000 }).talkingPoints.join(" ")).toContain("senior stakeholder");
    expect(coach({}).objectionHandling).toHaveLength(4);
  });

  it("conversation intelligence aggregates sentiment, topics and talk ratio", () => {
    const r = conversationIntelligence(
      [
        { body: "The pricing seems expensive", channel: "WHATSAPP" },
        { body: "Can we see a demo this week?", channel: "EMAIL" },
      ],
      [
        {
          transcript: [
            { speaker: "agent", text: "Shall I schedule the demo?" },
            { speaker: "user", text: "Yes that works" },
          ],
        },
      ]
    );
    expect(r.messages).toBe(2);
    expect(r.calls).toBe(1);
    expect(r.topics).toContain("Pricing");
    expect(r.topics).toContain("Demo");
    expect(r.talkRatio).toBe(50);
    expect(r.byChannel.WHATSAPP).toBe(1);
  });
});
