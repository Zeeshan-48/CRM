import { describe, expect, it } from "vitest";
import {
  analyzeQuery,
  buildCopilotContext,
  buildHistoryBlock,
  buildPlannerPrompt,
  buildToolAnswerPrompt,
  parseToolPlan,
} from "../src/services/ai/provider";
import { sanitizeHistory } from "../src/services/copilot.service";
import { TOOL_CATALOG } from "../src/services/ai/copilot-tools";
import type { CopilotData } from "../src/services/ai/heuristics";

const now = new Date();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

// Parse the JSON context buildCopilotContext feeds the LLM back into an object
// so we can assert on the filtered slice it produced.
const ctx = (data: CopilotData, q: string) =>
  JSON.parse(buildCopilotContext(data, q)) as {
    interpretedFilters: Record<string, unknown>;
    counts: Record<string, number>;
    leads: Array<{ name: string; city: string | null; grade: string }>;
    deals: Array<{ title: string; value: number; status: string }>;
    tickets: Array<{ subject: string; overdue: boolean }>;
    contacts: Array<{ name: string; inactiveDays: number }>;
    agents: Array<{ name: string; dealsWon: number }>;
  };

describe("analyzeQuery", () => {
  it("detects the target entities", () => {
    expect([...analyzeQuery("which leads are hot?").entities]).toContain("leads");
    expect([...analyzeQuery("show open deals and forecast").entities]).toContain("deals");
    expect([...analyzeQuery("overdue support tickets").entities]).toContain("tickets");
    expect([...analyzeQuery("inactive customers").entities]).toContain("contacts");
    expect([...analyzeQuery("which agents are underperforming").entities]).toContain("agents");
  });

  it("extracts a city filter", () => {
    expect(analyzeQuery("hot leads from Pune").city).toBe("pune");
    expect(analyzeQuery("leads in Bengaluru").city).toBe("bengaluru");
  });

  it("parses INR amount thresholds with units", () => {
    expect(analyzeQuery("deals over 50k").minValue).toBe(50000);
    expect(analyzeQuery("deals above ₹2 lakh").minValue).toBe(200000);
    expect(analyzeQuery("deals under 1 crore").maxValue).toBe(10000000);
    expect(analyzeQuery("deals below 75,000").maxValue).toBe(75000);
  });

  it("resolves recency windows", () => {
    expect(analyzeQuery("leads from the last 7 days").recencyDays).toBe(7);
    expect(analyzeQuery("created last month").recencyDays).toBe(30);
    expect(analyzeQuery("deals this quarter").recencyDays).toBe(90);
    expect(analyzeQuery("added today").recencyDays).toBe(1);
  });

  it("flags demo / not-purchased / overdue / grade", () => {
    const f = analyzeQuery("hot leads who attended a demo but haven't purchased");
    expect(f.hasDemo).toBe(true);
    expect(f.notPurchased).toBe(true);
    expect(f.grade).toBe("HOT");
    expect(analyzeQuery("tickets that are overdue").overdueOnly).toBe(true);
  });
});

describe("buildCopilotContext retrieval", () => {
  const data: CopilotData = {
    leads: [
      // Hot lead in Bengaluru with a demo and no won deal.
      {
        id: "L1",
        name: "Hot Bengaluru",
        source: "Referral",
        tags: ["a", "b"],
        notes: "ready to buy, pricing, demo, interested",
        budget: true,
        city: "Bengaluru",
        last_activity_at: now,
        created_at: daysAgo(1),
      },
      // Hot lead in Pune (long-tail city), must survive the cap when asked for Pune.
      {
        id: "L2",
        name: "Hot Pune",
        source: "Referral",
        tags: ["a", "b"],
        notes: "ready to buy, pricing, demo, interested",
        budget: true,
        city: "Pune",
        last_activity_at: now,
        created_at: daysAgo(1),
      },
      // Cold, stale lead that should be filtered out of a "hot" query.
      {
        id: "L3",
        name: "Cold Old",
        source: "CSV Upload",
        tags: [],
        notes: "not interested",
        budget: false,
        city: "Bengaluru",
        last_activity_at: daysAgo(60),
        created_at: daysAgo(90),
      },
    ],
    deals: [
      { id: "D1", title: "Big open", stage_id: "S2", value: 500000, status: "OPEN", owner_id: "U1", lead_id: "L1", created_at: daysAgo(2) },
      { id: "D2", title: "Small open", stage_id: "S1", value: 20000, status: "OPEN", owner_id: "U2", lead_id: null, created_at: daysAgo(2) },
      { id: "D3", title: "Old won", stage_id: "S3", value: 300000, status: "WON", owner_id: "U1", lead_id: null, created_at: daysAgo(200) },
    ],
    stages: [
      { id: "S1", sort_order: 0 },
      { id: "S2", sort_order: 1 },
      { id: "S3", sort_order: 2 },
    ],
    contacts: [
      { id: "C1", name: "Dormant Dan", company: "Acme", email: "dan@acme.example.com", created_at: daysAgo(90) },
    ],
    tickets: [
      { subject: "Refund stuck", priority: "HIGH", status: "OPEN", sla_due_at: daysAgo(1), created_at: daysAgo(3) },
      { subject: "On track", priority: "LOW", status: "OPEN", sla_due_at: daysAgo(-5), created_at: daysAgo(1) },
    ],
    users: [
      { id: "U1", name: "Asha", role: "SALES_AGENT" },
      { id: "U2", name: "Neha", role: "SALES_AGENT" },
    ],
    activities: [
      { type: "DEMO", lead_id: "L1", owner_id: "U1", created_at: now },
      { type: "DEMO", lead_id: "L2", owner_id: "U2", created_at: now },
    ],
    messages: [
      { lead_id: "L1", body: "yes interested ready to buy great pricing demo" },
      { lead_id: "L2", body: "yes interested ready to buy great pricing demo" },
    ],
  };

  it("surfaces a long-tail city match that a blind top-N would drop", () => {
    const c = ctx(data, "hot leads from Pune");
    expect(c.leads.map((l) => l.name)).toContain("Hot Pune");
    // City filter applied → no Bengaluru leads leak in.
    expect(c.leads.every((l) => (l.city ?? "").toLowerCase() === "pune")).toBe(true);
  });

  it("excludes cold leads from a hot-grade query but keeps whole-workspace counts", () => {
    const c = ctx(data, "which leads are hot right now");
    expect(c.leads.map((l) => l.name)).not.toContain("Cold Old");
    expect(c.leads.every((l) => l.grade === "HOT")).toBe(true);
    expect(c.counts.leads).toBe(3); // count still reflects the full workspace
  });

  it("applies value thresholds to deals", () => {
    const c = ctx(data, "open deals over ₹1 lakh");
    expect(c.deals.map((d) => d.title)).toContain("Big open");
    expect(c.deals.map((d) => d.title)).not.toContain("Small open");
  });

  it("keeps deals open-only unless the question is about won/lost", () => {
    const openOnly = ctx(data, "which deals are likely to close");
    expect(openOnly.deals.every((d) => d.status === "OPEN")).toBe(true);
    const wonToo = ctx(data, "show me won deals");
    expect(wonToo.deals.some((d) => d.status === "WON")).toBe(true);
  });

  it("filters tickets to overdue when asked", () => {
    const c = ctx(data, "which support tickets are overdue");
    expect(c.tickets.length).toBe(1);
    expect(c.tickets[0].overdue).toBe(true);
  });

  it("expands contacts only when the question targets them", () => {
    expect(ctx(data, "which leads are hot").contacts.length).toBe(0);
    const c = ctx(data, "inactive customers from the last 30 days");
    expect(c.contacts.map((x) => x.name)).toContain("Dormant Dan");
  });

  it("stays within the token cap", () => {
    expect(buildCopilotContext(data, "everything").length).toBeLessThanOrEqual(14000);
  });
});

describe("conversational memory", () => {
  it("renders prior turns oldest-first into the prompt block", () => {
    const block = buildHistoryBlock([
      { question: "which leads are hot?", answer: "12 hot leads." },
      { question: "which are in Pune?", answer: "3 of them are in Pune." },
    ]);
    expect(block).toContain("CONVERSATION SO FAR");
    expect(block).toContain("Q: which leads are hot?");
    expect(block).toContain("A: 3 of them are in Pune.");
    // oldest turn appears before the newest
    expect(block.indexOf("which leads are hot?")).toBeLessThan(block.indexOf("which are in Pune?"));
  });

  it("is empty when there is no history", () => {
    expect(buildHistoryBlock()).toBe("");
    expect(buildHistoryBlock([])).toBe("");
  });

  it("caps to the last 6 turns", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));
    const block = buildHistoryBlock(many);
    expect(block).not.toContain("q3"); // dropped
    expect(block).toContain("q4"); // kept (last 6: q4..q9)
    expect(block).toContain("q9");
  });

  it("sanitizeHistory drops malformed turns and caps length", () => {
    const clean = sanitizeHistory([
      { question: "ok", answer: "fine" },
      { question: "", answer: "no question" }, // dropped
      { question: "no answer", answer: "" }, // dropped
      { question: 42, answer: true }, // dropped (non-string)
      "garbage", // dropped
      null, // dropped
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0]).toEqual({ question: "ok", answer: "fine" });
    expect(sanitizeHistory("not an array")).toEqual([]);
    expect(sanitizeHistory(undefined)).toEqual([]);
  });

  it("sanitizeHistory keeps only the last 6 turns", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    const clean = sanitizeHistory(many);
    expect(clean).toHaveLength(6);
    expect(clean[0].question).toBe("q3");
    expect(clean[5].question).toBe("q8");
  });
});

describe("agentic planner (prompt building + plan parsing)", () => {
  it("planner prompt carries the catalog, history and question", () => {
    const { system, user } = buildPlannerPrompt(
      "how many leads by source?",
      [{ question: "hi", answer: "hello" }],
      TOOL_CATALOG,
    );
    expect(system.toLowerCase()).toContain("planner");
    expect(user).toContain("aggregate");
    expect(user).toContain("CONVERSATION SO FAR");
    expect(user).toContain("QUESTION: how many leads by source?");
  });

  it("parseToolPlan accepts {tools:[...]} and keeps only known tools", () => {
    const plan = parseToolPlan(
      JSON.stringify({
        tools: [
          { name: "aggregate", args: { entity: "leads", groupBy: "source" } },
          { name: "queryLeads", args: { grade: "HOT" } },
          { name: "dropDatabase", args: {} }, // off-menu → dropped
        ],
      }),
    );
    expect(plan.map((p) => p.name)).toEqual(["aggregate", "queryLeads"]);
    expect(plan[0].args).toEqual({ entity: "leads", groupBy: "source" });
  });

  it("parseToolPlan tolerates code fences and a bare array", () => {
    const fenced = "```json\n[{\"name\":\"queryDeals\",\"args\":{}}]\n```";
    const plan = parseToolPlan(fenced);
    expect(plan).toHaveLength(1);
    expect(plan[0].name).toBe("queryDeals");
    expect(plan[0].args).toEqual({});
  });

  it("parseToolPlan returns [] on garbage or non-object entries", () => {
    expect(parseToolPlan("not json")).toEqual([]);
    expect(parseToolPlan(JSON.stringify({ tools: ["x", 3, null] }))).toEqual([]);
    expect(parseToolPlan(JSON.stringify({ tools: [] }))).toEqual([]);
  });

  it("parseToolPlan caps the plan at 4 tools", () => {
    const many = { tools: Array.from({ length: 8 }, () => ({ name: "queryLeads", args: {} })) };
    expect(parseToolPlan(JSON.stringify(many))).toHaveLength(4);
  });

  it("answer prompt includes the tool results and question", () => {
    const { user } = buildToolAnswerPrompt(
      "summarize",
      [],
      [{ tool: "aggregate", columns: ["Source", "Count"], rows: [["WhatsApp", 5]], count: 1 }],
    );
    expect(user).toContain("TOOL RESULTS");
    expect(user).toContain("WhatsApp");
    expect(user).toContain("QUESTION: summarize");
  });
});
