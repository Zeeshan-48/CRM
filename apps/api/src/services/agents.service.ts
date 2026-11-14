import config from "../config";
import { email_category } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import agentsRepository, {
  AgentEnrollmentRow,
  AgentLeadRow,
  AgentOutreachRow,
  AgentRunRow,
  AgentSettingsRow,
  SalesLeadContext,
} from "../repositories/agents.repository";
import logger from "../utils/logger";
import { ragSearch } from "./ai/heuristics";
import { aiProvider } from "./ai/provider";
import engineService from "./engine.service";
import financeService from "./finance.service";
import mailerService from "./mailer.service";
import schedulingService from "./scheduling.service";
import whatsappDeliveryService from "./whatsapp-delivery.service";

export const AGENT_DEFINITIONS = [
  {
    key: "sales",
    name: "Sales Agent",
    description: "Drafts personalised outreach to hot leads for you to review and send.",
  },
  {
    key: "marketing",
    name: "Campaign Agent",
    description: "Segments audiences and launches multichannel campaigns.",
  },
  {
    key: "support",
    name: "Support Agent",
    description: "Resolves tickets and answers FAQs from the knowledge base.",
  },
  {
    key: "collections",
    name: "Collections Agent",
    description: "Chases overdue invoices with polite reminders.",
  },
  {
    key: "knowledge",
    name: "Knowledge Agent",
    description: "RAG-powered company brain over your knowledge base.",
  },
  {
    key: "coach",
    name: "AI Coach",
    description: "Suggests sales scripts and objection handling for live deals.",
  },
] as const;

export type AgentKey = (typeof AGENT_DEFINITIONS)[number]["key"];

// Agents surfaced in the UI. `support` + `knowledge` are hidden until their
// retrieval is upgraded from lexical keyword-matching to semantic search
// (embeddings); both remain runnable through the API.
export const HIDDEN_AGENT_KEYS = new Set<string>(["support", "knowledge"]);

// Default sender brand for agent outreach (white-label default).
const BRAND = config.BRAND_NAME || "Bn Orbit";

// Sales cooldown: a lead contacted (or with a pending draft) within this many
// days is not re-drafted, so repeated runs never spam the same people.
const SALES_COOLDOWN_DAYS = 7;

// ---- Phase 2 automation config (sensible defaults; overridable per tenant) ----

// A lead must have been active within this window to count as a live "signal".
const SIGNAL_RECENCY_DAYS = 14;

interface CadenceStep {
  delayDays: number;
  angle: string;
  // MESSAGE (default) drafts outreach; CALL books a call task for the owner.
  type?: "MESSAGE" | "CALL";
}

// Appended to the cadence when the tenant enables `escalate_to_call`.
const CALL_STEP: CadenceStep = { delayDays: 1, angle: "call", type: "CALL" };

// The default multi-touch sequence: intro now, follow-up in 2 days, final
// check-in 4 days after that, then escalate to a human task.
const DEFAULT_CADENCE: CadenceStep[] = [
  { delayDays: 0, angle: "intro" },
  { delayDays: 2, angle: "follow-up" },
  { delayDays: 4, angle: "final" },
];

// Per-touch fallback copy + the composer instruction that gives each touch a
// distinct angle (so touch 2 never reads like a copy of touch 1). The LLM path
// uses `instruction`; the offline/template path uses subject/body.
const TOUCH_COPY: Record<
  string,
  { subject: string; body: (name: string) => string; instruction: string }
> = {
  intro: {
    subject: "Quick demo this week?",
    body: (name) =>
      `Hi ${name}, this is ${BRAND}. Based on your interest, can I book you a quick demo this week?`,
    instruction: "This is the first outreach, introduce yourself and offer a quick demo.",
  },
  "follow-up": {
    subject: "Following up",
    body: (name) =>
      `Hi ${name}, just following up on my note, happy to answer any questions or set up a quick call. Would this week work?`,
    instruction:
      "Second follow-up; they haven't replied yet. Add a little value and gently re-ask for a call, do not repeat the first message verbatim.",
  },
  final: {
    subject: "Last check-in",
    body: (name) =>
      `Hi ${name}, I don't want to keep nudging, should I close this out for now, or is there a good time to connect?`,
    instruction:
      "Final check-in before pausing. Be brief and low-pressure; give them an easy way to say yes or no.",
  },
};

const normalizeCadence = (raw: unknown): CadenceStep[] => {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_CADENCE;
  const steps = raw
    .map((s) => {
      const step = s as { delayDays?: unknown; angle?: unknown; type?: unknown };
      const delayDays = Number(step.delayDays);
      return {
        delayDays: Number.isFinite(delayDays) && delayDays >= 0 ? delayDays : 0,
        angle: typeof step.angle === "string" && step.angle ? step.angle : "follow-up",
        type: step.type === "CALL" ? ("CALL" as const) : ("MESSAGE" as const),
      };
    })
    .slice(0, 8);
  return steps.length ? steps : DEFAULT_CADENCE;
};

const parseJsonField = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

// A settings row merged with defaults, ready for the engine to consume.
export interface ResolvedSalesSettings {
  enabled: boolean;
  scoreThreshold: number;
  channels: string[];
  tone: string | null;
  cadence: CadenceStep[];
  dailyCap: number;
  autoSend: boolean;
  escalateToCall: boolean;
}

export interface AgentRunParams {
  limit?: number;
  audienceTag?: string;
  query?: string;
}

interface AgentOutcome {
  summary: string;
  actions: string[];
  extras?: Record<string, unknown>;
}

// ---- Real outreach delivery (shared by sales/marketing/collections/success) ----
// The agents deliver through the SAME proven seams as campaigns/journeys:
// WhatsApp via the tenant's BYO Meta account and Email via the tenant's BYO SES
// sending domain (falling back to the platform's shared sender). Each send is
// then recorded in the inbox with the TRUE `simulated` flag, so a non-delivery is
// never logged as a real send.
type Channel = "WHATSAPP" | "EMAIL";
type DeliveryOutcome = "delivered" | "simulated" | "skipped";

interface DeliverInput {
  leadId?: string | null;
  contactId?: string | null;
  email?: string | null;
  phone?: string | null;
  // Preferred channel; the other is tried as a fallback when the first can't
  // deliver (no address, channel not connected, outside the WhatsApp window…).
  prefer: Channel;
  subject: string; // used for EMAIL
  text: string; // message body (also the plain-text email)
  emailCategory?: email_category;
  waTemplateName?: string;
  waBodyParams?: string[];
}

interface DeliveryResult {
  outcome: DeliveryOutcome;
  channel: Channel | null;
  // The recorded inbox messages.id (null when skipped). Used to link an
  // approved outreach draft to the message it produced.
  messageId?: string | null;
}

// Running tally of delivery outcomes across a batch, used to build honest run
// summaries ("3 delivered, 1 queued, 2 skipped").
class DeliveryTally {
  delivered = 0;
  simulated = 0;
  skipped = 0;
  record(res: DeliveryResult): DeliveryResult {
    if (res.outcome === "delivered") this.delivered++;
    else if (res.outcome === "simulated") this.simulated++;
    else this.skipped++;
    return res;
  }
  get counts() {
    return { delivered: this.delivered, simulated: this.simulated, skipped: this.skipped };
  }
  suffix(): string {
    return `${this.delivered} delivered, ${this.simulated} queued, ${this.skipped} skipped`;
  }
}

const firstName = (name?: string | null): string => (name || "there").split(" ")[0];

// Which channel a recipient will most likely be reached on, so outreach copy is
// composed for that channel's format (short WhatsApp vs. fuller email). Mirrors
// the fallback order in deliverToRecipient.
const intendedChannel = (
  prefer: Channel,
  email?: string | null,
  phone?: string | null
): Channel => {
  const canWa = !!phone?.trim();
  const canEmail = !!email?.trim();
  if (prefer === "EMAIL") return canEmail ? "EMAIL" : "WHATSAPP";
  return canWa ? "WHATSAPP" : "EMAIL";
};

// A human-readable action-log line reflecting what really happened.
const actionLine = (name: string | null, res: DeliveryResult, note?: string): string => {
  const who = name || "recipient";
  const tail = note ? ` (${note})` : "";
  if (res.outcome === "skipped") return `${who}: skipped, no email or phone on file${tail}`;
  const via = res.channel === "EMAIL" ? "email" : "WhatsApp";
  return res.outcome === "delivered"
    ? `Messaged ${who} via ${via}${tail}`
    : `${who}: queued via ${via} but not delivered, channel not connected${tail}`;
};

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

// Compact relative time for reasons/facts ("2d ago"). Backend-local; the inbox
// has its own formatter on the frontend.
const ago = (date: Date): string => {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// Flatten the lead's real CRM context into the bounded, scalar `facts` the
// outreach composer is allowed to reference, replaces the old hard-coded
// "showed strong interest" string with genuine, per-lead specifics.
const buildSalesFacts = (
  lead: AgentLeadRow,
  ctx: SalesLeadContext
): Record<string, string | number | null | undefined> => {
  const facts: Record<string, string | number | null | undefined> = {
    leadScore: lead.score_total,
    scoreGrade: lead.score_grade,
    source: lead.source ?? undefined,
    city: lead.city ?? undefined,
    campaign: lead.campaign ?? undefined,
  };
  if (lead.notes) facts.notes = truncate(lead.notes, 240);
  if (ctx.contact?.company) facts.company = ctx.contact.company;
  if (ctx.contact?.title) facts.title = ctx.contact.title;
  if (ctx.deal) {
    const value = ctx.deal.value ? `, ₹${ctx.deal.value.toLocaleString("en-IN")}` : "";
    const stage = ctx.deal.stage ? ` (stage: ${ctx.deal.stage})` : "";
    facts.deal = `${ctx.deal.title}${stage}${value}`;
  }
  const lastActivity = ctx.activities[0];
  if (lastActivity) {
    const subj = lastActivity.subject ? `: ${lastActivity.subject}` : "";
    facts.recentActivity = `${lastActivity.type}${subj} (${ago(lastActivity.created_at)})`;
  }
  const lastMessage = ctx.messages[0];
  if (lastMessage) {
    const who = lastMessage.direction === "INBOUND" ? "They wrote" : "We wrote";
    const senti = lastMessage.sentiment ? ` [${lastMessage.sentiment}]` : "";
    facts.lastMessage = `${who}: "${truncate(lastMessage.body, 120)}"${senti}`;
  }
  return facts;
};

// A short human-readable "why this lead / why now" stored on the draft and shown
// to the reviewer (explainability), never a substitute for the message body.
const buildSalesReason = (lead: AgentLeadRow, ctx: SalesLeadContext): string => {
  const bits: string[] = [`${lead.score_grade} lead · score ${lead.score_total}`];
  const lastMessage = ctx.messages[0];
  const lastActivity = ctx.activities[0];
  if (lastMessage && lastMessage.direction === "INBOUND") bits.push(`replied ${ago(lastMessage.at)}`);
  else if (lastActivity) bits.push(`last activity ${ago(lastActivity.created_at)}`);
  else if (lead.source) bits.push(`from ${lead.source}`);
  if (ctx.deal) bits.push(`open deal${ctx.deal.stage ? ` in ${ctx.deal.stage}` : ""}`);
  return bits.join(" · ");
};

const parseActionLog = (value: unknown): string[] => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string") : [];
};

const withParsedActions = (run: AgentRunRow) => ({ ...run, actions: parseActionLog(run.actions) });

class AgentsService {
  async list(tenantId: string) {
    const stats = await agentsRepository.runStats(tenantId);
    return AGENT_DEFINITIONS.filter((def) => !HIDDEN_AGENT_KEYS.has(def.key)).map((def) => ({
      ...def,
      runCount: stats.get(def.key)?.runCount ?? 0,
      lastRunAt: stats.get(def.key)?.lastRunAt ?? null,
    }));
  }

  async runs(tenantId: string) {
    const rows = await agentsRepository.listRuns(tenantId, 100);
    return rows.map(withParsedActions);
  }

  async run(tenantId: string, actorId: string, agentKey: string, params: AgentRunParams) {
    const def = AGENT_DEFINITIONS.find((d) => d.key === agentKey);
    if (!def) throw new BadRequestError("Unknown agent");

    const limit = Math.min(100, Math.max(1, params.limit ?? 5));
    const outcome = await this.execute(tenantId, actorId, def.key, limit, params);

    const run = await agentsRepository.createRun({
      tenant_id: tenantId,
      agent: def.key,
      triggered_by: actorId,
      summary: outcome.summary,
      actions: outcome.actions,
    });
    engineService.audit(tenantId, actorId, `agent.${def.key}.run`, "agent_run", run.id, {
      actions: outcome.actions.length,
    });

    return {
      agent: def.key,
      name: def.name,
      summary: outcome.summary,
      actions: outcome.actions,
      run: withParsedActions(run),
      ...(outcome.extras ?? {}),
    };
  }

  private async execute(
    tenantId: string,
    actorId: string,
    agentKey: AgentKey,
    limit: number,
    params: AgentRunParams
  ): Promise<AgentOutcome> {
    switch (agentKey) {
      case "sales":
        return this.runSales(tenantId, actorId, limit);
      case "support":
        return this.runSupport(tenantId, limit);
      case "collections":
        return this.runCollections(tenantId, actorId, limit);
      case "marketing":
        return this.runMarketing(tenantId, actorId, limit, params.audienceTag);
      case "knowledge":
        return this.runKnowledge(tenantId, params.query);
      case "coach":
        return this.runCoach(tenantId);
    }
  }

  // Delivers one message to a lead/contact over the preferred channel, falling
  // back to the other when the first can't deliver, then records it in the inbox
  // with the true delivery status. Never throws, a bad recipient is reported as
  // "skipped"/"simulated" so one failure never aborts the batch.
  private async deliverToRecipient(
    tenantId: string,
    actorId: string | null,
    input: DeliverInput
  ): Promise<DeliveryResult> {
    const canWa = !!input.phone?.trim();
    const canEmail = !!input.email?.trim();
    if (!canWa && !canEmail) return { outcome: "skipped", channel: null };

    const order: Channel[] =
      input.prefer === "EMAIL" ? ["EMAIL", "WHATSAPP"] : ["WHATSAPP", "EMAIL"];

    type Attempt = { channel: Channel; delivered: boolean; messageId: string | null };
    let chosen: Attempt | null = null;
    let lastAttempt: Attempt | null = null;

    // Try the preferred channel; only fall through to the other on a HARD failure
    // (no channel connected, suppressed, provider error), a "simulated" send in
    // dev/test is an accepted outcome on the preferred channel, not a failure.
    for (const ch of order) {
      if (ch === "WHATSAPP" && !canWa) continue;
      if (ch === "EMAIL" && !canEmail) continue;
      try {
        if (ch === "WHATSAPP") {
          const d = await whatsappDeliveryService.deliver(tenantId, {
            leadId: input.leadId ?? null,
            contactId: input.contactId ?? null,
            phone: input.phone ?? null,
            text: input.text,
            templateName: input.waTemplateName,
            bodyParams: input.waBodyParams,
          });
          lastAttempt = { channel: "WHATSAPP", delivered: d.delivered, messageId: d.messageId };
          if (d.delivered || !d.error) {
            chosen = lastAttempt;
            break;
          }
          // Hard failure (d.error set), fall through to the other channel.
        } else {
          const mail = await mailerService.send({
            tenantId,
            category: input.emailCategory ?? "MARKETING",
            to: input.email as string,
            subject: input.subject,
            text: input.text,
          });
          const delivered = mail.provider === "SES" && !mail.suppressed && !mail.rateLimited;
          lastAttempt = { channel: "EMAIL", delivered, messageId: mail.messageId };
          if (delivered || (!mail.suppressed && !mail.rateLimited)) {
            chosen = lastAttempt;
            break;
          }
          // Hard failure (suppressed / rate-limited), fall through.
        }
      } catch (err) {
        logger.warn(`agent delivery (${ch}) failed for tenant ${tenantId}: ${String(err)}`);
        lastAttempt = { channel: ch, delivered: false, messageId: null };
      }
    }

    // If every available channel hard-failed, record the last attempt as not
    // delivered so the run is still honest.
    chosen = chosen ?? lastAttempt;
    if (!chosen) return { outcome: "skipped", channel: null };

    // Record the outbound on the channel we committed to (delivered, or the last
    // attempted) with the honest simulated flag.
    const recorded = await engineService.sendMessage({
      tenantId,
      channel: chosen.channel,
      ref: {
        leadId: input.leadId ?? undefined,
        contactId: input.contactId ?? undefined,
        subject: chosen.channel === "EMAIL" ? input.subject : "WhatsApp",
      },
      direction: "OUTBOUND",
      body: input.text,
      senderUserId: actorId,
      simulated: !chosen.delivered,
      externalId: chosen.messageId,
      status: chosen.delivered ? "sent" : null,
    });

    return {
      outcome: chosen.delivered ? "delivered" : "simulated",
      channel: chosen.channel,
      messageId: recorded.id,
    };
  }

  // The sales agent now DRAFTS personalised outreach (human-in-the-loop): it
  // reads each hot lead's real CRM context, writes a per-lead message, and queues
  // it as a DRAFT for a human to review/edit/approve. Nothing is sent here and no
  // follow-up task is created until the draft is approved (see approveOutreach).
  // Leads contacted, or already holding a pending draft, inside the cooldown
  // window are skipped, so repeated runs never spam the same people.
  private async runSales(tenantId: string, actorId: string, limit: number): Promise<AgentOutcome> {
    // Over-fetch so the cooldown filter doesn't silently shrink the batch, then
    // draft for the first `limit` eligible leads.
    const pool = await agentsRepository.hotLeads(tenantId, Math.min(100, Math.max(limit * 4, limit)));
    const suppressed = await agentsRepository.recentlyContactedLeadIds(tenantId, SALES_COOLDOWN_DAYS);
    const eligible = pool.filter((lead) => !suppressed.has(lead.id));
    const skipped = pool.length - eligible.length;
    const targets = eligible.slice(0, limit);

    const actions: string[] = [];
    for (const lead of targets) {
      const name = firstName(lead.name);
      const channel = intendedChannel("WHATSAPP", lead.email, lead.phone);
      const ctx = await agentsRepository.salesLeadContext(
        tenantId,
        lead.id,
        lead.converted_contact_id
      );
      const reason = buildSalesReason(lead, ctx);
      const draft = await aiProvider.composeOutreach({
        purpose: "sales",
        channel,
        brand: BRAND,
        recipientName: name,
        facts: buildSalesFacts(lead, ctx),
        fallbackSubject: "Quick demo this week?",
        fallbackBody: `Hi ${name}, this is ${BRAND}. Based on your interest, can I book you a quick demo this week?`,
      });
      await agentsRepository.createOutreach({
        tenant_id: tenantId,
        agent: "sales",
        run_id: null,
        lead_id: lead.id,
        contact_id: null,
        channel,
        subject: draft.subject,
        body: draft.body,
        reason,
        created_by: actorId,
      });
      actions.push(
        `Drafted ${channel === "EMAIL" ? "email" : "WhatsApp"} for ${lead.name}, ${reason}`
      );
    }

    const drafted = targets.length;
    const summary = drafted
      ? `Drafted ${drafted} message${drafted === 1 ? "" : "s"} for review${
          skipped ? `, skipped ${skipped} recently contacted` : ""
        }`
      : pool.length
        ? `No new drafts, all ${pool.length} hot leads were recently contacted`
        : "No hot leads to engage right now";
    return { summary, actions, extras: { drafted, skipped } };
  }

  // ---- Outreach approval queue (sales human-in-the-loop) ----

  // Each draft carries its recipient's details (name, where it will land) so the
  // reviewer can see who they are about to message.
  async listOutreach(tenantId: string, status?: string) {
    const rows = await agentsRepository.listOutreach(tenantId, "sales", status);
    return rows.map((row) => {
      const {
        lead_name,
        lead_email,
        lead_phone,
        lead_city,
        lead_score,
        contact_name,
        contact_email,
        contact_phone,
        contact_company,
        ...outreach
      } = row;
      const email = lead_email ?? contact_email ?? null;
      const phone = lead_phone ?? contact_phone ?? null;
      return {
        ...outreach,
        recipientName: lead_name ?? contact_name ?? null,
        recipientEmail: email,
        recipientPhone: phone,
        // Where this specific draft will actually be delivered.
        recipientAddress: outreach.channel === "EMAIL" ? email : phone,
        recipientCity: lead_city ?? null,
        recipientCompany: contact_company ?? null,
        leadScore: lead_score ?? null,
      };
    });
  }

  // Deliver a draft over the real BYO channels, marking it SENT (with the
  // message id) or FAILED. Shared by the manual approve flow and the automation's
  // auto-send. Does NOT create a follow-up task, the caller owns that policy.
  private async deliverDraft(
    tenantId: string,
    actorId: string | null,
    draft: AgentOutreachRow,
    subject: string,
    body: string
  ): Promise<{
    sent: boolean;
    outcome: DeliveryOutcome;
    channel: Channel | null;
    outreach?: AgentOutreachRow;
    lead?: AgentLeadRow;
  }> {
    // Resolve the recipient's current email/phone at send time (freshest info).
    const lead = draft.lead_id
      ? await agentsRepository.leadById(draft.lead_id, tenantId)
      : undefined;
    if (draft.lead_id && !lead) throw new NotFoundError("Lead not found");

    const res = await this.deliverToRecipient(tenantId, actorId, {
      leadId: draft.lead_id,
      contactId: draft.contact_id,
      email: lead?.email ?? null,
      phone: lead?.phone ?? null,
      prefer: draft.channel as Channel,
      subject,
      text: body,
    });

    if (res.outcome === "skipped") {
      await agentsRepository.updateOutreach(tenantId, draft.id, {
        status: "FAILED",
        reviewed_by: actorId,
      });
      return { sent: false, outcome: res.outcome, channel: res.channel, lead };
    }

    const now = new Date();
    const outreach = await agentsRepository.updateOutreach(tenantId, draft.id, {
      status: "SENT",
      subject,
      body,
      message_id: res.messageId ?? null,
      reviewed_by: actorId,
      approved_at: now,
      sent_at: now,
    });
    return { sent: true, outcome: res.outcome, channel: res.channel, outreach, lead };
  }

  // Send one DRAFT: deliver it, open the +24h follow-up task, audit. Returns the
  // delivery result (sent=false when the recipient has no reachable channel).
  // Shared by single-approve and approve-all so both behave identically.
  private async sendApprovedDraft(
    tenantId: string,
    actorId: string,
    draft: AgentOutreachRow,
    edits?: { subject?: string; body?: string }
  ) {
    const subject = (edits?.subject ?? draft.subject ?? "").trim() || "Quick demo this week?";
    const body = (edits?.body ?? draft.body).trim();
    if (!body) throw new BadRequestError("Message body cannot be empty");

    const result = await this.deliverDraft(tenantId, actorId, draft, subject, body);
    if (!result.sent) return result;

    if (result.lead) {
      await agentsRepository.createFollowUpTask({
        tenant_id: tenantId,
        title: `Follow up with ${result.lead.name}`,
        owner_id: result.lead.owner_id ?? actorId,
        lead_id: result.lead.id,
        due_at: new Date(Date.now() + 86400000),
      });
    }
    engineService.audit(tenantId, actorId, "agent.sales.approve", "agent_outreach", draft.id, {
      outcome: result.outcome,
      channel: result.channel,
    });
    return result;
  }

  // Approve a draft: deliver it, mark it SENT, and open the +24h follow-up task.
  // Optional edits let the reviewer tweak the copy before it goes out.
  async approveOutreach(
    tenantId: string,
    actorId: string,
    id: string,
    edits?: { subject?: string; body?: string }
  ) {
    const draft = await agentsRepository.getOutreach(tenantId, id);
    if (!draft) throw new NotFoundError("Draft not found");
    if (draft.status !== "DRAFT")
      throw new BadRequestError(`Draft already ${draft.status.toLowerCase()}`);

    const result = await this.sendApprovedDraft(tenantId, actorId, draft, edits);
    if (!result.sent) {
      throw new BadRequestError("Could not send, no email or phone on file for this lead");
    }
    return { outreach: result.outreach, outcome: result.outcome, channel: result.channel };
  }

  // Approve every pending DRAFT at once. Each send is independent: one failure
  // (e.g. a lead with no reachable channel) is recorded and skipped, never
  // aborting the rest. Returns a tally the UI can surface.
  async approveAllOutreach(tenantId: string, actorId: string) {
    const drafts = await agentsRepository.listOutreach(tenantId, "sales", "DRAFT");
    let sent = 0;
    let failed = 0;
    for (const row of drafts) {
      // listOutreach returns joined rows; approve works off the base columns.
      const draft = await agentsRepository.getOutreach(tenantId, row.id);
      if (!draft || draft.status !== "DRAFT") continue;
      try {
        const result = await this.sendApprovedDraft(tenantId, actorId, draft);
        if (result.sent) sent++;
        else failed++;
      } catch (err) {
        failed++;
        logger.warn(`approve-all: draft ${row.id} failed: ${String(err)}`);
      }
    }
    return { total: drafts.length, sent, failed };
  }

  async rejectOutreach(tenantId: string, actorId: string, id: string) {
    const draft = await agentsRepository.getOutreach(tenantId, id);
    if (!draft) throw new NotFoundError("Draft not found");
    if (draft.status !== "DRAFT")
      throw new BadRequestError(`Draft already ${draft.status.toLowerCase()}`);
    const updated = await agentsRepository.updateOutreach(tenantId, id, {
      status: "REJECTED",
      reviewed_by: actorId,
    });
    engineService.audit(tenantId, actorId, "agent.sales.reject", "agent_outreach", id);
    return updated;
  }

  // Save edits to a draft without sending (kept separate from approve so a
  // reviewer can revise now and send later).
  async editOutreach(
    tenantId: string,
    id: string,
    edits: { subject?: string; body?: string }
  ) {
    const draft = await agentsRepository.getOutreach(tenantId, id);
    if (!draft) throw new NotFoundError("Draft not found");
    if (draft.status !== "DRAFT") throw new BadRequestError("Only drafts can be edited");
    const patch: { subject?: string; body?: string } = {};
    if (edits.subject !== undefined) patch.subject = edits.subject.trim();
    if (edits.body !== undefined) {
      const b = edits.body.trim();
      if (!b) throw new BadRequestError("Message body cannot be empty");
      patch.body = b;
    }
    return agentsRepository.updateOutreach(tenantId, id, patch);
  }

  // ---- Sales automation (Phase 2: signals, sequences, scheduler, replies) ----

  private resolveSettings(row?: AgentSettingsRow): ResolvedSalesSettings {
    const escalateToCall = row?.escalate_to_call ?? false;
    const cadence = normalizeCadence(parseJsonField<unknown[]>(row?.cadence, DEFAULT_CADENCE));
    return {
      enabled: row?.enabled ?? false,
      scoreThreshold: row?.score_threshold ?? 65,
      channels: parseJsonField<string[]>(row?.channels, ["WHATSAPP", "EMAIL"]),
      tone: row?.tone ?? null,
      // A trailing call step is opt-in; the stored cadence stays message-only.
      cadence: escalateToCall ? [...cadence, CALL_STEP] : cadence,
      dailyCap: row?.daily_cap ?? 20,
      autoSend: row?.auto_send ?? false,
      escalateToCall,
    };
  }

  // Working hours are NOT an agent-level setting, they are the workspace-wide
  // hours from Settings, returned here read-only so the UI can show what the
  // automation will respect. (agent_settings.working_hours is legacy/unused.)
  async getSalesSettings(tenantId: string) {
    const [settings, workingHours] = await Promise.all([
      agentsRepository.getSettings(tenantId, "sales"),
      schedulingService.getWorkingHours(tenantId),
    ]);
    return { ...this.resolveSettings(settings), workingHours };
  }

  async updateSalesSettings(
    tenantId: string,
    patch: Partial<{
      enabled: boolean;
      scoreThreshold: number;
      channels: string[];
      tone: string | null;
      cadence: CadenceStep[];
      dailyCap: number;
      autoSend: boolean;
      escalateToCall: boolean;
      workingHours: unknown;
    }>
  ): Promise<ResolvedSalesSettings> {
    const clampInt = (n: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, Math.round(n)));
    const validChannels = (chs?: string[]) =>
      chs?.filter((c) => c === "WHATSAPP" || c === "EMAIL");
    const row = await agentsRepository.upsertSettings(tenantId, "sales", {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.scoreThreshold !== undefined
        ? { score_threshold: clampInt(patch.scoreThreshold, 0, 100) }
        : {}),
      ...(patch.channels !== undefined
        ? { channels: validChannels(patch.channels)?.length ? validChannels(patch.channels)! : null }
        : {}),
      ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
      ...(patch.cadence !== undefined ? { cadence: normalizeCadence(patch.cadence) } : {}),
      ...(patch.dailyCap !== undefined ? { daily_cap: clampInt(patch.dailyCap, 1, 500) } : {}),
      ...(patch.autoSend !== undefined ? { auto_send: patch.autoSend } : {}),
      ...(patch.escalateToCall !== undefined
        ? { escalate_to_call: patch.escalateToCall }
        : {}),
      ...(patch.workingHours !== undefined ? { working_hours: patch.workingHours } : {}),
    });
    return this.resolveSettings(row);
  }

  async salesEnrollmentStats(tenantId: string): Promise<{ active: number }> {
    return { active: await agentsRepository.countActiveEnrollments(tenantId, "sales") };
  }

  // Entry point for the scheduled runner: for every tenant that has opted in,
  // enrol new signals then advance any due sequence touches. Best-effort and
  // idempotent, safe to run every few minutes.
  async runSalesAutomation(now = new Date()): Promise<{
    tenants: number;
    enrolled: number;
    drafted: number;
  }> {
    const tenantIds = await agentsRepository.enabledTenantIds("sales");
    let enrolled = 0;
    let drafted = 0;
    for (const tenantId of tenantIds) {
      try {
        const settings = this.resolveSettings(await agentsRepository.getSettings(tenantId, "sales"));
        if (!settings.enabled) continue;
        // Respect the WORKSPACE working hours (Settings → Working hours). Only
        // the automation is gated, a human clicking "Generate drafts" can run
        // whenever they like. Due enrollments simply wait for the next open tick.
        if (!(await schedulingService.isTenantOpen(tenantId, now))) continue;
        enrolled += await this.enrollSignals(tenantId, settings, now);
        drafted += await this.runDueEnrollments(tenantId, settings, now);
      } catch (err) {
        logger.warn(`sales automation failed for tenant ${tenantId}: ${String(err)}`);
      }
    }
    return { tenants: tenantIds.length, enrolled, drafted };
  }

  // Enrol fresh signals (hot + recently active leads) that aren't already in a
  // sequence. Bounded by the tenant's daily cap so a backlog can't flood.
  private async enrollSignals(
    tenantId: string,
    settings: ResolvedSalesSettings,
    now: Date
  ): Promise<number> {
    const remaining = await this.remainingDailyBudget(tenantId, settings);
    if (remaining <= 0) return 0;
    const candidates = await agentsRepository.signalLeads(
      tenantId,
      settings.scoreThreshold,
      SIGNAL_RECENCY_DAYS,
      remaining * 2
    );
    const alreadyEnrolled = await agentsRepository.enrolledLeadIds(tenantId, "sales");
    // Feedback loop: a human rejecting a draft for this lead means stop
    // targeting them, never re-enrol someone we were told not to contact.
    const rejected = await agentsRepository.rejectedLeadIds(tenantId, "sales");
    let count = 0;
    for (const lead of candidates) {
      if (count >= remaining) break;
      if (alreadyEnrolled.has(lead.id) || rejected.has(lead.id)) continue;
      const firstDelay = settings.cadence[0]?.delayDays ?? 0;
      // Anchor to the tick's `now` so a delay-0 first touch is immediately due in
      // this same run (a fresh Date.now() would land just after `now`).
      await agentsRepository.createEnrollment({
        tenant_id: tenantId,
        agent: "sales",
        lead_id: lead.id,
        next_run_at: new Date(now.getTime() + firstDelay * 86400000),
      });
      alreadyEnrolled.add(lead.id);
      count++;
    }
    return count;
  }

  private async remainingDailyBudget(
    tenantId: string,
    settings: ResolvedSalesSettings
  ): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const used = await agentsRepository.countOutreachSince(tenantId, "sales", startOfDay);
    return Math.max(0, settings.dailyCap - used);
  }

  // Advance every due enrollment by one touch. Returns how many touches drafted.
  private async runDueEnrollments(
    tenantId: string,
    settings: ResolvedSalesSettings,
    now: Date
  ): Promise<number> {
    const remaining = await this.remainingDailyBudget(tenantId, settings);
    if (remaining <= 0) return 0;
    const due = await agentsRepository.dueEnrollments(tenantId, "sales", now, remaining);
    let drafted = 0;
    for (const enrollment of due) {
      try {
        if (await this.processEnrollment(tenantId, enrollment, settings, now)) drafted++;
      } catch (err) {
        logger.warn(`sales enrollment ${enrollment.id} failed: ${String(err)}`);
      }
    }
    return drafted;
  }

  private async processEnrollment(
    tenantId: string,
    e: AgentEnrollmentRow,
    settings: ResolvedSalesSettings,
    now: Date
  ): Promise<boolean> {
    const cadence = settings.cadence;
    if (e.current_step >= cadence.length) {
      await agentsRepository.completeEnrollment(tenantId, e.id, e.current_step);
      return false;
    }
    const lead = await agentsRepository.leadById(e.lead_id, tenantId);
    if (!lead || lead.status === "CONVERTED") {
      await agentsRepository.setEnrollmentStatus(tenantId, e.id, "STOPPED");
      return false;
    }

    const step = cadence[e.current_step];
    if (step.type === "CALL") {
      await this.placeCallTouch(tenantId, lead, now);
    } else {
      await this.draftTouch(tenantId, lead, step.angle, settings);
    }

    const nextIndex = e.current_step + 1;
    if (nextIndex >= cadence.length) {
      // Sequence exhausted with no reply, hand off to a human.
      await agentsRepository.createFollowUpTask({
        tenant_id: tenantId,
        title: `Follow up with ${lead.name} (sequence ended)`,
        owner_id: lead.owner_id ?? null,
        lead_id: lead.id,
        due_at: new Date(now.getTime() + 86400000),
      });
      await agentsRepository.completeEnrollment(tenantId, e.id, nextIndex, now);
    } else {
      const nextDelay = cadence[nextIndex].delayDays;
      await agentsRepository.advanceEnrollment(
        tenantId,
        e.id,
        nextIndex,
        new Date(now.getTime() + nextDelay * 86400000),
        now
      );
    }
    return true;
  }

  // Compose one sequence touch and queue it as a DRAFT (auto-sending it too when
  // the tenant enabled auto_send). The angle gives each touch a distinct intent.
  private async draftTouch(
    tenantId: string,
    lead: AgentLeadRow,
    angle: string,
    settings: ResolvedSalesSettings
  ): Promise<void> {
    const name = firstName(lead.name);
    const prefer: Channel = settings.channels[0] === "EMAIL" ? "EMAIL" : "WHATSAPP";
    const channel = intendedChannel(prefer, lead.email, lead.phone);
    const ctx = await agentsRepository.salesLeadContext(
      tenantId,
      lead.id,
      lead.converted_contact_id
    );
    const copy = TOUCH_COPY[angle] ?? TOUCH_COPY.intro;
    const facts = buildSalesFacts(lead, ctx);
    facts.sequenceStage = copy.instruction;
    if (settings.tone) facts.tone = settings.tone;

    const draft = await aiProvider.composeOutreach({
      purpose: "sales",
      channel,
      brand: BRAND,
      recipientName: name,
      facts,
      fallbackSubject: copy.subject,
      fallbackBody: copy.body(name),
    });
    const row = await agentsRepository.createOutreach({
      tenant_id: tenantId,
      agent: "sales",
      run_id: null,
      lead_id: lead.id,
      contact_id: null,
      channel,
      subject: draft.subject,
      body: draft.body,
      reason: `${buildSalesReason(lead, ctx)} · sequence touch (${angle})`,
      created_by: null,
    });

    if (settings.autoSend) {
      const result = await this.deliverDraft(
        tenantId,
        null,
        row,
        draft.subject,
        draft.body
      );
      if (result.sent) {
        engineService.audit(tenantId, null, "agent.sales.auto_send", "agent_outreach", row.id, {
          channel: result.channel,
        });
      } else {
        logger.info(`sales auto-send skipped for lead ${lead.id}, no reachable channel`);
      }
    }
  }

  // A CALL step: book a call task for the lead's owner, due the next day.
  private async placeCallTouch(tenantId: string, lead: AgentLeadRow, now: Date): Promise<void> {
    await agentsRepository.createFollowUpTask({
      tenant_id: tenantId,
      title: `Call ${lead.name}`,
      owner_id: lead.owner_id ?? null,
      lead_id: lead.id,
      due_at: new Date(now.getTime() + 86400000),
    });
  }

  // Effectiveness of the agent over a window (drafted / sent / replied / booked).
  async salesMetrics(tenantId: string, sinceDays = 30) {
    const metrics = await agentsRepository.salesMetrics(tenantId, "sales", sinceDays);
    const replyRate = metrics.sent ? Math.round((metrics.replied / metrics.sent) * 100) : 0;
    return { ...metrics, replyRate, windowDays: sinceDays };
  }

  // A lead replied. First attribute the reply to the outreach that earned it
  // (the outcome signal behind reply-rate metrics), this happens whether or not
  // the lead is in a sequence, so manually-approved sends are measured too. Then,
  // if a sequence is running, pause it and draft a contextual response for review.
  async handleInboundReply(tenantId: string, leadId: string, body: string): Promise<void> {
    await agentsRepository.markRepliedForLead(tenantId, "sales", leadId, new Date());

    const enrollment = await agentsRepository.activeEnrollmentForLead(tenantId, "sales", leadId);
    if (!enrollment) return;
    await agentsRepository.setEnrollmentStatus(tenantId, enrollment.id, "REPLIED");

    const lead = await agentsRepository.leadById(leadId, tenantId);
    if (!lead) return;
    const name = firstName(lead.name);
    const channel = intendedChannel("WHATSAPP", lead.email, lead.phone);
    const ctx = await agentsRepository.salesLeadContext(
      tenantId,
      leadId,
      lead.converted_contact_id
    );
    const facts = buildSalesFacts(lead, ctx);
    facts.theirReply = truncate(body, 240);
    facts.sequenceStage =
      "They just replied to our outreach, write a helpful, specific response that moves toward a call or demo.";

    const draft = await aiProvider.composeOutreach({
      purpose: "sales",
      channel,
      brand: BRAND,
      recipientName: name,
      facts,
      fallbackSubject: "Re: your message",
      fallbackBody: `Hi ${name}, thanks for getting back to us! Happy to help, when would be a good time for a quick call?`,
    });
    await agentsRepository.createOutreach({
      tenant_id: tenantId,
      agent: "sales",
      run_id: null,
      lead_id: leadId,
      contact_id: null,
      channel,
      subject: draft.subject,
      body: draft.body,
      reason: "Reply to inbound message",
      created_by: null,
    });
  }

  private async runSupport(tenantId: string, limit: number): Promise<AgentOutcome> {
    const open = await agentsRepository.openTickets(tenantId, limit);
    const articles = await agentsRepository.publishedArticles(tenantId);
    const actions: string[] = [];
    let resolved = 0;
    for (const ticket of open) {
      const hits = ragSearch(articles, `${ticket.subject} ${ticket.body ?? ""}`, 1);
      if (hits.length && hits[0].score >= 2) {
        await agentsRepository.resolveTicketWithAiReply(tenantId, ticket.id, hits[0].snippet);
        resolved++;
        actions.push(`Resolved: ${ticket.subject}`);
      }
    }
    return {
      summary: `Auto-resolved ${resolved}/${open.length} tickets`,
      actions,
      extras: { resolved, considered: open.length },
    };
  }

  private async runCollections(
    tenantId: string,
    actorId: string,
    limit: number
  ): Promise<AgentOutcome> {
    const overdue = await agentsRepository.overdueInvoices(tenantId, limit);
    const actions: string[] = [];
    const tally = new DeliveryTally();
    let withLink = 0;
    for (const invoice of overdue) {
      if (!invoice.contact_id) {
        actions.push(`${invoice.number}: skipped, no contact linked`);
        tally.skipped++;
        continue;
      }
      const name = firstName(invoice.contact_name);
      const total = Number(invoice.amount) + Number(invoice.tax);
      const amountStr = total.toLocaleString("en-IN");

      // Generate a REAL hosted payment link via the tenant's connected gateway.
      // Best-effort: if no gateway is connected, still send a reminder, just
      // without a pay link.
      let payUrl: string | null = null;
      try {
        const link = await financeService.createPaymentLink(tenantId, actorId, invoice.id);
        payUrl = link.pay_url ?? null;
        if (payUrl) withLink++;
      } catch (err) {
        logger.warn(`collections agent: no payment link for invoice ${invoice.id}: ${String(err)}`);
      }

      const fallbackBody = payUrl
        ? `Hi ${name}, a gentle reminder that invoice ${invoice.number} (₹${amountStr}) is pending. You can pay securely here: ${payUrl}`
        : `Hi ${name}, a gentle reminder that invoice ${invoice.number} (₹${amountStr}) is pending. Please arrange payment at your earliest convenience.`;

      // The invoice number, exact amount, and real pay link are required verbatim
      //, if the model omits any, composeOutreach falls back to the template above.
      const draft = await aiProvider.composeOutreach({
        purpose: "collections",
        channel: intendedChannel("EMAIL", invoice.contact_email, invoice.contact_phone),
        brand: BRAND,
        recipientName: name,
        facts: {
          invoiceNumber: invoice.number,
          amountDue: `₹${amountStr}`,
          paymentLink: payUrl ?? undefined,
        },
        mustInclude: payUrl
          ? [String(invoice.number), `₹${amountStr}`, payUrl]
          : [String(invoice.number), `₹${amountStr}`],
        fallbackSubject: `Invoice ${invoice.number} is pending`,
        fallbackBody,
      });

      const res = tally.record(
        await this.deliverToRecipient(tenantId, actorId, {
          contactId: invoice.contact_id,
          email: invoice.contact_email,
          phone: invoice.contact_phone,
          prefer: "EMAIL",
          subject: draft.subject,
          emailCategory: "TRANSACTIONAL",
          text: draft.body,
        })
      );
      actions.push(actionLine(name, res, `${invoice.number}${payUrl ? " + pay link" : ""}`));
    }
    return {
      summary: `Chased ${overdue.length} overdue invoices, ${tally.suffix()}`,
      actions,
      extras: { ...tally.counts, paymentLinks: withLink },
    };
  }

  private async runMarketing(
    tenantId: string,
    actorId: string,
    limit: number,
    audienceTag?: string
  ): Promise<AgentOutcome> {
    const tag = audienceTag && typeof audienceTag === "string" ? audienceTag : "intake-may";
    const segment = await agentsRepository.leadsByTag(tenantId, tag, limit);
    // The message copy comes from the tenant's "followup" WhatsApp template (or a
    // branded default). WhatsApp sends use the approved template; the email
    // fallback uses the same resolved text.
    const template = await engineService.resolveWaTemplate(tenantId, "followup");
    const actions: string[] = [];
    const tally = new DeliveryTally();
    for (const lead of segment) {
      const name = firstName(lead.name);
      const baseCopy = template.replace(/{name}/g, name);
      // WhatsApp must use the approved "followup" template, so we only let the
      // LLM tailor the EMAIL fallback copy (channel: EMAIL); the template copy is
      // the deterministic fallback.
      const draft = await aiProvider.composeOutreach({
        purpose: "marketing",
        channel: "EMAIL",
        brand: BRAND,
        recipientName: name,
        facts: { segment: tag },
        fallbackSubject: "A quick note for you",
        fallbackBody: baseCopy,
      });
      const res = tally.record(
        await this.deliverToRecipient(tenantId, actorId, {
          leadId: lead.id,
          email: lead.email,
          phone: lead.phone,
          prefer: "WHATSAPP",
          subject: draft.subject,
          text: draft.body,
          waTemplateName: "followup",
          waBodyParams: [name],
        })
      );
      actions.push(actionLine(lead.name, res));
    }
    return {
      summary: `Reached ${segment.length} leads tagged "${tag}", ${tally.suffix()}`,
      actions,
      extras: { audience: segment.length, audienceTag: tag, ...tally.counts },
    };
  }

  private async runKnowledge(tenantId: string, query?: string): Promise<AgentOutcome> {
    const q = query && typeof query === "string" ? query : "pricing";
    const articles = await agentsRepository.publishedArticles(tenantId);
    const results = ragSearch(articles, q, 4);
    return {
      summary: `Answered "${q}" with ${results.length} knowledge base sources`,
      actions: results.map((hit) => hit.article.title),
      extras: { query: q, results },
    };
  }

  private async runCoach(tenantId: string): Promise<AgentOutcome> {
    const deal = await agentsRepository.topOpenDeal(tenantId);
    let grade = "WARM";
    if (deal?.lead_id) {
      const lead = await agentsRepository.leadById(deal.lead_id, tenantId);
      if (lead) grade = lead.score_grade;
    }
    const coaching = await aiProvider.coach({ grade, value: deal ? Number(deal.value) : 0 });
    return {
      summary: `Coached on ${deal ? deal.title : "an open deal"}`,
      actions: [coaching.strategy],
      extras: { deal: deal?.title ?? null, ...coaching },
    };
  }
}

export default new AgentsService();
