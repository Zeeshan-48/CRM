/**
 * Open CRM offline AI engine: deterministic heuristics, no external keys.
 * Faithful TypeScript port of the v1 server/ai.js. Inputs are shaped like
 * Kysely rows (snake_case) so services can pass query results straight in.
 * Generative seams (email writer, copilot, coach, voice) are swappable for
 * real LLM providers via src/services/ai/provider.ts.
 */

export const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

const sum = <T>(arr: T[], fn: (item: T) => number): number =>
  arr.reduce((acc, item) => acc + fn(item), 0);

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const toMs = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

export const SOURCE_WEIGHT: Record<string, number> = {
  "Website Form": 18,
  "Landing Page": 16,
  "Facebook Lead Ads": 12,
  "Instagram Ads": 11,
  "LinkedIn Forms": 20,
  "Google Ads": 15,
  WhatsApp: 22,
  Telegram: 10,
  Email: 9,
  "Chat Widget": 14,
  API: 12,
  "CSV Upload": 6,
  Referral: 24,
};

export const LEAD_SOURCES = Object.keys(SOURCE_WEIGHT);

const POSITIVE = [
  "interested", "great", "love", "perfect", "yes", "buy", "purchase", "demo",
  "pricing", "ready", "soon", "thanks", "good", "excellent", "happy",
];
const NEGATIVE = [
  "not interested", "expensive", "cancel", "refund", "angry", "bad", "worst",
  "later", "busy", "stop", "unsubscribe", "no thanks", "disappointed", "issue",
  "problem", "delay",
];

const recencyBoost = (value: Date | string | null | undefined): number => {
  const ms = toMs(value);
  if (ms === null) return 0;
  const days = (Date.now() - ms) / 86400000;
  if (days <= 1) return 20;
  if (days <= 3) return 14;
  if (days <= 7) return 9;
  if (days <= 14) return 4;
  return 0;
};

const parseTags = (tags: unknown): string[] =>
  Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];

// ---------- Input shapes (structural, match Kysely rows) ----------

export interface LeadLike {
  id: string;
  source?: string | null;
  tags?: unknown;
  notes?: string | null;
  budget?: boolean | null;
  city?: string | null;
  name?: string;
  email?: string | null;
  last_activity_at?: Date | string | null;
  created_at: Date | string;
}

export interface ActivityLike {
  type: string;
  lead_id?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  owner_id?: string | null;
  created_at: Date | string;
}

export interface MessageLike {
  body?: string | null;
  channel?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
}

export interface StageLike {
  id: string;
  sort_order: number;
}

export interface DealLike {
  id: string;
  stage_id: string;
  value: number;
  status: string;
  title?: string;
  lead_id?: string | null;
  owner_id?: string | null;
  created_at?: Date | string;
}

export interface KbArticleLike {
  id: string;
  title: string;
  body: string;
  tags?: unknown;
}

export interface TranscriptTurn {
  speaker: "agent" | "user";
  text: string;
}

export interface VoiceCallLike {
  transcript?: TranscriptTurn[] | null;
}

// ---------- Results ----------

export interface LeadScore {
  interest: number;
  intent: number;
  engagement: number;
  risk: number;
  /**
   * Product-intent dimension (0-100), present ONLY when the lead has an
   * engagement profile on some connected product. Absent means "no integration
   * data", which is different from zero, and the blend in ai/intent.ts keeps the
   * original four-dimension formula in that case so nothing changes for a
   * workspace without a product integration.
   */
  product?: number;
  total: number;
  grade: "HOT" | "WARM" | "COLD";
}

export interface SentimentResult {
  label: "Positive" | "Neutral" | "Negative";
  score: number;
}

export interface DealHealthResult {
  score: number;
  label: "Healthy" | "At risk" | "Critical";
  winProbability: number;
}

// ---------- Lead scoring ----------

export function scoreLead(
  lead: LeadLike,
  activities: ActivityLike[] = [],
  messages: MessageLike[] = []
): LeadScore {
  const acts = activities.filter((a) => a.lead_id === lead.id);
  const msgs = messages.filter((m) => m.lead_id === lead.id);
  const src = SOURCE_WEIGHT[lead.source ?? ""] || 8;

  let interest = 30 + src + parseTags(lead.tags).length * 4;
  interest += acts.filter((a) => ["DEMO", "MEETING"].includes(a.type)).length * 12;
  interest += recencyBoost(lead.last_activity_at || lead.created_at);

  let intent = 20 + src;
  const text = [...msgs.map((m) => m.body || ""), lead.notes || ""].join(" ").toLowerCase();
  intent += POSITIVE.filter((w) => text.includes(w)).length * 8;
  intent -= NEGATIVE.filter((w) => text.includes(w)).length * 9;
  if (acts.some((a) => a.type === "DEMO")) intent += 18;
  if (lead.budget) intent += 10;

  let engagement = 15 + clamp(acts.length * 9, 0, 45) + clamp(msgs.length * 6, 0, 30);
  engagement += recencyBoost(lead.last_activity_at);

  let risk = 25;
  risk += NEGATIVE.filter((w) => text.includes(w)).length * 10;
  const lastMs = toMs(lead.last_activity_at || lead.created_at) ?? Date.now();
  const stale = (Date.now() - lastMs) / 86400000;
  if (stale > 14) risk += 25;
  else if (stale > 7) risk += 12;
  if (acts.length === 0) risk += 10;

  interest = clamp(Math.round(interest), 0, 100);
  intent = clamp(Math.round(intent), 0, 100);
  engagement = clamp(Math.round(engagement), 0, 100);
  risk = clamp(Math.round(risk), 0, 100);
  const total = clamp(
    Math.round(interest * 0.3 + intent * 0.4 + engagement * 0.3 - risk * 0.15),
    0,
    100
  );
  const grade = total >= 75 ? "HOT" : total >= 50 ? "WARM" : "COLD";
  return { interest, intent, engagement, risk, total, grade };
}

// ---------- Deals ----------

export function winProbability(
  deal: DealLike,
  stages: StageLike[] = [],
  activities: ActivityLike[] = []
): number {
  const ordered = stages.slice().sort((a, b) => a.sort_order - b.sort_order);
  const idx = ordered.findIndex((s) => s.id === deal.stage_id);
  const stageProgress = ordered.length > 1 && idx >= 0 ? idx / (ordered.length - 1) : 0;
  let p = 10 + stageProgress * 70;
  const acts = activities.filter((a) => a.deal_id === deal.id);
  p += clamp(acts.length * 4, 0, 16);
  if (acts.some((a) => a.type === "DEMO")) p += 6;
  if (deal.value > 500000) p -= 6;
  const lastAct = acts
    .map((a) => toMs(a.created_at) ?? 0)
    .sort((a, b) => a - b)
    .slice(-1)[0];
  if (lastAct && (Date.now() - lastAct) / 86400000 > 14) p -= 12;
  if (deal.status === "WON") p = 100;
  if (deal.status === "LOST") p = 0;
  return clamp(Math.round(p), 0, 100);
}

export function dealHealth(
  deal: DealLike,
  stages: StageLike[] = [],
  activities: ActivityLike[] = []
): DealHealthResult {
  const p = winProbability(deal, stages, activities);
  const acts = activities.filter((a) => a.deal_id === deal.id);
  const lastAct = acts
    .map((a) => toMs(a.created_at) ?? 0)
    .sort((a, b) => a - b)
    .slice(-1)[0];
  const stale = lastAct ? (Date.now() - lastAct) / 86400000 : 99;
  const score = clamp(Math.round(p - (stale > 10 ? 25 : stale > 5 ? 10 : 0)), 0, 100);
  return {
    score,
    label: score >= 66 ? "Healthy" : score >= 40 ? "At risk" : "Critical",
    winProbability: p,
  };
}

export function nextBestAction(
  deal: DealLike,
  stages: StageLike[] = [],
  activities: ActivityLike[] = []
): string {
  const h = dealHealth(deal, stages, activities);
  if (h.winProbability >= 70) return "Send proposal and ask for a verbal commitment.";
  if (h.label === "Critical") return "Call the champion today; the deal has gone quiet.";
  if (h.winProbability >= 40) return "Schedule a technical demo with the decision maker.";
  return "Re-qualify budget and timeline before investing more time.";
}

export function bestTimeToCall(): string {
  return pick(["Tue 11:00", "Wed 16:30", "Thu 10:00", "Tue 18:00"]);
}

// ---------- Text intelligence ----------

export function sentiment(text = ""): SentimentResult {
  const t = String(text).toLowerCase();
  const pos = POSITIVE.filter((w) => t.includes(w)).length;
  const neg = NEGATIVE.filter((w) => t.includes(w)).length;
  const score = clamp(50 + pos * 12 - neg * 14, 0, 100);
  return { label: score >= 60 ? "Positive" : score <= 40 ? "Negative" : "Neutral", score };
}

export function summarize(text = ""): string {
  const sentences = String(text)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 4);
  if (sentences.length <= 2) return text.trim();
  const keywords = POSITIVE.concat(NEGATIVE, ["price", "demo", "next", "follow", "buy", "meeting"]);
  const scored = sentences.map((s) => {
    const t = s.toLowerCase();
    return { s, score: keywords.filter((w) => t.includes(w)).length };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.s.trim())
    .join(" ");
}

// ---------- Email writer ----------

export interface EmailDraft {
  subject: string;
  body: string;
  generatedBy: string;
  type: string;
}

const EMAIL_BLUEPRINTS: Record<string, (n: string, c?: string) => { subject: string; body: string }> = {
  sales: (n, c) => ({
    subject: `${n}, a quick idea for ${c || "your team"}`,
    body: `Hi ${n},\n\nThanks for your interest. Based on what you shared, I believe we can help ${c || "your team"} move faster with a tailored plan.\n\nWould you be open to a 20-minute walkthrough this week? I can show exactly how teams like yours get value in the first month.\n\nWarm regards,\nThe team`,
  }),
  followup: (n) => ({
    subject: `Following up, ${n}`,
    body: `Hi ${n},\n\nJust circling back on my previous note. I know things get busy, so I wanted to keep this on your radar.\n\nIf it helps, I can share a short demo link you can watch whenever convenient. Happy to answer any questions.\n\nBest,\nThe team`,
  }),
  response: (n) => ({
    subject: "Re: your question",
    body: `Hi ${n},\n\nGreat question. Here is a clear answer along with the next step so you can decide with confidence.\n\nLet me know if you would like me to set up a quick call to go deeper.\n\nThanks,\nThe team`,
  }),
  referral: (n, c) => ({
    subject: `${n}, we were just connected`,
    body: `Hi ${n},\n\nYou came highly recommended, so I wanted to reach out directly. I think there is a strong fit between what you are working on at ${c || "your team"} and how we help teams like yours.\n\nWould you be open to a quick 20-minute call this week to explore it?\n\nWarm regards,\nThe team`,
  }),
  meeting: (n) => ({
    subject: `Quick call this week, ${n}?`,
    body: `Hi ${n},\n\nI would love to show you how we can help. Could we find 20 minutes this week?\n\nWould Tuesday or Thursday afternoon work for you? If another time is easier, just let me know and I will make it fit.\n\nBest,\nThe team`,
  }),
  proposal: (n, c) => ({
    subject: "Your proposal",
    body: `Hi ${n},\n\nThank you for the conversation. I have put together a proposal tailored to ${c || "your team"}, covering the plan and pricing we discussed.\n\nI am happy to walk through it together and answer any questions. When would be a good time to connect?\n\nWarm regards,\nThe team`,
  }),
  reengage: (n) => ({
    subject: `Still here when you need us, ${n}`,
    body: `Hi ${n},\n\nIt has been a little while, so I wanted to reconnect. No pressure at all. If now is a better time to revisit how we can help, I am glad to pick things back up.\n\nWould a short call make sense, or should I share a quick demo link instead?\n\nBest,\nThe team`,
  }),
  thankyou: (n) => ({
    subject: `Thanks for your time, ${n}`,
    body: `Hi ${n},\n\nThank you for the conversation today. I really enjoyed learning more about your goals.\n\nAs a next step, I will follow up with what we discussed. In the meantime, feel free to reach out with any questions.\n\nWarm regards,\nThe team`,
  }),
  renewal: (n, c) => ({
    subject: `${n}, your upcoming renewal`,
    body: `Hi ${n},\n\nYour plan with us is coming up for renewal, and I wanted to make sure ${c || "your team"} keeps getting full value.\n\nBased on how you are using the product, there is an option that could help you get even more. Can we find 15 minutes to review it together?\n\nWarm regards,\nThe team`,
  }),
};

export function writeEmail(params: {
  type?: string;
  name?: string;
  company?: string;
  // Workspace-defined custom types carry their own fallback copy (used when no
  // AI provider is configured), with {name}/{company} merge fields.
  fallback?: { subject: string; body: string };
}): EmailDraft {
  const { type = "sales", name = "there", company = "" } = params;
  if (params.fallback && (params.fallback.subject || params.fallback.body)) {
    const fill = (s: string) =>
      s.replace(/\{name\}/gi, name).replace(/\{company\}/gi, company || "your team");
    return {
      subject: fill(params.fallback.subject || `A note for ${name}`),
      body: fill(
        params.fallback.body ||
          `Hi ${name},\n\nI wanted to reach out personally.\n\nWarm regards,\nThe team`
      ),
      generatedBy: "AI Email Writer",
      type,
    };
  }
  const fn = EMAIL_BLUEPRINTS[type] || EMAIL_BLUEPRINTS.sales;
  return { ...fn(name, company), generatedBy: "AI Email Writer", type };
}

// ---------- Outreach composer (agent messages) ----------

export type OutreachPurpose = "sales" | "marketing" | "collections" | "success";

export interface OutreachInput {
  purpose: OutreachPurpose;
  channel: "WHATSAPP" | "EMAIL";
  // Sender brand voice (defaults to the workspace brand).
  brand: string;
  // Already reduced to a first name by the caller.
  recipientName: string;
  // Bounded, caller-supplied specifics the model may reference, and ONLY these.
  facts?: Record<string, string | number | null | undefined>;
  // Strings that must appear verbatim in the body (e.g. a real payment link,
  // invoice number, amount). If the model drops one, the caller falls back.
  mustInclude?: string[];
  // The exact copy the caller would have sent with no LLM. The heuristic returns
  // it unchanged, so behaviour is byte-identical with no key / under test.
  fallbackSubject: string;
  fallbackBody: string;
}

export interface OutreachDraft {
  subject: string;
  body: string;
  generatedBy: string;
}

// Deterministic fallback: echo the caller's template verbatim. The real
// per-recipient copywriting lives in the LLM provider; this keeps the offline
// path (and tests) identical to the previous template behaviour.
export function composeOutreach(input: OutreachInput): OutreachDraft {
  return {
    subject: input.fallbackSubject,
    body: input.fallbackBody,
    generatedBy: "AI (template)",
  };
}

// ---------- Lead & deal insight (LLM-facing shapes + fallbacks) ----------

export interface LeadAssessInput {
  name: string;
  // Heuristic breakdown, used to ground the model (and as the fallback source).
  score: LeadScore;
  source?: string | null;
  city?: string | null;
  tags?: string[];
  notes?: string | null;
  recentMessages?: string[];
  recentActivities?: Array<{ type: string; when: string }>;
  daysSinceActivity?: number | null;
}

// Stamped on every insight produced without the model, either no API key or a
// failed call. Callers use it to tell a real assessment from a degraded one.
export const HEURISTIC_GENERATED_BY = "AI (heuristic)";

export interface LeadInsight {
  summary: string;
  reasons: string[];
  recommendedAction: string;
  temperature: "HOT" | "WARM" | "COLD";
  generatedBy: string;
}

const LEAD_ACTIONS: Record<LeadScore["grade"], string> = {
  HOT: "Reach out today with a concrete next step, book a demo or call while intent is high.",
  WARM: "Nurture with a tailored value message tied to their interest, then propose a short call.",
  COLD: "Re-qualify budget, authority, need and timing before investing more rep time.",
};

// Deterministic fallback lead assessment derived from the stored score
// breakdown. Used offline / under test and whenever the LLM path errors.
export function leadInsight(input: LeadAssessInput): LeadInsight {
  const s = input.score;
  const reasons: string[] = [];
  if (input.source) reasons.push(`Source "${input.source}" (weight ${SOURCE_WEIGHT[input.source] ?? 8}).`);
  if (s.intent >= 60) reasons.push("Messages/notes show buying intent.");
  else if (s.intent <= 30) reasons.push("Little buying intent in messages so far.");
  if (s.engagement >= 55) reasons.push("Actively engaging (activities/messages).");
  else if (s.engagement <= 25) reasons.push("Low engagement, few touchpoints.");
  if (s.risk >= 50) reasons.push("Elevated risk (negative signals or gone quiet).");
  if (input.daysSinceActivity != null && input.daysSinceActivity > 14) {
    reasons.push(`No activity in ${Math.round(input.daysSinceActivity)} days.`);
  }
  if (!reasons.length) reasons.push("Scored on profile completeness and recency.");
  return {
    summary: `${input.name} is a ${s.grade} lead (score ${s.total}/100): interest ${s.interest}, intent ${s.intent}, engagement ${s.engagement}, risk ${s.risk}.`,
    reasons,
    recommendedAction: LEAD_ACTIONS[s.grade],
    temperature: s.grade,
    generatedBy: HEURISTIC_GENERATED_BY,
  };
}

export interface DealAssessInput {
  title: string;
  value: number;
  stageName?: string | null;
  winProbability: number;
  healthLabel: string;
  daysSinceActivity?: number | null;
  competitors?: string[];
  stakeholders?: string[];
  leadGrade?: string | null;
  recentActivities?: Array<{ type: string; when: string }>;
}

export interface DealInsight {
  assessment: string;
  nextBestAction: string;
  risks: string[];
  generatedBy: string;
}

// Deterministic fallback deal assessment. nextBestAction mirrors the original
// nextBestAction() branching, but off the already-computed probability/health.
export function dealInsight(input: DealAssessInput): DealInsight {
  const p = input.winProbability;
  let nextBestAction: string;
  if (p >= 70) nextBestAction = "Send the proposal and ask for a verbal commitment.";
  else if (input.healthLabel === "Critical")
    nextBestAction = "Call the champion today, the deal has gone quiet.";
  else if (p >= 40) nextBestAction = "Schedule a technical demo with the decision maker.";
  else nextBestAction = "Re-qualify budget and timeline before investing more time.";

  const risks: string[] = [];
  if (input.daysSinceActivity != null && input.daysSinceActivity > 10) {
    risks.push(`Stalled, ${Math.round(input.daysSinceActivity)} days since the last activity.`);
  }
  if (input.competitors && input.competitors.length) {
    risks.push(`Competing against ${input.competitors.join(", ")}.`);
  }
  if (input.value > 500000) risks.push("High deal value, expect more stakeholders and scrutiny.");
  if (!risks.length) risks.push("No major risk flags from the available signals.");

  return {
    assessment: `${input.healthLabel} deal at ${p}% win probability${input.stageName ? `, currently in "${input.stageName}"` : ""}.`,
    nextBestAction,
    risks,
    generatedBy: HEURISTIC_GENERATED_BY,
  };
}

// ---------- RAG search over KB articles ----------

export interface RagHit {
  article: { id: string; title: string };
  score: number;
  snippet: string;
}

export function ragSearch(articles: KbArticleLike[], query: string, k = 4): RagHit[] {
  const terms = String(query)
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  const scored = articles.map((a) => {
    const hay = `${a.title} ${a.body} ${parseTags(a.tags).join(" ")}`.toLowerCase();
    const score = sum(terms, (t) =>
      hay.includes(t) ? (a.title.toLowerCase().includes(t) ? 3 : 1) : 0
    );
    let snippet = a.body.slice(0, 220);
    const first = terms
      .map((t) => hay.indexOf(t))
      .filter((i) => i >= 0)
      .sort((x, y) => x - y)[0];
    if (first != null && first > 40) snippet = "..." + a.body.slice(first - 40, first + 180);
    return { article: { id: a.id, title: a.title }, score, snippet: snippet.trim() };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- Simulated voice calls ----------

export interface VoiceCallResult {
  direction: string;
  goal: string;
  durationSec: number;
  transcript: TranscriptTurn[];
  summary: string;
  sentiment: SentimentResult;
  outcome: "MEETING_BOOKED" | "FOLLOW_UP";
  leadScoreDelta: number;
  actionItems: string[];
  completedAt: Date;
}

const VOICE_SCRIPTS: Record<string, Array<[TranscriptTurn["speaker"], string]>> = {
  qualify: [
    ["agent", "Hi {name}, this is Ria calling from the team. Is now a good time for a quick minute?"],
    ["user", "Sure, go ahead."],
    ["agent", "Great. I saw you signed up to learn about our programs. What are you hoping to achieve?"],
    ["user", "I want to move into data and AI roles, but I'm comparing a few options."],
    ["agent", "That makes sense. Many learners come to us for exactly that. Are you looking to start this month?"],
    ["user", "Possibly, if the pricing and outcomes are right."],
    ["agent", "Understood. I can book you a free demo with a mentor who has placed people in similar roles. Shall I schedule it for tomorrow evening?"],
    ["user", "Yes, that works."],
    ["agent", "Done. You'll get a WhatsApp confirmation shortly. Thanks {name}, talk soon!"],
  ],
  reminder: [
    ["agent", "Hi {name}, quick reminder about your pending order. Did you get a chance to review the plan?"],
    ["user", "Not yet, I've been busy."],
    ["agent", "No problem at all. Would it help if I extend your early-bird price by 48 hours?"],
    ["user", "That would be great, thanks."],
    ["agent", "Done. I'll send the payment link on WhatsApp. Anything else I can help with?"],
    ["user", "No, that's all."],
  ],
};

export function simulateVoiceCall(params: {
  direction?: string;
  goal?: string;
  contactName?: string;
}): VoiceCallResult {
  const { direction = "OUTBOUND", goal = "qualify", contactName = "there" } = params;
  const base = VOICE_SCRIPTS[goal] || VOICE_SCRIPTS.qualify;
  const transcript = base.map(([speaker, text]) => ({
    speaker,
    text: text.replace(/{name}/g, contactName),
  }));
  const full = transcript.map((t) => t.text).join(" ");
  const senti = sentiment(full);
  const booked = /schedule|book|tomorrow|works|payment link/i.test(full);
  const actionItems: string[] = [];
  if (booked) actionItems.push("Send WhatsApp confirmation", "Create follow-up task in 1 day");
  if (/pricing|price|plan/i.test(full)) actionItems.push("Share pricing PDF");
  return {
    direction,
    goal,
    durationSec: 60 + transcript.length * 12,
    transcript,
    summary: summarize(full) || `AI ${goal} call with ${contactName}.`,
    sentiment: senti,
    outcome: booked ? "MEETING_BOOKED" : "FOLLOW_UP",
    leadScoreDelta: booked ? 14 : 5,
    actionItems: actionItems.length ? actionItems : ["Log call notes"],
    completedAt: new Date(),
  };
}

// ---------- Copilot: natural-language analytics ----------

export interface CopilotData {
  leads: LeadLike[];
  deals: DealLike[];
  stages: StageLike[];
  contacts: Array<{
    id: string;
    name: string;
    company?: string | null;
    email?: string | null;
    created_at: Date | string;
  }>;
  tickets: Array<{
    subject: string;
    priority: string;
    status: string;
    sla_due_at?: Date | string | null;
    created_at?: Date | string;
  }>;
  users: Array<{ id: string; name: string; role: string }>;
  activities: ActivityLike[];
  messages?: MessageLike[];
}

export interface CopilotResult {
  intent: string;
  answer: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

// One prior turn of a Copilot conversation, used to give the LLM path memory so
// follow-ups ("and which of those are in Delhi?") resolve against context. The
// deterministic heuristic ignores it.
export interface CopilotTurn {
  question: string;
  answer: string;
}

export function copilot(data: CopilotData, query: string): CopilotResult {
  const q = String(query || "").toLowerCase();
  const cityMatch = q.match(/\b(?:in|from)\s+([a-z]+)/);
  const city = cityMatch ? cityMatch[1] : null;
  const score = (l: LeadLike) => scoreLead(l, data.activities, data.messages || []);

  if (/(hot|high.?intent|best|top).*(lead|prospect)|which leads/.test(q)) {
    let leads = data.leads
      .map((l) => ({ lead: l, s: score(l) }))
      .filter((x) => x.s.total >= 65);
    if (city) leads = leads.filter((x) => (x.lead.city || "").toLowerCase() === city);
    if (/demo/.test(q)) {
      leads = leads.filter((x) =>
        data.activities.some((a) => a.lead_id === x.lead.id && a.type === "DEMO")
      );
    }
    if (/(not|haven.?t|no).*(purchas|buy|bought|won)/.test(q)) {
      leads = leads.filter(
        (x) => !data.deals.some((d) => d.lead_id === x.lead.id && d.status === "WON")
      );
    }
    leads.sort((a, b) => b.s.total - a.s.total);
    return {
      intent: "hot_leads",
      answer: `Found ${leads.length} hot lead${leads.length === 1 ? "" : "s"}${city ? ` in ${city}` : ""}${/demo/.test(q) ? " who attended a demo" : ""}.`,
      columns: ["Name", "City", "Source", "Score", "Grade"],
      rows: leads
        .slice(0, 25)
        .map((x) => [x.lead.name ?? "-", x.lead.city || "-", x.lead.source || "-", x.s.total, x.s.grade]),
    };
  }

  if (/(deal|opportunit).*(close|win|likely)|forecast|pipeline value|revenue/.test(q)) {
    const open = data.deals.filter((d) => d.status === "OPEN");
    const withP = open.map((d) => ({ deal: d, p: winProbability(d, data.stages, data.activities) }));
    const weighted = sum(withP, (x) => x.deal.value * (x.p / 100));
    const likely = withP.filter((x) => x.p >= 55).sort((a, b) => b.p - a.p);
    return {
      intent: "forecast",
      answer: `Weighted pipeline is ₹${Math.round(weighted).toLocaleString("en-IN")} across ${open.length} open deals. ${likely.length} are likely to close (win probability 55%+).`,
      columns: ["Deal", "Value", "Win %"],
      rows: likely
        .slice(0, 25)
        .map((x) => [x.deal.title ?? "-", "₹" + x.deal.value.toLocaleString("en-IN"), x.p + "%"]),
    };
  }

  if (/(agent|rep|salesperson|team).*(underperform|worst|low|behind)|who.*underperform/.test(q)) {
    const agents = data.users.filter((u) => ["SALES_AGENT", "MANAGER"].includes(u.role));
    const stat = agents
      .map((u) => {
        const won = data.deals.filter((d) => d.owner_id === u.id && d.status === "WON").length;
        const acts = data.activities.filter((a) => a.owner_id === u.id).length;
        return { u, won, acts, r: won * 10 + acts };
      })
      .sort((a, b) => a.r - b.r);
    return {
      intent: "agent_performance",
      answer: `Ranked ${stat.length} agents by output. ${stat[0] ? stat[0].u.name + " is most behind" : "No agents found"}.`,
      columns: ["Agent", "Deals won", "Activities"],
      rows: stat.slice(0, 25).map((s) => [s.u.name, s.won, s.acts]),
    };
  }

  if (/(inactive|dormant|quiet|churn).*(customer|contact|account|lead)|inactive customers/.test(q)) {
    const stale = data.contacts.filter((c) => {
      const last =
        data.activities
          .filter((a) => a.contact_id === c.id)
          .map((a) => toMs(a.created_at) ?? 0)
          .sort((a, b) => a - b)
          .slice(-1)[0] || toMs(c.created_at) || 0;
      return (Date.now() - last) / 86400000 > 30;
    });
    return {
      intent: "inactive_customers",
      answer: `${stale.length} contacts have had no activity in over 30 days.`,
      columns: ["Name", "Company", "Email"],
      rows: stale.slice(0, 25).map((c) => [c.name, c.company || "-", c.email || "-"]),
    };
  }

  if (/(ticket|support|sla|complaint).*(overdue|open|breach|pending)|open tickets/.test(q)) {
    const open = data.tickets.filter((t) => t.status !== "CLOSED");
    const breach = open.filter((t) => {
      const due = toMs(t.sla_due_at);
      return due !== null && due < Date.now();
    });
    return {
      intent: "tickets",
      answer: `${open.length} open tickets, ${breach.length} past their SLA.`,
      columns: ["Subject", "Priority", "Status", "SLA"],
      rows: open.slice(0, 25).map((t) => {
        const due = toMs(t.sla_due_at);
        return [t.subject, t.priority, t.status, due !== null && due < Date.now() ? "Breached" : "On track"];
      }),
    };
  }

  const terms = q.split(/\W+/).filter((w) => w.length > 2);
  const hits = data.leads.filter((l) =>
    terms.some((t) => `${l.name} ${l.city} ${l.source} ${l.notes}`.toLowerCase().includes(t))
  );
  return {
    intent: "search",
    answer: hits.length
      ? hits.length === 1
        ? "Here is 1 record matching your question."
        : `Here are ${hits.length} records matching your question.`
      : "I couldn't find a direct match. Try asking about hot leads, deal forecasts, agent performance, inactive customers or open tickets.",
    columns: ["Name", "City", "Source"],
    rows: hits.slice(0, 25).map((l) => [l.name ?? "-", l.city || "-", l.source || "-"]),
  };
}

// ---------- AI Coach ----------

export interface CoachResult {
  strategy: string;
  talkingPoints: string[];
  objectionHandling: Array<{ objection: string; response: string }>;
  script: string;
  coach: string;
}

const OBJECTIONS = {
  price: {
    objection: "It's too expensive.",
    response:
      "I hear you. Let's look at the outcome per rupee. Most teams recover the cost within the first month through the time they save. Would an EMI option help?",
  },
  timing: {
    objection: "Now isn't a good time.",
    response:
      "Totally understand. Many of our best customers started with a small pilot. Could we line up a 20-minute slot next week so you're ready when timing is right?",
  },
  competitor: {
    objection: "We're evaluating other options.",
    response:
      "Smart to compare. The two things customers tell us set us apart are speed to value and the agentic automation. Want a side-by-side on those?",
  },
  authority: {
    objection: "I need to check with my team.",
    response:
      "Of course. What would help your team say yes? I can prepare a one-pager and join a quick call to answer their questions directly.",
  },
};

export function coach(params: { grade?: string; value?: number } = {}): CoachResult {
  const { grade = "WARM", value = 0 } = params;
  const openers: Record<string, string> = {
    HOT: "This lead is hot. Lead with urgency and a clear next step (book the demo today).",
    WARM: "Build value first. Tie the product to the specific outcome they mentioned, then propose a demo.",
    COLD: "Re-qualify. Confirm budget, authority, need and timeline before investing more time.",
  };
  return {
    strategy: openers[grade] || openers.WARM,
    talkingPoints: [
      "Open with the outcome they care about, not features.",
      value > 200000
        ? "Bring in a senior stakeholder early for a high-value deal."
        : "Keep momentum, aim to close in this cycle.",
      "End every interaction with a scheduled next step.",
    ],
    objectionHandling: Object.values(OBJECTIONS),
    script:
      "Hi {name}, thanks for your time. Based on what you shared, here's how we can help... Can we book 20 minutes this week to show you exactly how?",
    coach: "AI Coach",
  };
}

// ---------- Conversation intelligence ----------

export interface ConversationIntelResult {
  messages: number;
  calls: number;
  overallSentiment: string;
  positiveSignals: number;
  riskSignals: number;
  topics: string[];
  talkRatio: number | null;
  byChannel: Record<string, number>;
  recommendation: string;
}

export function conversationIntelligence(
  messages: MessageLike[] = [],
  calls: VoiceCallLike[] = []
): ConversationIntelResult {
  const texts = [
    ...messages.map((m) => m.body || ""),
    ...calls.flatMap((c) => (c.transcript || []).map((t) => t.text)),
  ];
  const blob = texts.join(" ").toLowerCase();
  const pos = POSITIVE.filter((w) => blob.includes(w)).length;
  const neg = NEGATIVE.filter((w) => blob.includes(w)).length;
  const topics = (
    [
      ["Pricing", /price|cost|fee|emi|plan|expensive/],
      ["Demo", /demo|walkthrough|show|schedule/],
      ["Support", /issue|problem|refund|help|error/],
      ["Competition", /compare|competitor|other option|alternative/],
      ["Timeline", /this week|soon|next month|later|busy/],
    ] as Array<[string, RegExp]>
  )
    .filter(([, re]) => re.test(blob))
    .map(([t]) => t);
  const byChannel: Record<string, number> = {};
  messages.forEach((m) => {
    const ch = m.channel || "unknown";
    byChannel[ch] = (byChannel[ch] || 0) + 1;
  });
  const totalTurns = calls.reduce((a, c) => a + (c.transcript || []).length, 0);
  const agentTurns = calls.reduce(
    (a, c) => a + (c.transcript || []).filter((t) => t.speaker === "agent").length,
    0
  );
  return {
    messages: messages.length,
    calls: calls.length,
    overallSentiment: sentiment(blob).label,
    positiveSignals: pos,
    riskSignals: neg,
    topics: topics.length ? topics : ["General"],
    talkRatio: calls.length ? Math.round((agentTurns / Math.max(1, totalTurns)) * 100) : null,
    byChannel,
    recommendation:
      neg > pos
        ? "Sentiment is trending negative. Have a senior rep step in."
        : "Engagement is healthy. Push for a clear next step.",
  };
}
