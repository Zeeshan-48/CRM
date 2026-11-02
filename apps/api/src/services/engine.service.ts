import { ulid } from "ulid";
import { db } from "../db/connection";
import type { channel as ChannelEnum, message_direction } from "../db/enums";
import logger from "../utils/logger";
import { sentiment } from "./ai/heuristics";
import { aiProvider } from "./ai/provider";
import mailerService from "./mailer.service";
import scoringService from "./scoring.service";
import webhookDispatchService from "./webhook-dispatch.service";
import whatsappDeliveryService from "./whatsapp-delivery.service";

/**
 * Automation engine + audit + notifications.
 * Routes emit domain events (lead.created, deal.won, ticket.created, ...);
 * matching active tenant workflows fire their actions. WhatsApp/email actions
 * become messages in conversations (simulated transport until providers are
 * keyed). Audit and notify are fire-and-forget by design: never awaited in a
 * request path, never inside a business transaction.
 */

export const WORKFLOW_TRIGGERS = [
  "lead.created",
  "lead.converted",
  "lead.stage_changed",
  "deal.stage_changed",
  "deal.won",
  "ticket.created",
  "form.submitted",
  // ---- Product integration ----
  // Fired from the product-event pipeline. `product.event` fires for ANY event a
  // connected product sends (the catch-all a workflow can filter on), the rest
  // fire only for the specific situations worth automating a response to.
  "product.event",
  "product.high_intent",
  "product.intent_changed",
  "product.checkout_abandoned",
  "product.trial_ending",
  "product.limit_reached",
] as const;

export const WORKFLOW_ACTIONS = [
  "ASSIGN_AGENT",
  "SEND_WHATSAPP",
  "SEND_EMAIL",
  "CREATE_TASK",
  "ADD_TAG",
  "CREATE_TICKET",
  "NOTIFY",
] as const;

export const DEFAULT_WA_TEMPLATES: Record<string, string> = {
  welcome: "Hi {name}! Welcome aboard. Reply HELP anytime, or 1 to book a free demo.",
  followup: "Hi {name}, just following up. Are you still interested in getting started this week?",
  reminder:
    "Hi {name}, a quick reminder about your pending enrolment. Your early-bird price is still active.",
  payment:
    "Hi {name}, here is your secure payment link to confirm your seat: https://pay.example.com/x",
};

// Branded email fallbacks used by the SEND_EMAIL workflow action when a tenant
// has no matching email_templates row. {name} and {company} are substituted.
export const DEFAULT_EMAIL_TEMPLATES: Record<string, { subject: string; body: string }> = {
  welcome: {
    subject: "Welcome aboard",
    body: [
      "Hi {name},",
      "",
      "Welcome, and thanks for your interest. We are glad to have you on board.",
      "",
      "Our team will reach out shortly to understand your goals and show how we can help. In the meantime, reply to this email with any questions and we will get right back to you.",
      "",
      "Warm regards,",
      "The team",
    ].join("\n"),
  },
  followup: {
    subject: "Following up",
    body: [
      "Hi {name},",
      "",
      "Just following up to see if you had any questions. We would love to help you get started this week.",
      "",
      "Warm regards,",
      "The team",
    ].join("\n"),
  },
};

export interface ConversationRef {
  leadId?: string | null;
  contactId?: string | null;
  subject?: string | null;
}

export interface WorkflowCtx {
  lead?: { id: string; name: string; owner_id?: string | null; tags?: unknown } | null;
  contact?: { id: string; name: string; company?: string | null; tags?: unknown } | null;
  deal?: { id: string } | null;
}

interface WorkflowAction {
  type: string;
  params?: Record<string, unknown>;
}

const firstName = (name?: string | null): string => (name || "there").split(" ")[0];

const parseActions = (actions: unknown): WorkflowAction[] =>
  Array.isArray(actions)
    ? actions.filter((a): a is WorkflowAction => !!a && typeof a === "object" && "type" in a)
    : [];

const parseTags = (tags: unknown): string[] =>
  Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];

class EngineService {
  // ---- Instrumentation (fire-and-forget, never awaited) ----

  audit(
    tenantId: string,
    userId: string | null,
    action: string,
    entityType?: string,
    entityId?: string,
    meta: Record<string, unknown> = {}
  ): void {
    db.insertInto("audit_logs")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        user_id: userId,
        action,
        entity_type: entityType ?? null,
        entity_id: entityId ?? null,
        meta: JSON.stringify(meta),
        created_at: new Date(),
      })
      .execute()
      .catch((err) => logger.warn(`audit write failed: ${err.message}`));
  }

  notify(tenantId: string, userId: string, text: string, link?: string): void {
    db.insertInto("notifications")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        user_id: userId,
        text,
        link: link ?? null,
        read: false,
        created_at: new Date(),
      })
      .execute()
      .catch((err) => logger.warn(`notification write failed: ${err.message}`));
  }

  // ---- Assignment ----

  async roundRobinAgent(
    tenantId: string,
    role = "SALES_AGENT"
  ): Promise<{ id: string; name: string } | null> {
    const agents = await db
      .selectFrom("users")
      .select(["id", "name"])
      .where("tenant_id", "=", tenantId)
      .where("role", "=", role)
      .where("status", "=", "ACTIVE")
      .execute();
    if (agents.length === 0) return null;

    const counts = await db
      .selectFrom("leads")
      .select(["owner_id", db.fn.count<number>("id").as("n")])
      .where("tenant_id", "=", tenantId)
      .where(
        "owner_id",
        "in",
        agents.map((a) => a.id)
      )
      .groupBy("owner_id")
      .execute();

    const countByOwner = new Map(counts.map((c) => [c.owner_id, Number(c.n)]));
    const ranked = agents
      .map((a) => ({ agent: a, n: countByOwner.get(a.id) ?? 0 }))
      .sort((x, y) => x.n - y.n);
    return ranked[0].agent;
  }

  // ---- Conversations / messages ----

  async ensureConversation(tenantId: string, channel: ChannelEnum, ref: ConversationRef) {
    if (ref.leadId || ref.contactId) {
      const existing = await db
        .selectFrom("conversations")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("channel", "=", channel)
        .where((eb) => {
          const ors = [];
          if (ref.leadId) ors.push(eb("lead_id", "=", ref.leadId));
          if (ref.contactId) ors.push(eb("contact_id", "=", ref.contactId));
          return eb.or(ors);
        })
        .executeTakeFirst();
      if (existing) return existing;
    }

    const now = new Date();
    return db
      .insertInto("conversations")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        channel,
        lead_id: ref.leadId ?? null,
        contact_id: ref.contactId ?? null,
        subject: ref.subject ?? channel,
        status: "OPEN",
        last_message_at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async sendMessage(params: {
    tenantId: string;
    channel: ChannelEnum;
    ref: ConversationRef;
    direction: message_direction;
    body: string;
    senderUserId?: string | null;
    simulated?: boolean;
    externalId?: string | null;
    status?: string | null;
    campaignId?: string | null;
  }) {
    const { tenantId, channel, ref, direction, body } = params;
    const conv = await this.ensureConversation(tenantId, channel, ref);
    const now = new Date();
    const senti = sentiment(body);

    const message = await db
      .insertInto("messages")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        conversation_id: conv.id,
        channel,
        direction,
        body,
        lead_id: ref.leadId ?? null,
        contact_id: ref.contactId ?? null,
        sender_user_id: params.senderUserId ?? null,
        sentiment: senti.label,
        sentiment_score: senti.score,
        simulated: params.simulated ?? true,
        external_id: params.externalId ?? null,
        status: params.status ?? null,
        campaign_id: params.campaignId ?? null,
        at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .updateTable("conversations")
      .set({
        last_message_at: now,
        last_preview: body.slice(0, 80),
        updated_at: now,
        ...(direction === "INBOUND" ? { unread_count: conv.unread_count + 1 } : {}),
      })
      .where("id", "=", conv.id)
      .where("tenant_id", "=", tenantId)
      .execute();

    if (ref.leadId) scoringService.recomputeInBackground(tenantId, ref.leadId);

    // The insert used the fast heuristic sentiment (never blocks the request).
    // When a real model is configured, refine it in the background and update
    // the row, so the inbox shows LLM-grade sentiment without any hot-path cost.
    if (aiProvider.name !== "simulated") {
      void this.recomputeSentiment(tenantId, message.id, body);
    }

    return message;
  }

  private async recomputeSentiment(
    tenantId: string,
    messageId: string,
    body: string
  ): Promise<void> {
    try {
      const s = await aiProvider.sentiment(body);
      await db
        .updateTable("messages")
        .set({ sentiment: s.label, sentiment_score: s.score, updated_at: new Date() })
        .where("id", "=", messageId)
        .where("tenant_id", "=", tenantId)
        .execute();
    } catch (err) {
      logger.warn(`sentiment recompute (message ${messageId}): ${String(err)}`);
    }
  }

  async resolveWaTemplate(tenantId: string, templateKey: string): Promise<string> {
    const row = await db
      .selectFrom("whatsapp_templates")
      .select(["body"])
      .where("tenant_id", "=", tenantId)
      .where("key", "=", templateKey)
      .executeTakeFirst();
    return row?.body || DEFAULT_WA_TEMPLATES[templateKey] || DEFAULT_WA_TEMPLATES.welcome;
  }

  // Resolves an email template by name (tenant-scoped). Falls back to a branded
  // default so the SEND_EMAIL action always has subject + body to send.
  async resolveEmailTemplate(
    tenantId: string,
    templateName: string
  ): Promise<{ subject: string; body: string }> {
    const row = await db
      .selectFrom("email_templates")
      .select(["subject", "body"])
      .where("tenant_id", "=", tenantId)
      .where("name", "=", templateName)
      .executeTakeFirst();
    if (row) return { subject: row.subject, body: row.body };
    const fallback =
      DEFAULT_EMAIL_TEMPLATES[templateName.toLowerCase()] || DEFAULT_EMAIL_TEMPLATES.welcome;
    return { ...fallback };
  }

  // ---- Workflow runner ----

  // Resolves a lead or contact email for email sends, tenant-scoped. Used by
  // the SEND_EMAIL workflow action and the inbox EMAIL reply path.
  async recipientEmail(
    tenantId: string,
    ref: { leadId?: string | null; contactId?: string | null }
  ): Promise<string | null> {
    if (ref.leadId) {
      const row = await db
        .selectFrom("leads")
        .select(["email"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", ref.leadId)
        .executeTakeFirst();
      if (row?.email) return row.email;
    }
    if (ref.contactId) {
      const row = await db
        .selectFrom("contacts")
        .select(["email"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", ref.contactId)
        .executeTakeFirst();
      if (row?.email) return row.email;
    }
    return null;
  }

  private async runActions(
    tenantId: string,
    userId: string | null,
    workflow: { id: string; name: string; actions: unknown },
    ctx: WorkflowCtx
  ): Promise<string[]> {
    const log: string[] = [];
    for (const action of parseActions(workflow.actions)) {
      const p = action.params ?? {};
      try {
        if (action.type === "ASSIGN_AGENT" && ctx.lead) {
          const agent = await this.roundRobinAgent(
            tenantId,
            typeof p.role === "string" ? p.role : "SALES_AGENT"
          );
          if (agent) {
            // Never assign a disqualified lead, the WHERE makes it a no-op, and
            // we only record the assignment if a row actually changed.
            const res = await db
              .updateTable("leads")
              .set({ owner_id: agent.id, updated_at: new Date() })
              .where("id", "=", ctx.lead.id)
              .where("tenant_id", "=", tenantId)
              .where("status", "!=", "DISQUALIFIED")
              .executeTakeFirst();
            if (Number(res?.numUpdatedRows ?? 0n) > 0) {
              ctx.lead.owner_id = agent.id;
              log.push(`Assigned to ${agent.name}`);
            }
          }
        } else if (action.type === "SEND_WHATSAPP") {
          const target = ctx.lead || ctx.contact;
          const templateKey = typeof p.templateKey === "string" ? p.templateKey : "welcome";
          const template = await this.resolveWaTemplate(tenantId, templateKey);
          const body = template.replace(/{name}/g, firstName(target?.name));
          // Automation sends are cold, so deliver via the approved Meta template.
          const delivery = await whatsappDeliveryService.deliver(tenantId, {
            leadId: ctx.lead?.id ?? null,
            contactId: ctx.contact?.id ?? null,
            templateName: templateKey,
            bodyParams: [firstName(target?.name)],
          });
          await this.sendMessage({
            tenantId,
            channel: "WHATSAPP",
            ref: {
              leadId: ctx.lead?.id ?? null,
              contactId: ctx.contact?.id ?? null,
              subject: "WhatsApp",
            },
            direction: "OUTBOUND",
            body,
            simulated: delivery.simulated,
            externalId: delivery.messageId,
          });
          log.push("Sent WhatsApp");
        } else if (action.type === "SEND_EMAIL") {
          const target = ctx.lead || ctx.contact;
          const templateName = typeof p.templateName === "string" ? p.templateName : "Welcome";
          const template = await this.resolveEmailTemplate(tenantId, templateName);
          const fill = (s: string) =>
            s
              .replace(/{name}/g, firstName(target?.name))
              .replace(/{company}/g, ctx.contact?.company ?? "");
          const subject = fill(template.subject);
          const emailBody = fill(template.body);
          // Deliver over SES when keyed and the recipient has an email; the
          // send is best-effort so a transport failure never breaks the run.
          const to = await this.recipientEmail(tenantId, {
            leadId: ctx.lead?.id ?? null,
            contactId: ctx.contact?.id ?? null,
          });
          let simulated = true;
          if (to) {
            try {
              const delivery = await mailerService.send({
                tenantId,
                category: "NOTIFICATION",
                to,
                subject,
                text: emailBody,
              });
              simulated = delivery.provider === "SIMULATED";
            } catch (err) {
              logger.warn(`workflow SEND_EMAIL transport failed: ${String(err)}`);
            }
          }
          await this.sendMessage({
            tenantId,
            channel: "EMAIL",
            ref: {
              leadId: ctx.lead?.id ?? null,
              contactId: ctx.contact?.id ?? null,
              subject,
            },
            direction: "OUTBOUND",
            body: emailBody,
            simulated,
          });
          log.push("Sent email");
        } else if (action.type === "CREATE_TASK") {
          const now = new Date();
          const dueInDays = typeof p.dueInDays === "number" ? p.dueInDays : 1;
          const title = (typeof p.title === "string" ? p.title : "Follow up").replace(
            /{name}/g,
            ctx.lead?.name || ctx.contact?.name || ""
          );
          await db
            .insertInto("tasks")
            .values({
              id: ulid(),
              tenant_id: tenantId,
              title,
              status: "OPEN",
              priority: "MEDIUM",
              due_at: new Date(Date.now() + dueInDays * 86400000),
              owner_id: ctx.lead?.owner_id || userId,
              lead_id: ctx.lead?.id ?? null,
              contact_id: ctx.contact?.id ?? null,
              deal_id: ctx.deal?.id ?? null,
              created_at: now,
              updated_at: now,
            })
            .execute();
          log.push("Created task");
        } else if (action.type === "ADD_TAG" && (ctx.lead || ctx.contact)) {
          const table = ctx.lead ? "leads" : "contacts";
          const row = (ctx.lead || ctx.contact)!;
          const tag = typeof p.tag === "string" ? p.tag : "workflow";
          const tags = Array.from(new Set([...parseTags(row.tags), tag]));
          await db
            .updateTable(table)
            .set({ tags: JSON.stringify(tags), updated_at: new Date() })
            .where("id", "=", row.id)
            .where("tenant_id", "=", tenantId)
            .execute();
          log.push(`Tagged ${tag}`);
        } else if (action.type === "CREATE_TICKET") {
          const now = new Date();
          await db
            .insertInto("tickets")
            .values({
              id: ulid(),
              tenant_id: tenantId,
              subject:
                (typeof p.subject === "string" ? p.subject : "Workflow ticket").replace(
                  /{name}/g,
                  ctx.lead?.name || ctx.contact?.name || ""
                ),
              body: typeof p.body === "string" ? p.body : null,
              priority: "MEDIUM",
              status: "OPEN",
              contact_id: ctx.contact?.id ?? null,
              channel: "workflow",
              created_at: now,
              updated_at: now,
            })
            .execute();
          log.push("Created ticket");
        } else if (action.type === "NOTIFY") {
          let query = db
            .selectFrom("users")
            .select(["id"])
            .where("tenant_id", "=", tenantId)
            .where("status", "=", "ACTIVE");
          if (typeof p.role === "string" && p.role) {
            query = query.where("role", "=", p.role);
          }
          const recipients = await query.execute();
          for (const u of recipients) {
            this.notify(
              tenantId,
              u.id,
              typeof p.text === "string" ? p.text : `Workflow ${workflow.name} fired`
            );
          }
          log.push(`Notified ${recipients.length}`);
        }
      } catch (err) {
        log.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return log;
  }

  /** Fire all active workflows in a tenant that match `event`. */
  async emit(
    tenantId: string,
    userId: string | null,
    event: string,
    ctx: WorkflowCtx = {}
  ): Promise<Array<{ id: string; workflowName: string; event: string; log: string[] }>> {
    // Fan the same domain event out to any external product subscribed to it.
    // Queued, never sent inline: this runs inside request paths, and a tenant's
    // slow endpoint must not add latency to a CRM user's click or fail the
    // business operation that triggered it.
    webhookDispatchService.emit(tenantId, event, {
      lead: ctx.lead ?? null,
      contact: ctx.contact ?? null,
      deal: ctx.deal ?? null,
    });

    const flows = await db
      .selectFrom("workflows")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("trigger", "=", event)
      .where("active", "=", true)
      .execute();

    const runs = [];
    for (const wf of flows) {
      const log = await this.runActions(tenantId, userId, wf, ctx);
      const now = new Date();
      const run = await db
        .insertInto("automation_runs")
        .values({
          id: ulid(),
          tenant_id: tenantId,
          workflow_id: wf.id,
          workflow_name: wf.name,
          event,
          log: JSON.stringify(log),
          created_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .updateTable("workflows")
        .set({ last_run_at: now, run_count: wf.run_count + 1, updated_at: now })
        .where("id", "=", wf.id)
        .where("tenant_id", "=", tenantId)
        .execute();
      runs.push({ id: run.id, workflowName: wf.name, event, log });
    }
    return runs;
  }
}

export default new EngineService();
