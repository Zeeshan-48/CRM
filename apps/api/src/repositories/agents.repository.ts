import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type {
  DB,
  agent_enrollments,
  agent_outreach,
  agent_runs,
  agent_settings,
  deals,
  kb_articles,
  leads,
  tickets,
} from "../db/types";

export type AgentRunRow = Selectable<agent_runs>;
export type AgentLeadRow = Selectable<leads>;
export type AgentTicketRow = Selectable<tickets>;
export type AgentKbArticleRow = Selectable<kb_articles>;
export type AgentDealRow = Selectable<deals>;
export type AgentOutreachRow = Selectable<agent_outreach>;
export type AgentSettingsRow = Selectable<agent_settings>;
export type AgentEnrollmentRow = Selectable<agent_enrollments>;

// The real CRM context the sales agent reads to personalise a draft, recent
// timeline, prior thread, the live deal and the person's company/title. Kept
// deliberately small (last few of each) so it fits comfortably in a prompt.
export interface SalesLeadContext {
  activities: {
    type: string;
    subject: string | null;
    notes: string | null;
    created_at: Date;
  }[];
  messages: {
    direction: string;
    body: string;
    sentiment: string | null;
    at: Date;
  }[];
  deal: {
    title: string;
    stage: string | null;
    value: number;
    win_probability: number;
    health_label: string | null;
  } | null;
  contact: { company: string | null; title: string | null } | null;
}

const parseTags = (tags: unknown): string[] =>
  Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];

class AgentsRepository {
  // ---- agent_runs ----

  async runStats(tenantId: string): Promise<Map<string, { runCount: number; lastRunAt: Date | null }>> {
    const rows = await db
      .selectFrom("agent_runs")
      .select(["agent", db.fn.count<number>("id").as("n"), db.fn.max("created_at").as("last")])
      .where("tenant_id", "=", tenantId)
      .groupBy("agent")
      .execute();
    return new Map(
      rows.map((r) => [r.agent, { runCount: Number(r.n), lastRunAt: r.last ?? null }])
    );
  }

  async listRuns(tenantId: string, limit = 100): Promise<AgentRunRow[]> {
    return db
      .selectFrom("agent_runs")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  async createRun(data: {
    tenant_id: string;
    agent: string;
    triggered_by: string | null;
    summary: string;
    actions: string[];
  }): Promise<AgentRunRow> {
    return db
      .insertInto("agent_runs")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        agent: data.agent,
        triggered_by: data.triggered_by,
        summary: data.summary,
        actions: JSON.stringify(data.actions),
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- cross-domain reads the agents act on ----

  async hotLeads(tenantId: string, limit: number): Promise<AgentLeadRow[]> {
    return db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("score_total", ">=", 65)
      .where("status", "!=", "CONVERTED")
      .orderBy("score_total", "desc")
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  async openTickets(tenantId: string, limit: number): Promise<AgentTicketRow[]> {
    return db
      .selectFrom("tickets")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "OPEN")
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  async publishedArticles(tenantId: string): Promise<AgentKbArticleRow[]> {
    return db
      .selectFrom("kb_articles")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "PUBLISHED")
      .execute();
  }

  async overdueInvoices(tenantId: string, limit: number) {
    return db
      .selectFrom("invoices as i")
      .leftJoin("contacts as c", (join) =>
        join.onRef("c.id", "=", "i.contact_id").on("c.tenant_id", "=", tenantId)
      )
      .select([
        "i.id",
        "i.number",
        "i.amount",
        "i.tax",
        "c.id as contact_id",
        "c.name as contact_name",
        "c.email as contact_email",
        "c.phone as contact_phone",
      ])
      .where("i.tenant_id", "=", tenantId)
      .where("i.status", "=", "OVERDUE")
      .orderBy("i.created_at", "desc")
      .limit(limit)
      .execute();
  }

  // Tags live in a Json column, so the segment filter happens in memory over a
  // capped window of the newest leads.
  async leadsByTag(tenantId: string, tag: string, limit: number): Promise<AgentLeadRow[]> {
    const rows = await db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(1000)
      .execute();
    return rows.filter((l) => parseTags(l.tags).includes(tag)).slice(0, limit);
  }

  async topOpenDeal(tenantId: string): Promise<AgentDealRow | undefined> {
    return db
      .selectFrom("deals")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "OPEN")
      .orderBy("value", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  async leadById(id: string, tenantId: string): Promise<AgentLeadRow | undefined> {
    return db
      .selectFrom("leads")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  // ---- cross-domain writes the agents perform ----

  async createFollowUpTask(
    data: {
      tenant_id: string;
      title: string;
      owner_id: string | null;
      lead_id: string;
      due_at: Date;
    },
    trx?: Transaction<DB>
  ) {
    const now = new Date();
    return (trx || db)
      .insertInto("tasks")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        title: data.title,
        status: "OPEN",
        priority: "MEDIUM",
        due_at: data.due_at,
        owner_id: data.owner_id,
        lead_id: data.lead_id,
        // Created by the sales agent, not a human, so the UI can hide/badge it.
        ai_generated: true,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- sales context + suppression + outreach queue ----

  // Gathers the real CRM context for one lead so the sales agent can write a
  // personalised, thread-aware draft instead of a generic template.
  async salesLeadContext(
    tenantId: string,
    leadId: string,
    convertedContactId: string | null
  ): Promise<SalesLeadContext> {
    const [activities, messages, deal, contact] = await Promise.all([
      db
        .selectFrom("activities")
        .select(["type", "subject", "notes", "created_at"])
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .orderBy("created_at", "desc")
        .limit(5)
        .execute(),
      db
        .selectFrom("messages")
        .select(["direction", "body", "sentiment", "at"])
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .orderBy("at", "desc")
        .limit(5)
        .execute(),
      db
        .selectFrom("deals as d")
        .leftJoin("stages as s", (join) =>
          join.onRef("s.id", "=", "d.stage_id").on("s.tenant_id", "=", tenantId)
        )
        .select([
          "d.title",
          "s.name as stage",
          "d.value",
          "d.win_probability",
          "d.health_label",
        ])
        .where("d.tenant_id", "=", tenantId)
        .where("d.lead_id", "=", leadId)
        .orderBy("d.created_at", "desc")
        .limit(1)
        .executeTakeFirst(),
      convertedContactId
        ? db
            .selectFrom("contacts")
            .select(["company", "title"])
            .where("tenant_id", "=", tenantId)
            .where("id", "=", convertedContactId)
            .executeTakeFirst()
        : Promise.resolve(undefined),
    ]);

    return {
      activities: activities.map((a) => ({
        type: String(a.type),
        subject: a.subject,
        notes: a.notes,
        created_at: a.created_at,
      })),
      messages: messages.map((m) => ({
        direction: String(m.direction),
        body: m.body,
        sentiment: m.sentiment,
        at: m.at,
      })),
      deal: deal
        ? {
            title: deal.title,
            stage: deal.stage ?? null,
            value: Number(deal.value),
            win_probability: deal.win_probability,
            health_label: deal.health_label,
          }
        : null,
      contact: contact ? { company: contact.company, title: contact.title } : null,
    };
  }

  // Lead ids the sales agent must NOT re-contact right now: any lead with a
  // pending DRAFT (never pile a second draft on an un-reviewed one), or one
  // approved/sent, or messaged outbound by anyone, within the cooldown window.
  async recentlyContactedLeadIds(tenantId: string, cooldownDays: number): Promise<Set<string>> {
    const cutoff = new Date(Date.now() - cooldownDays * 86400000);
    const [drafts, recentOutreach, recentMessages] = await Promise.all([
      db
        .selectFrom("agent_outreach")
        .select("lead_id")
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "is not", null)
        .where("status", "=", "DRAFT")
        .execute(),
      db
        .selectFrom("agent_outreach")
        .select("lead_id")
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "is not", null)
        .where("status", "in", ["APPROVED", "SENT"])
        .where("created_at", ">=", cutoff)
        .execute(),
      db
        .selectFrom("messages")
        .select("lead_id")
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "is not", null)
        .where("direction", "=", "OUTBOUND")
        .where("at", ">=", cutoff)
        .execute(),
    ]);
    const set = new Set<string>();
    for (const rows of [drafts, recentOutreach, recentMessages]) {
      for (const r of rows) if (r.lead_id) set.add(r.lead_id);
    }
    return set;
  }

  async createOutreach(data: {
    tenant_id: string;
    agent: string;
    run_id: string | null;
    lead_id: string | null;
    contact_id: string | null;
    channel: agent_outreach["channel"];
    subject: string | null;
    body: string;
    reason: string | null;
    created_by: string | null;
  }): Promise<AgentOutreachRow> {
    const now = new Date();
    return db
      .insertInto("agent_outreach")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        agent: data.agent,
        run_id: data.run_id,
        lead_id: data.lead_id,
        contact_id: data.contact_id,
        channel: data.channel,
        status: "DRAFT",
        subject: data.subject,
        body: data.body,
        reason: data.reason,
        created_by: data.created_by,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Drafts joined with their recipient, so the review queue can show WHO each
  // message is going to (and where) without an N+1 lookup per row.
  async listOutreach(tenantId: string, agent: string, status?: string, limit = 100) {
    let q = db
      .selectFrom("agent_outreach as o")
      .leftJoin("leads as l", (join) =>
        join.onRef("l.id", "=", "o.lead_id").on("l.tenant_id", "=", tenantId)
      )
      .leftJoin("contacts as c", (join) =>
        join.onRef("c.id", "=", "o.contact_id").on("c.tenant_id", "=", tenantId)
      )
      .selectAll("o")
      .select([
        "l.name as lead_name",
        "l.email as lead_email",
        "l.phone as lead_phone",
        "l.city as lead_city",
        "l.score_total as lead_score",
        "c.name as contact_name",
        "c.email as contact_email",
        "c.phone as contact_phone",
        "c.company as contact_company",
      ])
      .where("o.tenant_id", "=", tenantId)
      .where("o.agent", "=", agent);
    if (status) q = q.where("o.status", "=", status);
    return q.orderBy("o.created_at", "desc").limit(limit).execute();
  }

  async getOutreach(tenantId: string, id: string): Promise<AgentOutreachRow | undefined> {
    return db
      .selectFrom("agent_outreach")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async updateOutreach(
    tenantId: string,
    id: string,
    patch: Partial<{
      status: string;
      subject: string | null;
      body: string;
      message_id: string | null;
      reviewed_by: string | null;
      approved_at: Date | null;
      sent_at: Date | null;
    }>
  ): Promise<AgentOutreachRow | undefined> {
    return db
      .updateTable("agent_outreach")
      .set({ ...patch, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  // ---- agent settings (Phase 2 automation config) ----

  async getSettings(tenantId: string, agent: string): Promise<AgentSettingsRow | undefined> {
    return db
      .selectFrom("agent_settings")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .executeTakeFirst();
  }

  async upsertSettings(
    tenantId: string,
    agent: string,
    patch: Partial<{
      enabled: boolean;
      score_threshold: number;
      channels: string[] | null;
      tone: string | null;
      cadence: unknown[] | null;
      working_hours: unknown | null;
      daily_cap: number;
      auto_send: boolean;
      escalate_to_call: boolean;
    }>
  ): Promise<AgentSettingsRow> {
    const now = new Date();
    const existing = await this.getSettings(tenantId, agent);
    const json = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));
    if (existing) {
      return db
        .updateTable("agent_settings")
        .set({
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.score_threshold !== undefined
            ? { score_threshold: patch.score_threshold }
            : {}),
          ...(patch.channels !== undefined ? { channels: json(patch.channels) } : {}),
          ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
          ...(patch.cadence !== undefined ? { cadence: json(patch.cadence) } : {}),
          ...(patch.working_hours !== undefined
            ? { working_hours: json(patch.working_hours) }
            : {}),
          ...(patch.daily_cap !== undefined ? { daily_cap: patch.daily_cap } : {}),
          ...(patch.auto_send !== undefined ? { auto_send: patch.auto_send } : {}),
          ...(patch.escalate_to_call !== undefined
            ? { escalate_to_call: patch.escalate_to_call }
            : {}),
          updated_at: now,
        })
        .where("tenant_id", "=", tenantId)
        .where("agent", "=", agent)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return db
      .insertInto("agent_settings")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        agent,
        enabled: patch.enabled ?? false,
        score_threshold: patch.score_threshold ?? 65,
        channels: json(patch.channels ?? null),
        tone: patch.tone ?? null,
        cadence: json(patch.cadence ?? null),
        working_hours: json(patch.working_hours ?? null),
        daily_cap: patch.daily_cap ?? 20,
        auto_send: patch.auto_send ?? false,
        escalate_to_call: patch.escalate_to_call ?? false,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Tenant ids that have opted the given agent's automation ON.
  async enabledTenantIds(agent: string): Promise<string[]> {
    const rows = await db
      .selectFrom("agent_settings")
      .select("tenant_id")
      .where("agent", "=", agent)
      .where("enabled", "=", true)
      .execute();
    return rows.map((r) => r.tenant_id);
  }

  // ---- agent enrollments (Phase 2 sequence engine) ----

  // Candidate leads to enroll: hot enough and recently active, not converted.
  // The caller further excludes leads already enrolled.
  async signalLeads(
    tenantId: string,
    threshold: number,
    sinceDays: number,
    limit: number
  ): Promise<AgentLeadRow[]> {
    const cutoff = new Date(Date.now() - sinceDays * 86400000);
    return db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("score_total", ">=", threshold)
      .where("status", "!=", "CONVERTED")
      .where("last_activity_at", ">=", cutoff)
      .orderBy("last_activity_at", "desc")
      .orderBy("score_total", "desc")
      .limit(limit)
      .execute();
  }

  // Lead ids with a live enrollment (not COMPLETED/STOPPED), excluded from new
  // enrollment so a lead is never in two sequences at once.
  async enrolledLeadIds(tenantId: string, agent: string): Promise<Set<string>> {
    const rows = await db
      .selectFrom("agent_enrollments")
      .select("lead_id")
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("status", "in", ["ACTIVE", "PAUSED", "REPLIED"])
      .execute();
    return new Set(rows.map((r) => r.lead_id));
  }

  async createEnrollment(data: {
    tenant_id: string;
    agent: string;
    lead_id: string;
    next_run_at: Date;
  }): Promise<AgentEnrollmentRow> {
    const now = new Date();
    return db
      .insertInto("agent_enrollments")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        agent: data.agent,
        lead_id: data.lead_id,
        status: "ACTIVE",
        current_step: 0,
        next_run_at: data.next_run_at,
        enrolled_at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async dueEnrollments(
    tenantId: string,
    agent: string,
    now: Date,
    limit: number
  ): Promise<AgentEnrollmentRow[]> {
    return db
      .selectFrom("agent_enrollments")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("status", "=", "ACTIVE")
      .where("next_run_at", "is not", null)
      .where("next_run_at", "<=", now)
      .orderBy("next_run_at", "asc")
      .limit(limit)
      .execute();
  }

  async activeEnrollmentForLead(
    tenantId: string,
    agent: string,
    leadId: string
  ): Promise<AgentEnrollmentRow | undefined> {
    return db
      .selectFrom("agent_enrollments")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("lead_id", "=", leadId)
      .where("status", "in", ["ACTIVE", "PAUSED"])
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  async advanceEnrollment(
    tenantId: string,
    id: string,
    currentStep: number,
    nextRunAt: Date,
    lastTouchAt: Date
  ): Promise<void> {
    await db
      .updateTable("agent_enrollments")
      .set({
        current_step: currentStep,
        next_run_at: nextRunAt,
        last_touch_at: lastTouchAt,
        updated_at: new Date(),
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }

  async completeEnrollment(
    tenantId: string,
    id: string,
    currentStep: number,
    lastTouchAt?: Date
  ): Promise<void> {
    const now = new Date();
    await db
      .updateTable("agent_enrollments")
      .set({
        status: "COMPLETED",
        current_step: currentStep,
        next_run_at: null,
        completed_at: now,
        ...(lastTouchAt ? { last_touch_at: lastTouchAt } : {}),
        updated_at: now,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }

  async setEnrollmentStatus(tenantId: string, id: string, status: string): Promise<void> {
    await db
      .updateTable("agent_enrollments")
      .set({ status, next_run_at: null, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }

  async countActiveEnrollments(tenantId: string, agent: string): Promise<number> {
    const row = await db
      .selectFrom("agent_enrollments")
      .select((eb) => eb.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("status", "in", ["ACTIVE", "PAUSED", "REPLIED"])
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // Drafts this agent created since `since`, enforces the per-day spam cap.
  async countOutreachSince(tenantId: string, agent: string, since: Date): Promise<number> {
    const row = await db
      .selectFrom("agent_outreach")
      .select((eb) => eb.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("created_at", ">=", since)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // ---- outcome tracking + feedback (Phase 3) ----

  // Stamp the lead's most recent SENT outreach as replied. Returns true when a
  // send was actually attributed (the outcome signal behind reply rate).
  async markRepliedForLead(
    tenantId: string,
    agent: string,
    leadId: string,
    repliedAt: Date,
    windowDays = 30
  ): Promise<boolean> {
    const cutoff = new Date(repliedAt.getTime() - windowDays * 86400000);
    const latest = await db
      .selectFrom("agent_outreach")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("lead_id", "=", leadId)
      .where("status", "=", "SENT")
      .where("replied_at", "is", null)
      .where("sent_at", ">=", cutoff)
      .orderBy("sent_at", "desc")
      .executeTakeFirst();
    if (!latest) return false;
    await db
      .updateTable("agent_outreach")
      .set({ replied_at: repliedAt, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", latest.id)
      .execute();
    return true;
  }

  // Leads whose most recent draft a human REJECTED, the agent should stop
  // targeting them (a real, if simple, feedback loop).
  async rejectedLeadIds(tenantId: string, agent: string): Promise<Set<string>> {
    const rows = await db
      .selectFrom("agent_outreach")
      .select("lead_id")
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("status", "=", "REJECTED")
      .where("lead_id", "is not", null)
      .execute();
    return new Set(rows.map((r) => r.lead_id).filter((id): id is string => !!id));
  }

  // Effectiveness of the agent over a window: what it drafted, what actually
  // went out, what came back, and how many meetings followed.
  async salesMetrics(
    tenantId: string,
    agent: string,
    sinceDays: number
  ): Promise<{
    drafted: number;
    sent: number;
    replied: number;
    rejected: number;
    pending: number;
    meetings: number;
  }> {
    const since = new Date(Date.now() - sinceDays * 86400000);
    const rows = await db
      .selectFrom("agent_outreach")
      .select(["status", "replied_at", "lead_id", "sent_at"])
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("created_at", ">=", since)
      .execute();

    const drafted = rows.length;
    const sent = rows.filter((r) => r.status === "SENT").length;
    const replied = rows.filter((r) => r.replied_at).length;
    const rejected = rows.filter((r) => r.status === "REJECTED").length;
    const pending = rows.filter((r) => r.status === "DRAFT").length;

    // Meetings booked with a lead AFTER we messaged them (best-effort attribution).
    const contactedLeadIds = [
      ...new Set(
        rows
          .filter((r) => r.status === "SENT" && r.lead_id)
          .map((r) => r.lead_id as string)
      ),
    ];
    let meetings = 0;
    if (contactedLeadIds.length) {
      const row = await db
        .selectFrom("meetings")
        .select((eb) => eb.fn.count<number>("id").as("n"))
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "in", contactedLeadIds)
        .where("created_at", ">=", since)
        .executeTakeFirst();
      meetings = Number(row?.n ?? 0);
    }
    return { drafted, sent, replied, rejected, pending, meetings };
  }

  async resolveTicketWithAiReply(tenantId: string, ticketId: string, replyBody: string) {
    const now = new Date();
    await db
      .insertInto("ticket_replies")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        ticket_id: ticketId,
        author_user_id: null,
        is_ai: true,
        body: replyBody,
        created_at: now,
      })
      .execute();
    await db
      .updateTable("tickets")
      .set({ status: "RESOLVED", resolved_at: now, resolved_by: "ai", updated_at: now })
      .where("id", "=", ticketId)
      .where("tenant_id", "=", tenantId)
      .execute();
  }
}

export default new AgentsRepository();
