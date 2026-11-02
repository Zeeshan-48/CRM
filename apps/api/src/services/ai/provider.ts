import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import config from "../../config";
import logger from "../../utils/logger";
import type { ToolCall, ToolResult } from "./copilot-tools";
import { TOOL_NAMES } from "./copilot-tools";
import * as heuristics from "./heuristics";
import type {
  CoachResult,
  CopilotData,
  CopilotResult,
  CopilotTurn,
  DealAssessInput,
  DealInsight,
  EmailDraft,
  LeadAssessInput,
  LeadInsight,
  OutreachDraft,
  OutreachInput,
  OutreachPurpose,
  SentimentResult,
  VoiceCallResult,
} from "./heuristics";

/**
 * Generative AI seam. The simulated provider is the default and is fully
 * offline/deterministic. To go live, implement the same interface against a
 * real model and the factory below picks it up from env keys; no route or
 * service changes needed.
 */
export interface AIProvider {
  readonly name: string;
  writeEmail(params: WriteEmailParams): Promise<EmailDraft>;
  copilot(data: CopilotData, query: string, history?: CopilotTurn[]): Promise<CopilotResult>;
  // Agentic copilot (tool-calling). Present only on real LLM providers, the
  // service checks `supportsAgentic` and falls back to `copilot()` otherwise.
  supportsAgentic?: boolean;
  planCopilotTools?(query: string, history: CopilotTurn[], catalog: string): Promise<ToolCall[]>;
  answerFromTools?(
    query: string,
    history: CopilotTurn[],
    results: ToolResult[]
  ): Promise<CopilotResult>;
  coach(params: { grade?: string; value?: number }): Promise<CoachResult>;
  voiceCall(params: {
    direction?: string;
    goal?: string;
    contactName?: string;
  }): Promise<VoiceCallResult>;
  sentiment(text: string): Promise<SentimentResult>;
  summarize(text: string): Promise<string>;
  composeOutreach(input: OutreachInput): Promise<OutreachDraft>;
  assessLead(input: LeadAssessInput): Promise<LeadInsight>;
  assessDeal(input: DealAssessInput): Promise<DealInsight>;
}

class SimulatedAIProvider implements AIProvider {
  readonly name: string = "simulated";

  async writeEmail(params: WriteEmailParams): Promise<EmailDraft> {
    return heuristics.writeEmail(params);
  }
  async copilot(
    data: CopilotData,
    query: string,
    _history?: CopilotTurn[]
  ): Promise<CopilotResult> {
    // The deterministic path is single-shot; conversational memory is an
    // LLM-only enhancement, so history is intentionally ignored here.
    return heuristics.copilot(data, query);
  }
  async coach(params: { grade?: string; value?: number }): Promise<CoachResult> {
    return heuristics.coach(params);
  }
  async voiceCall(params: {
    direction?: string;
    goal?: string;
    contactName?: string;
  }): Promise<VoiceCallResult> {
    return heuristics.simulateVoiceCall(params);
  }
  async sentiment(text: string): Promise<SentimentResult> {
    return heuristics.sentiment(text);
  }
  async summarize(text: string): Promise<string> {
    return heuristics.summarize(text);
  }
  async composeOutreach(input: OutreachInput): Promise<OutreachDraft> {
    return heuristics.composeOutreach(input);
  }
  async assessLead(input: LeadAssessInput): Promise<LeadInsight> {
    return heuristics.leadInsight(input);
  }
  async assessDeal(input: DealAssessInput): Promise<DealInsight> {
    return heuristics.dealInsight(input);
  }
}

// Per-provider default models (override via env). Fast, low-latency tiers are a
// good fit for short outreach emails.
const GEMINI_MODEL = process.env.AI_EMAIL_GEMINI_MODEL || "gemini-2.5-flash-lite";
const OPENAI_MODEL = process.env.AI_EMAIL_OPENAI_MODEL || "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.AI_EMAIL_ANTHROPIC_MODEL || "claude-opus-4-8";

// What each draft type is trying to achieve, fed to the model. To add a type:
// add a key here (used by the AI path) AND the same key to EMAIL_BLUEPRINTS in
// heuristics.ts (the no-AI fallback) and to the frontend's DRAFT_TYPES.
const EMAIL_INTENT: Record<string, string> = {
  sales: "a first cold-outreach email introducing how we can help",
  followup: "a short, friendly follow-up nudging a previous note",
  response: "a helpful reply to a question they asked, ending with a clear next step",
  referral: "a warm introduction email after being referred to them, mentioning the referral naturally and proposing a short call",
  meeting: "a concise email requesting a short meeting or demo, offering a couple of specific time options",
  proposal: "an email sharing a tailored proposal and pricing overview, inviting questions and a time to discuss",
  reengage: "a friendly re-engagement email reconnecting after they went quiet, with a low-pressure next step",
  thankyou: "a brief thank-you email after a call or meeting, recapping the agreed next step",
  renewal: "an email about an upcoming renewal and a relevant upsell, framed around the value they have gained",
};

const EMAIL_SYSTEM =
  "You are an expert B2B sales copywriter for a CRM platform. " +
  "Write concise, warm, professional emails that earn a reply. " +
  "Keep the body under about 120 words and use the recipient's first name naturally. " +
  "Do not invent specific facts, prices, or features, and never use em dashes or " +
  "placeholders like [Name].";

const buildEmailUser = (
  intent: string,
  name: string,
  company: string,
  brief?: string
): string =>
  `Write ${intent} to ${name}${company ? ` at ${company}` : ""}. ` +
  // A free-form brief from the sender (what the email is about) takes priority
  // over the generic intent, so the draft is specific to this situation.
  (brief ? `The email must specifically cover: ${brief}. ` : "") +
  `Sign off as "The team".\n\n` +
  `Respond with ONLY a JSON object of the form {"subject": "...", "body": "..."} ` +
  `with no markdown, no code fences, and no commentary.`;

// Params for writeEmail. `intent` + `fallback` are set for workspace-defined
// custom types (tenants.config.emailDraftTypes): `intent` steers the LLM prompt
// and `fallback` supplies the no-AI copy. Built-in types leave both unset and
// resolve through EMAIL_INTENT / EMAIL_BLUEPRINTS by key.
export type WriteEmailParams = {
  type?: string;
  name?: string;
  company?: string;
  // Free-form instructions from the sender ("what this email is for"), used to
  // steer the draft beyond the preset type.
  brief?: string;
  intent?: string;
  fallback?: { subject: string; body: string };
};

const parseEmailDraft = (text: string): { subject: string; body: string } | null => {
  try {
    const json = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(json) as { subject?: unknown; body?: unknown };
    if (typeof parsed.subject === "string" && typeof parsed.body === "string") {
      return { subject: parsed.subject.trim(), body: parsed.body.trim() };
    }
  } catch {
    /* fall through to null -> heuristic */
  }
  return null;
};

const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}...` : s);

// ---- Outreach (agent messages: sales / marketing / collections / success) ----

const OUTREACH_INTENT: Record<OutreachPurpose, string> = {
  sales:
    "This is a first outreach to a sales lead who showed interest. Goal: earn a short demo or call. Warm, specific, low-pressure.",
  marketing:
    "This is a nurture message to a lead in a marketing segment. Goal: re-spark interest and invite a next step. Friendly and value-led.",
  collections:
    "This is a polite reminder about an overdue invoice. Goal: prompt payment courteously. Professional and clear, never harsh.",
  success:
    "This is an encouraging nudge to a learner who has fallen behind in their course. Goal: motivate them to resume. Supportive, upbeat, brief.",
};

const OUTREACH_CHANNEL: Record<"WHATSAPP" | "EMAIL", string> = {
  WHATSAPP:
    "Channel is WhatsApp: write 1 to 3 short sentences, under about 350 characters, conversational, at most one emoji, with no subject line and no formal email sign-off.",
  EMAIL:
    "Channel is email: write a short subject and a body under about 110 words with one clear call to action, then a brief sign-off as the brand.",
};

const buildOutreachSystem = (input: OutreachInput): string => {
  const must =
    input.mustInclude && input.mustInclude.length
      ? ` You MUST include the following text verbatim, exactly as written and unchanged: ${input.mustInclude
          .map((s) => `"${s}"`)
          .join(", ")}.`
      : "";
  return (
    `You are an expert outreach copywriter for ${input.brand}. ${OUTREACH_INTENT[input.purpose]} ` +
    `${OUTREACH_CHANNEL[input.channel]} ` +
    `Address the recipient by their first name. Use ONLY the facts provided in the user message, ` +
    `never invent prices, amounts, dates, discounts, features, links, or names.${must} ` +
    `Do not use placeholders like [Name] or {variable}, and never use em dashes. ` +
    `Write plainly in ${input.brand}'s voice as the sender.`
  );
};

const buildOutreachUser = (input: OutreachInput): string => {
  const facts = Object.fromEntries(
    Object.entries(input.facts ?? {}).filter(
      ([, v]) => v !== null && v !== undefined && v !== ""
    )
  );
  return (
    `Recipient first name: ${input.recipientName}\n` +
    `Facts you may use:\n${cap(JSON.stringify(facts), 3000)}\n\n` +
    `Write the message now. Respond with ONLY a JSON object ` +
    `{"subject": string, "body": string}, no markdown, no code fences, no commentary. ` +
    `For WhatsApp, use an empty subject.`
  );
};

// ---- Lead & deal assessment (scoring reasoning + next best action) ----

const LEAD_ASSESS_SYSTEM =
  "You are a precise B2B sales analyst. Assess ONE lead using only the signals provided " +
  "(a heuristic score breakdown, source, recent messages and activities). Explain the read in " +
  "plain language, cite the concrete signals that drive it, and give one specific next action. " +
  "Never invent messages, names, prices, or facts not present. Keep it tight and practical.";

const buildLeadAssessUser = (input: LeadAssessInput): string => {
  const ctx = {
    name: input.name,
    scoreBreakdown: input.score,
    source: input.source ?? null,
    city: input.city ?? null,
    tags: input.tags ?? [],
    notes: input.notes ? cap(input.notes, 600) : null,
    daysSinceActivity: input.daysSinceActivity ?? null,
    recentActivities: (input.recentActivities ?? []).slice(0, 12),
    recentMessages: (input.recentMessages ?? []).slice(0, 8).map((m) => cap(m, 300)),
  };
  return (
    `LEAD SIGNALS:\n${cap(JSON.stringify(ctx), 8000)}\n\n` +
    `Respond with ONLY a JSON object: ` +
    `{"summary": string, "reasons": string[], "recommendedAction": string, ` +
    `"temperature": "HOT"|"WARM"|"COLD"}. ` +
    `Give 2-4 reasons grounded in the signals. No markdown, no code fences.`
  );
};

const DEAL_ASSESS_SYSTEM =
  "You are an expert B2B sales strategist. Assess ONE open deal using only the signals provided " +
  "(a computed win probability and health, stage, value, competitors, stakeholders, and recent " +
  "activity). Give a crisp read, the single best next action, and the top risks. Reference the " +
  "provided win probability, do not invent a different number. No fluff, no invented facts.";

const buildDealAssessUser = (input: DealAssessInput): string => {
  const ctx = {
    title: input.title,
    value: input.value,
    stage: input.stageName ?? null,
    winProbability: input.winProbability,
    health: input.healthLabel,
    daysSinceActivity: input.daysSinceActivity ?? null,
    competitors: input.competitors ?? [],
    stakeholders: input.stakeholders ?? [],
    leadGrade: input.leadGrade ?? null,
    recentActivities: (input.recentActivities ?? []).slice(0, 12),
  };
  return (
    `DEAL SIGNALS:\n${cap(JSON.stringify(ctx), 8000)}\n\n` +
    `Respond with ONLY a JSON object: ` +
    `{"assessment": string, "nextBestAction": string, "risks": string[]}. ` +
    `Give 1-3 risks grounded in the signals. No markdown, no code fences.`
  );
};

const parseJsonObject = (text: string): Record<string, unknown> => {
  const json = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("not a JSON object");
  return parsed as Record<string, unknown>;
};

const asStringArray = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, max) : [];

// ---------- Copilot question analysis (intent-driven retrieval) ----------
//
// A blind "top-30 by score" context makes the copilot answer correctly on a
// 50-lead demo tenant but go blind on the long tail of a real account, a
// question about "leads from Pune under ₹50k created last month" fails if those
// rows aren't in the global top-30. So we parse the question into a focus
// (which entities + which filters) and hand the model a slice that is FILTERED
// and RANKED to exactly what was asked, with a bigger budget for the focused
// entity. It stays a heuristic pre-filter, the LLM still does the reasoning.

type CopilotEntity = "leads" | "deals" | "tickets" | "contacts" | "agents";

interface QueryFocus {
  entities: Set<CopilotEntity>;
  city: string | null;
  minValue: number | null;
  maxValue: number | null;
  recencyDays: number | null;
  hasDemo: boolean;
  notPurchased: boolean;
  overdueOnly: boolean;
  wonLost: boolean; // question is about closed (WON/LOST) deals, not just open
  grade: "HOT" | "WARM" | "COLD" | null;
  terms: string[];
}

const AMOUNT_UNIT: Record<string, number> = {
  k: 1e3,
  l: 1e5,
  lac: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
};

const parseAmount = (num: string, unit?: string): number | null => {
  const n = parseFloat(num.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const mult = unit ? (AMOUNT_UNIT[unit.toLowerCase()] ?? 1) : 1;
  return Math.round(n * mult);
};

const STOPWORDS = new Set([
  "show", "list", "give", "find", "which", "what", "whats", "who", "whom", "that",
  "have", "with", "from", "this", "these", "those", "them", "they", "their",
  "about", "into", "over", "under", "than", "then", "there", "here", "still",
  "leads", "lead", "deals", "deal", "tickets", "ticket", "customers", "customer",
  "contacts", "contact", "agents", "agent", "recent", "last", "days", "month",
  "week", "attended", "purchased", "purchase", "haven", "hasn", "been",
]);

export const analyzeQuery = (query: string): QueryFocus => {
  const q = (query || "").toLowerCase();
  const entities = new Set<CopilotEntity>();
  if (/\blead|prospect|\bhot\b|\bwarm\b|\bcold\b/.test(q)) entities.add("leads");
  if (/\bdeal|opportunit|pipeline|forecast|revenue|\bwon\b|\blost\b|close|closing/.test(q))
    entities.add("deals");
  if (/ticket|support|\bsla\b|complaint|escalat/.test(q)) entities.add("tickets");
  if (/contact|customer|\bclient|\baccount/.test(q)) entities.add("contacts");
  if (/\bagent|\brep\b|salesperson|\bteam\b|underperform|performance|quota/.test(q))
    entities.add("agents");
  if (entities.size === 0) {
    entities.add("leads");
    entities.add("deals");
  }

  const cityMatch = q.match(/\b(?:in|from|based in|located in|near)\s+([a-z]+)/);
  const city = cityMatch ? cityMatch[1] : null;

  const minM = q.match(
    /(?:over|above|more than|greater than|at least|bigger than|>=?)\s*(?:₹|rs\.?|inr)?\s*([\d,.]+)\s*(k|lakhs?|lac|l|crores?|cr)?/
  );
  const maxM = q.match(
    /(?:under|below|less than|at most|up ?to|smaller than|within|<=?)\s*(?:₹|rs\.?|inr)?\s*([\d,.]+)\s*(k|lakhs?|lac|l|crores?|cr)?/
  );
  const minValue = minM ? parseAmount(minM[1], minM[2]) : null;
  const maxValue = maxM ? parseAmount(maxM[1], maxM[2]) : null;

  let recencyDays: number | null = null;
  const daysM = q.match(/(?:last|past|previous|within|in the)\s+(\d+)\s+days?/) || q.match(/(\d+)\s+days?/);
  if (daysM) recencyDays = parseInt(daysM[1], 10);
  else if (/\btoday\b/.test(q)) recencyDays = 1;
  else if (/\byesterday\b/.test(q)) recencyDays = 2;
  else if (/(this|last|past)\s+week|\bfortnight\b|(two|2)\s+weeks?/.test(q))
    recencyDays = /(two|2)\s+weeks?|fortnight/.test(q) ? 14 : 7;
  else if (/(this|last|past)\s+month/.test(q)) recencyDays = 30;
  else if (/(this|last|past)\s+quarter/.test(q)) recencyDays = 90;

  const grade = /\bhot\b/.test(q)
    ? "HOT"
    : /\bwarm\b/.test(q)
      ? "WARM"
      : /\bcold\b/.test(q)
        ? "COLD"
        : null;

  const terms = q.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));

  return {
    entities,
    city,
    minValue,
    maxValue,
    recencyDays,
    hasDemo: /\bdemo\b/.test(q),
    notPurchased:
      /(?:not|haven.?t|hasn.?t|never|without|no)\b[^.?!]{0,30}(?:purchas|bought|buy|won|convert|clos)/.test(q),
    overdueOnly: /(overdue|breach|past due|late|missed sla)/.test(q),
    wonLost: /\bwon\b|\blost\b|closed deal|closed-won|closed won/.test(q),
    grade,
    terms,
  };
};

const withinDays = (value: Date | string | null | undefined, days: number, now: number): boolean => {
  if (!value) return false;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return false;
  return (now - ms) / 86_400_000 <= days;
};

// Renders the recent conversation into a compact, bounded transcript so the LLM
// can resolve follow-ups against earlier turns ("and which of those are in
// Delhi?"). Bounded on both axes, last few turns, each answer truncated, so
// memory never blows the token budget.
const MAX_HISTORY_TURNS = 6;
export const buildHistoryBlock = (history?: CopilotTurn[]): string => {
  if (!history?.length) return "";
  const turns = history
    .filter((t) => t && typeof t.question === "string" && typeof t.answer === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => `Q: ${cap(t.question.trim(), 300)}\nA: ${cap(t.answer.trim(), 500)}`)
    .join("\n");
  if (!turns) return "";
  return (
    `CONVERSATION SO FAR (oldest first, the new question may refer back to it):\n` +
    `${turns}\n\n`
  );
};

// Parses the model's `{answer, columns, rows}` JSON (shared by the snapshot and
// agentic answer hops). Returns null on an unexpected shape so the caller can
// fall back. Rows are coerced to strings/numbers; columns to strings.
const parseCopilotAnswer = (text: string, intent: string): CopilotResult | null => {
  const json = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(json) as { answer?: unknown; columns?: unknown; rows?: unknown };
  if (typeof parsed.answer !== "string") return null;
  const columns = Array.isArray(parsed.columns) ? parsed.columns.map(String) : [];
  const rows = Array.isArray(parsed.rows)
    ? parsed.rows
        .filter((r): r is unknown[] => Array.isArray(r))
        .map((r) => r.map((c) => (typeof c === "number" ? c : String(c))))
    : [];
  return { intent, answer: parsed.answer, columns, rows };
};

const COPILOT_ANSWER_SYSTEM =
  "You are a precise CRM analytics copilot. Answer the user's question using ONLY the data " +
  "provided, never invent records, names, or numbers that are not present. Be concise and " +
  "specific. When the answer is naturally a list (leads, deals, tickets, agents), include a small " +
  "supporting table. This is a conversation: if the new question refers to earlier turns " +
  "(e.g. 'those', 'that list', 'narrow it to…'), resolve it against the conversation so far.";

const COPILOT_ANSWER_FORMAT =
  `Respond with ONLY a JSON object: ` +
  `{"answer": string, "columns": string[], "rows": (string|number)[][]}. ` +
  `Use empty columns/rows when a table is not helpful. No markdown, no code fences.`;

// Planner hop: given the question + tool catalog, the model emits the minimal
// set of tool calls whose results will answer it.
export const buildPlannerPrompt = (
  query: string,
  history: CopilotTurn[],
  catalog: string
): { system: string; user: string } => ({
  system:
    "You are a query planner for a CRM analytics copilot. Choose the MINIMAL set of tool calls " +
    "whose results answer the user's question with real data. Prefer `aggregate` for how-many / " +
    "compare / by-X / totals. Use several tools only when genuinely needed. If the question is " +
    "conversational and needs no data, return an empty tools array. Never invent tools or args.",
  user:
    `${catalog}\n\n` +
    buildHistoryBlock(history) +
    `QUESTION: ${query}\n\n` +
    `Respond with ONLY JSON: {"tools": [{"name": string, "args": object}]}. ` +
    `Use only the listed tool names and documented arguments. No markdown, no code fences.`,
});

// Parses + validates a planner response into safe ToolCalls. Anything malformed
// or off-menu is dropped; returns [] when there's nothing valid (→ the service
// falls back to the snapshot path).
export const parseToolPlan = (text: string): ToolCall[] => {
  let parsed: unknown;
  try {
    const json = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const rawTools =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { tools?: unknown }).tools)
        ? (parsed as { tools: unknown[] }).tools
        : [];
  const calls: ToolCall[] = [];
  for (const t of rawTools) {
    if (!t || typeof t !== "object") continue;
    const name = (t as { name?: unknown }).name;
    const args = (t as { args?: unknown }).args;
    if (typeof name !== "string" || !TOOL_NAMES.has(name)) continue;
    calls.push({ name, args: args && typeof args === "object" ? (args as Record<string, unknown>) : {} });
  }
  return calls.slice(0, 4);
};

// Answer hop: the model writes the final answer + table from the tool results.
export const buildToolAnswerPrompt = (
  query: string,
  history: CopilotTurn[],
  results: ToolResult[]
): { system: string; user: string } => ({
  system: COPILOT_ANSWER_SYSTEM,
  user:
    buildHistoryBlock(history) +
    `TOOL RESULTS (JSON, already scoped to this workspace):\n${cap(JSON.stringify(results), 14_000)}\n\n` +
    `QUESTION: ${query}\n\n` +
    COPILOT_ANSWER_FORMAT,
});

// Condenses the (capped) CRM snapshot into a compact, bounded JSON context the
// model can reason over without blowing the token budget. Uses the same scoring
// + win-probability engine as the deterministic copilot, so the numbers agree.
// The slice is filtered and ranked to the question (see analyzeQuery) so long-tail
// records that match survive the per-entity cap.
export const buildCopilotContext = (data: CopilotData, query: string): string => {
  const acts = data.activities ?? [];
  const msgs = data.messages ?? [];
  const now = Date.now();
  const focus = analyzeQuery(query);

  // Per-entity row budget: the entity the question is about gets the big slice.
  const budget = (e: CopilotEntity): number => (focus.entities.has(e) ? 60 : 12);

  // Leads, score everyone, then keep only rows matching the question's filters,
  // ranked so term/keyword matches and higher scores float to the top of the cap.
  const leadMatchesTerms = (l: (typeof data.leads)[number]): boolean =>
    focus.terms.length === 0 ||
    focus.terms.some((t) =>
      `${l.name ?? ""} ${l.city ?? ""} ${l.source ?? ""} ${l.notes ?? ""}`.toLowerCase().includes(t)
    );
  const filteredLeads = data.leads
    .map((l) => ({ l, s: heuristics.scoreLead(l, acts, msgs), t: leadMatchesTerms(l) }))
    .filter((x) => {
      if (focus.grade && x.s.grade !== focus.grade) return false;
      if (focus.city && (x.l.city ?? "").toLowerCase() !== focus.city) return false;
      if (focus.hasDemo && !acts.some((a) => a.lead_id === x.l.id && a.type === "DEMO"))
        return false;
      if (
        focus.notPurchased &&
        data.deals.some((d) => d.lead_id === x.l.id && d.status === "WON")
      )
        return false;
      if (
        focus.recencyDays !== null &&
        !withinDays(x.l.last_activity_at || x.l.created_at, focus.recencyDays, now)
      )
        return false;
      return true;
    })
    .sort((a, b) => Number(b.t) - Number(a.t) || b.s.total - a.s.total)
    .slice(0, budget("leads"))
    .map((x) => ({
      name: x.l.name ?? "-",
      city: x.l.city ?? null,
      source: x.l.source ?? null,
      score: x.s.total,
      grade: x.s.grade,
    }));

  // Deals, open by default; include closed only when the question is about them.
  const dealPool = focus.wonLost
    ? data.deals
    : data.deals.filter((d) => d.status === "OPEN");
  const openDeals = data.deals.filter((d) => d.status === "OPEN");
  const filteredDeals = dealPool
    .filter((d) => {
      if (focus.minValue !== null && d.value < focus.minValue) return false;
      if (focus.maxValue !== null && d.value > focus.maxValue) return false;
      if (focus.recencyDays !== null && !withinDays(d.created_at, focus.recencyDays, now))
        return false;
      return true;
    })
    .map((d) => ({ d, p: heuristics.winProbability(d, data.stages, acts) }))
    .sort((a, b) => b.d.value - a.d.value)
    .slice(0, budget("deals"))
    .map((x) => ({
      title: x.d.title ?? "-",
      value: x.d.value,
      status: x.d.status,
      winPct: x.p,
    }));
  const weightedOpenPipeline = Math.round(
    openDeals.reduce(
      (sum, d) => sum + (d.value * heuristics.winProbability(d, data.stages, acts)) / 100,
      0
    )
  );

  const filteredTickets = data.tickets
    .filter((t) => t.status !== "CLOSED")
    .filter((t) => {
      const overdue = t.sla_due_at ? new Date(t.sla_due_at).getTime() < now : false;
      if (focus.overdueOnly && !overdue) return false;
      if (focus.recencyDays !== null && !withinDays(t.created_at, focus.recencyDays, now))
        return false;
      return true;
    })
    .slice(0, budget("tickets"))
    .map((t) => ({
      subject: cap(t.subject ?? "-", 80),
      priority: t.priority,
      status: t.status,
      overdue: t.sla_due_at ? new Date(t.sla_due_at).getTime() < now : false,
    }));

  const wonByOwner = new Map<string, number>();
  for (const d of data.deals) {
    if (d.status === "WON" && d.owner_id) {
      wonByOwner.set(d.owner_id, (wonByOwner.get(d.owner_id) ?? 0) + 1);
    }
  }
  const actsByOwner = new Map<string, number>();
  for (const a of acts) {
    if (a.owner_id) actsByOwner.set(a.owner_id, (actsByOwner.get(a.owner_id) ?? 0) + 1);
  }
  const agents = data.users
    .filter((u) => ["SALES_AGENT", "MANAGER"].includes(u.role))
    .map((u) => ({
      name: u.name,
      role: u.role,
      dealsWon: wonByOwner.get(u.id) ?? 0,
      activities: actsByOwner.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.dealsWon * 10 + b.activities - (a.dealsWon * 10 + a.activities));

  // Contacts, surfaced with the stale (>30d no activity) ones first, filtered by
  // city when asked; only expanded into rows when the question targets contacts.
  const lastTouch = (id: string): number =>
    acts
      .filter((a) => a.contact_id === id)
      .map((a) => new Date(a.created_at).getTime())
      .sort((a, b) => b - a)[0] ?? 0;
  const staleContacts30d = data.contacts.filter((c) => {
    const last = lastTouch(c.id) || new Date(c.created_at).getTime();
    return (now - last) / 86_400_000 > 30;
  }).length;
  // Contacts have no city column, so terms only *rank* (soft boost), never
  // hard-filter, a descriptor like "inactive" must not wipe out the list.
  const contactMatchesTerms = (c: (typeof data.contacts)[number]): boolean =>
    focus.terms.length === 0 ||
    focus.terms.some((t) =>
      `${c.name} ${c.company ?? ""} ${c.email ?? ""}`.toLowerCase().includes(t)
    );
  const contactRows = focus.entities.has("contacts")
    ? data.contacts
        .map((c) => ({
          c,
          last: lastTouch(c.id) || new Date(c.created_at).getTime(),
          t: contactMatchesTerms(c),
        }))
        .sort((a, b) => Number(b.t) - Number(a.t) || a.last - b.last) // term hits, then most stale
        .slice(0, budget("contacts"))
        .map((x) => ({
          name: x.c.name,
          company: x.c.company ?? null,
          email: x.c.email ?? null,
          inactiveDays: Math.round((now - x.last) / 86_400_000),
        }))
    : [];

  const context = {
    interpretedFilters: {
      entities: [...focus.entities],
      city: focus.city,
      minValue: focus.minValue,
      maxValue: focus.maxValue,
      recencyDays: focus.recencyDays,
      hasDemo: focus.hasDemo,
      notPurchased: focus.notPurchased,
      overdueOnly: focus.overdueOnly,
      grade: focus.grade,
    },
    counts: {
      leads: data.leads.length,
      contacts: data.contacts.length,
      openDeals: openDeals.length,
      wonDeals: data.deals.filter((d) => d.status === "WON").length,
      lostDeals: data.deals.filter((d) => d.status === "LOST").length,
      openTickets: data.tickets.filter((t) => t.status !== "CLOSED").length,
      staleContacts30d,
      agents: agents.length,
    },
    weightedOpenPipeline,
    leads: filteredLeads,
    deals: filteredDeals,
    tickets: filteredTickets,
    contacts: contactRows,
    agents,
    note:
      "leads/deals/tickets/contacts are pre-filtered and ranked to the question via interpretedFilters and capped; counts reflect the whole workspace.",
  };
  return cap(JSON.stringify(context), 14_000);
};

// Real LLM providers. Each implements `generate()` against its SDK; the shared
// methods build the prompt, parse the model's JSON, and fall back to the
// deterministic heuristic on ANY error (missing/invalid key, API failure, bad
// shape) so the feature never breaks. Methods not overridden here keep the
// simulated behaviour until they are wired too.
abstract class LlmProvider extends SimulatedAIProvider {
  protected abstract readonly label: string;
  protected abstract generate(system: string, user: string): Promise<string>;

  override async writeEmail(params: WriteEmailParams): Promise<EmailDraft> {
    // A custom type supplies its own intent; built-ins resolve by key (with a
    // sales default). The resolved `type` is echoed back for display/templates.
    const customIntent = params.intent?.trim();
    const type = customIntent
      ? params.type?.trim() || "custom"
      : params.type && EMAIL_INTENT[params.type]
        ? params.type
        : "sales";
    const intent = customIntent || EMAIL_INTENT[type];
    const name = (params.name || "there").trim();
    const company = (params.company || "").trim();
    const brief = params.brief?.trim() || undefined;
    try {
      const text = await this.generate(EMAIL_SYSTEM, buildEmailUser(intent, name, company, brief));
      const draft = parseEmailDraft(text);
      if (draft) {
        return {
          subject: draft.subject,
          body: draft.body,
          generatedBy: `AI Email Writer (${this.label})`,
          type,
        };
      }
      throw new Error("unexpected response shape");
    } catch (err) {
      logger.warn(`AI email writer (${this.name}) failed, using heuristic draft: ${String(err)}`);
      return heuristics.writeEmail(params);
    }
  }

  readonly supportsAgentic = true;

  override async copilot(
    data: CopilotData,
    query: string,
    history?: CopilotTurn[]
  ): Promise<CopilotResult> {
    try {
      // A terse follow-up ("and which are in Delhi?") carries no entity keywords,
      // so fold the previous question into the retrieval query, the slice then
      // inherits the earlier subject (leads/deals/etc.) instead of defaulting.
      const priorQuestion = history?.length ? history[history.length - 1].question : "";
      const retrievalQuery = priorQuestion ? `${priorQuestion} ${query}` : query;
      const user =
        buildHistoryBlock(history) +
        `DATA (filtered and ranked to the question for this workspace):\n${buildCopilotContext(data, retrievalQuery)}\n\n` +
        `QUESTION: ${query}\n\n` +
        COPILOT_ANSWER_FORMAT;
      const text = await this.generate(COPILOT_ANSWER_SYSTEM, user);
      const result = parseCopilotAnswer(text, "ai");
      if (result) return result;
      throw new Error("unexpected copilot response shape");
    } catch (err) {
      logger.warn(`AI copilot (${this.name}) failed, using heuristic answer: ${String(err)}`);
      return heuristics.copilot(data, query);
    }
  }

  // Planner hop, returns the tool calls whose results answer the question. A
  // generate() failure throws (service falls back); an unparseable/empty plan
  // returns [] (service also falls back to the snapshot path).
  async planCopilotTools(
    query: string,
    history: CopilotTurn[],
    catalog: string
  ): Promise<ToolCall[]> {
    const { system, user } = buildPlannerPrompt(query, history, catalog);
    const text = await this.generate(system, user);
    return parseToolPlan(text);
  }

  // Answer hop, writes the final answer + table from the executed tool results.
  // Throws on any failure so the service can fall back to the snapshot path.
  async answerFromTools(
    query: string,
    history: CopilotTurn[],
    results: ToolResult[]
  ): Promise<CopilotResult> {
    const { system, user } = buildToolAnswerPrompt(query, history, results);
    const text = await this.generate(system, user);
    const result = parseCopilotAnswer(text, "agentic");
    if (result) return result;
    throw new Error("unexpected agentic answer shape");
  }

  override async coach(params: { grade?: string; value?: number }): Promise<CoachResult> {
    const grade = (params.grade || "WARM").toUpperCase();
    const value = Number(params.value ?? 0);
    try {
      const system =
        "You are an expert B2B sales coach for a CRM platform. Give specific, practical, " +
        "encouraging coaching for the rep working this deal. No fluff, no placeholders.";
      const user =
        `Deal context: grade is ${grade}` +
        (value ? `, value about Rs ${value.toLocaleString("en-IN")}` : "") +
        `.\n\nReturn ONLY a JSON object: ` +
        `{"strategy": string, "talkingPoints": string[], ` +
        `"objectionHandling": [{"objection": string, "response": string}], "script": string}. ` +
        `Give 3-5 talking points and 2-3 likely objections. No markdown, no code fences.`;
      const text = await this.generate(system, user);
      const json = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(json) as {
        strategy?: unknown;
        talkingPoints?: unknown;
        objectionHandling?: unknown;
        script?: unknown;
      };
      if (typeof parsed.strategy === "string" && typeof parsed.script === "string") {
        const talkingPoints = Array.isArray(parsed.talkingPoints)
          ? parsed.talkingPoints.map(String)
          : [];
        const objectionHandling = Array.isArray(parsed.objectionHandling)
          ? parsed.objectionHandling
              .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
              .map((o) => ({
                objection: String(o.objection ?? ""),
                response: String(o.response ?? ""),
              }))
              .filter((o) => o.objection && o.response)
          : [];
        return {
          strategy: parsed.strategy,
          talkingPoints,
          objectionHandling,
          script: parsed.script,
          coach: `AI Coach (${this.label})`,
        };
      }
      throw new Error("unexpected coach response shape");
    } catch (err) {
      logger.warn(`AI coach (${this.name}) failed, using heuristic coaching: ${String(err)}`);
      return heuristics.coach(params);
    }
  }

  // Used for call-transcript summaries (background paths only). Short text skips
  // the model entirely. JSON form so it works with the forced-JSON `generate()`.
  override async summarize(text: string): Promise<string> {
    const input = (text || "").trim();
    if (input.length < 200) return heuristics.summarize(input);
    try {
      const system =
        "You summarize sales/support call transcripts for a CRM timeline. Capture the outcome and any " +
        "agreed next step in 1-2 crisp sentences. No preamble, no names of the AI.";
      const user =
        `Transcript:\n${cap(input, 8000)}\n\n` +
        `Respond with ONLY a JSON object: {"summary": string}. No markdown, no code fences.`;
      const out = await this.generate(system, user);
      const json = out.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(json) as { summary?: unknown };
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        return parsed.summary.trim();
      }
      throw new Error("unexpected summarize response shape");
    } catch (err) {
      logger.warn(`AI summarize (${this.name}) failed, using heuristic: ${String(err)}`);
      return heuristics.summarize(input);
    }
  }

  override async sentiment(text: string): Promise<SentimentResult> {
    const input = (text || "").trim();
    // Very short text: the heuristic is fine and avoids a network round-trip.
    if (input.length < 12) return heuristics.sentiment(input);
    try {
      const system = "You are a sentiment classifier for CRM messages (email/WhatsApp/chat).";
      const user =
        `Message:\n${cap(input, 2000)}\n\n` +
        `Respond with ONLY JSON: {"label": "Positive"|"Neutral"|"Negative", "score": number} ` +
        `where score is 0 (very negative) to 100 (very positive). No markdown, no code fences.`;
      const out = await this.generate(system, user);
      const json = out.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(json) as { label?: unknown; score?: unknown };
      const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
      const label =
        parsed.label === "Positive" || parsed.label === "Negative" || parsed.label === "Neutral"
          ? parsed.label
          : null;
      if (label && Number.isFinite(score)) return { label, score };
      throw new Error("unexpected sentiment response shape");
    } catch (err) {
      logger.warn(`AI sentiment (${this.name}) failed, using heuristic: ${String(err)}`);
      return heuristics.sentiment(input);
    }
  }

  // Per-recipient outreach copy for the sales/marketing/collections/success
  // agents. Falls back to the caller's exact template on ANY error, and also
  // whenever the model drops a required verbatim string (a real payment link,
  // invoice number, or amount), so a hallucinated link is never sent.
  override async composeOutreach(input: OutreachInput): Promise<OutreachDraft> {
    try {
      const text = await this.generate(buildOutreachSystem(input), buildOutreachUser(input));
      const json = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(json) as { subject?: unknown; body?: unknown };
      const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
      if (!body) throw new Error("empty outreach body");
      for (const req of input.mustInclude ?? []) {
        if (req && !body.includes(req)) throw new Error(`outreach dropped required text: ${req}`);
      }
      const subject =
        typeof parsed.subject === "string" && parsed.subject.trim()
          ? parsed.subject.trim()
          : input.fallbackSubject;
      return { subject, body, generatedBy: `AI Outreach (${this.label})` };
    } catch (err) {
      logger.warn(`AI outreach (${this.name}) failed, using template: ${String(err)}`);
      return heuristics.composeOutreach(input);
    }
  }

  // Reads the lead's real signals and explains the score with a concrete next
  // action. The heuristic (score-breakdown-derived) is the grounding + fallback.
  override async assessLead(input: LeadAssessInput): Promise<LeadInsight> {
    try {
      const text = await this.generate(LEAD_ASSESS_SYSTEM, buildLeadAssessUser(input));
      const parsed = parseJsonObject(text);
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const recommendedAction =
        typeof parsed.recommendedAction === "string" ? parsed.recommendedAction.trim() : "";
      if (!summary || !recommendedAction) throw new Error("unexpected lead assessment shape");
      const temperature =
        parsed.temperature === "HOT" || parsed.temperature === "WARM" || parsed.temperature === "COLD"
          ? parsed.temperature
          : input.score.grade;
      const reasons = asStringArray(parsed.reasons, 5);
      return {
        summary,
        reasons: reasons.length ? reasons : heuristics.leadInsight(input).reasons,
        recommendedAction,
        temperature,
        generatedBy: `AI Lead Analyst (${this.label})`,
      };
    } catch (err) {
      logger.warn(`AI lead assessment (${this.name}) failed, using heuristic: ${String(err)}`);
      return heuristics.leadInsight(input);
    }
  }

  // Reads the deal's real signals and returns a strategic read + next best
  // action, grounded in the already-computed win probability.
  override async assessDeal(input: DealAssessInput): Promise<DealInsight> {
    try {
      const text = await this.generate(DEAL_ASSESS_SYSTEM, buildDealAssessUser(input));
      const parsed = parseJsonObject(text);
      const assessment = typeof parsed.assessment === "string" ? parsed.assessment.trim() : "";
      const nextBestAction =
        typeof parsed.nextBestAction === "string" ? parsed.nextBestAction.trim() : "";
      if (!assessment || !nextBestAction) throw new Error("unexpected deal assessment shape");
      const risks = asStringArray(parsed.risks, 4);
      return {
        assessment,
        nextBestAction,
        risks: risks.length ? risks : heuristics.dealInsight(input).risks,
        generatedBy: `AI Deal Strategist (${this.label})`,
      };
    } catch (err) {
      logger.warn(`AI deal assessment (${this.name}) failed, using heuristic: ${String(err)}`);
      return heuristics.dealInsight(input);
    }
  }
}

class GeminiProvider extends LlmProvider {
  override readonly name = "gemini";
  protected readonly label = "Gemini";
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    super();
    this.ai = new GoogleGenAI({ apiKey });
  }

  protected async generate(system: string, user: string): Promise<string> {
    const res = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: user,
      config: { systemInstruction: system, responseMimeType: "application/json" },
    });
    return res.text ?? "";
  }
}

class OpenAIProvider extends LlmProvider {
  override readonly name = "openai";
  protected readonly label = "OpenAI";
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    super();
    this.client = new OpenAI({ apiKey });
  }

  protected async generate(system: string, user: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return completion.choices[0]?.message?.content ?? "";
  }
}

class AnthropicProvider extends LlmProvider {
  override readonly name = "anthropic";
  protected readonly label = "Claude";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    super();
    this.client = new Anthropic({ apiKey });
  }

  protected async generate(system: string, user: string): Promise<string> {
    const response = await this.client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    });
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
    return text;
  }
}

const underTest = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true";

// Priority: Gemini -> OpenAI -> Claude -> deterministic heuristic default.
const buildProvider = (): AIProvider => {
  // Tests must stay offline + deterministic: never call a real model.
  if (underTest()) return new SimulatedAIProvider();
  if (config.GEMINI_API_KEY) {
    logger.info(`AI provider: gemini (real, model ${GEMINI_MODEL})`);
    return new GeminiProvider(config.GEMINI_API_KEY);
  }
  if (config.OPENAI_API_KEY) {
    logger.info(`AI provider: openai (real, model ${OPENAI_MODEL})`);
    return new OpenAIProvider(config.OPENAI_API_KEY);
  }
  if (config.ANTHROPIC_API_KEY) {
    logger.info(`AI provider: anthropic (real, model ${ANTHROPIC_MODEL})`);
    return new AnthropicProvider(config.ANTHROPIC_API_KEY);
  }
  return new SimulatedAIProvider();
};

export const aiProvider: AIProvider = buildProvider();
