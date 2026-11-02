import { db } from "../db/connection";
import { ticket_priority, ticket_status } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import kbRepository from "../repositories/kb.repository";
import ticketsRepository, {
  TicketRow,
  TicketsListParams,
} from "../repositories/tickets.repository";
import { ragSearch, sentiment } from "./ai/heuristics";
import emailService from "./email.service";
import engineService from "./engine.service";
import whatsappService from "./whatsapp.service";

type ReplyChannel = "email" | "whatsapp";

const PRIORITY_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const DEFAULT_RESOLUTION_HOURS = 24;
const AI_CONFIDENCE_THRESHOLD = 2;

const isTicketStatus = (value: string): value is ticket_status =>
  Object.values(ticket_status).includes(value as ticket_status);

const isTicketPriority = (value: string): value is ticket_priority =>
  Object.values(ticket_priority).includes(value as ticket_priority);

const isBreached = (ticket: TicketRow): boolean =>
  ticket.status !== "RESOLVED" &&
  ticket.status !== "CLOSED" &&
  ticket.sla_due_at !== null &&
  new Date(ticket.sla_due_at).getTime() < Date.now();

class TicketsService {
  async list(
    tenantId: string,
    params: { status?: string; priority?: string; assignee?: string }
  ) {
    const filters: TicketsListParams = { assignee: params.assignee };
    if (params.status) {
      if (!isTicketStatus(params.status)) {
        throw new BadRequestError(`status must be one of ${Object.values(ticket_status).join(", ")}`);
      }
      filters.status = params.status;
    }
    if (params.priority) {
      if (!isTicketPriority(params.priority)) {
        throw new BadRequestError(
          `priority must be one of ${Object.values(ticket_priority).join(", ")}`
        );
      }
      filters.priority = params.priority;
    }

    const rows = await ticketsRepository.list(tenantId, filters);
    return rows.map((t) => ({ ...t, breached: isBreached(t) }));
  }

  async slaPolicies(tenantId: string) {
    return ticketsRepository.listSlaPolicies(tenantId);
  }

  async metrics(tenantId: string) {
    const { total, open, resolved, breached, csat, priorityCounts } =
      await ticketsRepository.metrics(tenantId);
    const byPriority = PRIORITY_ORDER.map((priority) => ({
      priority,
      count: priorityCounts.find((p) => p.priority === priority)?.count ?? 0,
    }));
    return { total, open, resolved, breached, byPriority, csat };
  }

  async detail(tenantId: string, ticketId: string) {
    const ticket = await ticketsRepository.findById(ticketId, tenantId);
    if (!ticket) throw new NotFoundError("Ticket not found");
    const [contact, lead, replies] = await Promise.all([
      ticket.contact_id
        ? ticketsRepository.findContact(tenantId, ticket.contact_id)
        : Promise.resolve(undefined),
      ticket.lead_id
        ? ticketsRepository.findLead(tenantId, ticket.lead_id)
        : Promise.resolve(undefined),
      ticketsRepository.listReplies(tenantId, ticketId),
    ]);
    // The lead/contact is who a reply is sent to; expose just the fields the UI
    // needs to decide which channels (email/WhatsApp) are available.
    const leadSummary = lead
      ? { id: lead.id, name: lead.name, email: lead.email, phone: lead.phone, company: null }
      : null;
    return {
      ...ticket,
      breached: isBreached(ticket),
      contact: contact ?? null,
      lead: leadSummary,
      replies,
    };
  }

  // Confirms an assignee is a real active user in the tenant. Returns the user
  // id when valid so the caller can persist + notify; throws otherwise.
  private async resolveAssignee(tenantId: string, assigneeId?: string | null) {
    if (!assigneeId) return null;
    const user = await db
      .selectFrom("users")
      .select(["id"])
      .where("id", "=", assigneeId)
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "ACTIVE")
      .executeTakeFirst();
    if (!user) throw new BadRequestError("Assignee must be an active team member");
    return user.id;
  }

  // The person a customer-facing reply is delivered to. Prefers a linked
  // contact, falling back to a linked lead; both carry email + phone.
  private async resolveRecipient(tenantId: string, ticket: TicketRow) {
    if (ticket.contact_id) {
      const contact = await ticketsRepository.findContact(tenantId, ticket.contact_id);
      if (contact) return { kind: "contact" as const, id: contact.id, email: contact.email, phone: contact.phone };
    }
    if (ticket.lead_id) {
      const lead = await ticketsRepository.findLead(tenantId, ticket.lead_id);
      if (lead) return { kind: "lead" as const, id: lead.id, email: lead.email, phone: lead.phone };
    }
    return null;
  }

  async create(
    tenantId: string,
    actorId: string,
    body: {
      subject?: string;
      body?: string;
      priority?: string;
      contactId?: string;
      leadId?: string;
      assigneeId?: string;
      channel?: string;
    }
  ) {
    if (!body.subject || !String(body.subject).trim()) {
      throw new BadRequestError("subject required");
    }
    if (body.priority && !isTicketPriority(body.priority)) {
      throw new BadRequestError(
        `priority must be one of ${Object.values(ticket_priority).join(", ")}`
      );
    }

    const contact = body.contactId
      ? await ticketsRepository.findContact(tenantId, body.contactId)
      : undefined;
    if (body.contactId && !contact) throw new NotFoundError("Contact not found");

    const lead = body.leadId
      ? await ticketsRepository.findLead(tenantId, body.leadId)
      : undefined;
    if (body.leadId && !lead) throw new NotFoundError("Lead not found");

    const assigneeId = await this.resolveAssignee(tenantId, body.assigneeId);

    const slaPolicy = await ticketsRepository.findDefaultSlaPolicy(tenantId);
    const resolutionHours = Number(slaPolicy?.resolution_hours ?? DEFAULT_RESOLUTION_HOURS);

    const ticket = await ticketsRepository.create({
      tenant_id: tenantId,
      subject: String(body.subject).trim(),
      body: body.body ?? "",
      priority: body.priority as ticket_priority | undefined,
      contact_id: contact?.id ?? null,
      lead_id: lead?.id ?? null,
      assignee_id: assigneeId,
      channel: body.channel ?? "web",
      sla_due_at: new Date(Date.now() + resolutionHours * 3600000),
      sentiment: sentiment(body.body || body.subject).label,
    });

    // Tell the assignee they own it, unless they assigned it to themselves.
    if (assigneeId && assigneeId !== actorId) {
      engineService.notify(tenantId, assigneeId, `Ticket assigned to you: ${ticket.subject}`);
    }

    await engineService.emit(tenantId, actorId, "ticket.created", contact ? { contact } : {});
    engineService.audit(tenantId, actorId, "ticket.created", "ticket", ticket.id, {
      priority: ticket.priority,
    });
    return ticket;
  }

  async update(
    tenantId: string,
    actorId: string,
    ticketId: string,
    body: { status?: string; priority?: string; assignee_id?: string | null }
  ) {
    const existing = await ticketsRepository.findById(ticketId, tenantId);
    if (!existing) throw new NotFoundError("Ticket not found");

    const patch: Parameters<typeof ticketsRepository.update>[2] = {};
    if (body.status !== undefined) {
      if (!isTicketStatus(body.status)) {
        throw new BadRequestError(`status must be one of ${Object.values(ticket_status).join(", ")}`);
      }
      patch.status = body.status;
      if (body.status === "RESOLVED" && existing.status !== "RESOLVED") {
        patch.resolved_at = new Date();
      }
    }
    if (body.priority !== undefined) {
      if (!isTicketPriority(body.priority)) {
        throw new BadRequestError(
          `priority must be one of ${Object.values(ticket_priority).join(", ")}`
        );
      }
      patch.priority = body.priority;
    }
    if (body.assignee_id !== undefined) {
      // Validate a non-null assignee is a real active member before saving.
      patch.assignee_id = body.assignee_id
        ? await this.resolveAssignee(tenantId, body.assignee_id)
        : null;
    }

    const updated = await ticketsRepository.update(ticketId, tenantId, patch);
    if (!updated) throw new NotFoundError("Ticket not found");

    // Notify on a genuine reassignment to someone other than the actor.
    if (
      patch.assignee_id &&
      patch.assignee_id !== existing.assignee_id &&
      patch.assignee_id !== actorId
    ) {
      engineService.notify(
        tenantId,
        patch.assignee_id,
        `Ticket assigned to you: ${existing.subject}`
      );
    }

    engineService.audit(tenantId, actorId, "ticket.updated", "ticket", ticketId, {
      ...patch,
    });
    return updated;
  }

  async remove(tenantId: string, actorId: string, ticketId: string) {
    const deleted = await ticketsRepository.delete(ticketId, tenantId);
    if (!deleted) throw new NotFoundError("Ticket not found");
    engineService.audit(tenantId, actorId, "ticket.deleted", "ticket", ticketId, {});
    return { ok: true };
  }

  async escalate(tenantId: string, actorId: string, ticketId: string) {
    const ticket = await ticketsRepository.findById(ticketId, tenantId);
    if (!ticket) throw new NotFoundError("Ticket not found");

    const updated = await ticketsRepository.update(ticketId, tenantId, {
      priority: "URGENT",
      escalated: true,
    });
    if (!updated) throw new NotFoundError("Ticket not found");

    const recipients = await db
      .selectFrom("users")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "ACTIVE")
      .where("role", "in", ["MANAGER", "ADMIN"])
      .execute();
    for (const user of recipients) {
      engineService.notify(tenantId, user.id, `Ticket escalated: ${ticket.subject}`);
    }
    engineService.audit(tenantId, actorId, "ticket.escalated", "ticket", ticketId, {
      notified: recipients.length,
    });
    return updated;
  }

  async reply(
    tenantId: string,
    actorId: string,
    ticketId: string,
    body: { body?: string; toCustomer?: boolean; channel?: string }
  ) {
    const text = (body.body ?? "").trim();
    if (!text) throw new BadRequestError("body required");

    const ticket = await ticketsRepository.findById(ticketId, tenantId);
    if (!ticket) throw new NotFoundError("Ticket not found");

    // When asked to reach the customer, deliver over the chosen channel FIRST, // if delivery fails we throw and never record it as sent, so the thread
    // stays truthful. Internal notes (toCustomer=false) skip all of this.
    let sentChannel: ReplyChannel | null = null;
    if (body.toCustomer) {
      const channel = body.channel as ReplyChannel | undefined;
      if (channel !== "email" && channel !== "whatsapp") {
        throw new BadRequestError("channel must be 'email' or 'whatsapp' to reply to the customer");
      }
      const recipient = await this.resolveRecipient(tenantId, ticket);
      if (!recipient) {
        throw new BadRequestError("Link a contact or lead to this ticket before replying to the customer");
      }
      const ref =
        recipient.kind === "contact"
          ? { contactId: recipient.id }
          : { leadId: recipient.id };

      if (channel === "email") {
        if (!recipient.email) throw new BadRequestError("This customer has no email address on file");
        await emailService.send(tenantId, actorId, {
          ...ref,
          subject: `Re: ${ticket.subject}`,
          body: text,
        });
      } else {
        if (!recipient.phone) throw new BadRequestError("This customer has no phone number on file");
        const result = await whatsappService.send(tenantId, actorId, { ...ref, body: text });
        if (result.error) throw new BadRequestError(`WhatsApp delivery failed: ${result.error}`);
      }
      sentChannel = channel;
    }

    const reply = await ticketsRepository.addReply({
      tenant_id: tenantId,
      ticket_id: ticketId,
      author_user_id: actorId,
      is_ai: false,
      body: text,
      channel: sentChannel,
    });

    const patch: Parameters<typeof ticketsRepository.update>[2] = {};
    if (!ticket.first_response_at) patch.first_response_at = new Date();
    if (ticket.status === "OPEN") patch.status = "PENDING";
    const updated = Object.keys(patch).length
      ? await ticketsRepository.update(ticketId, tenantId, patch)
      : ticket;

    engineService.audit(tenantId, actorId, "ticket.replied", "ticket", ticketId, {
      sentToCustomer: sentChannel ?? "internal",
    });
    return { ticket: updated ?? ticket, reply, sentChannel };
  }

  async aiResolve(tenantId: string, actorId: string, ticketId: string) {
    const ticket = await ticketsRepository.findById(ticketId, tenantId);
    if (!ticket) throw new NotFoundError("Ticket not found");

    const articles = await kbRepository.list(tenantId, "PUBLISHED");
    const hits = ragSearch(articles, `${ticket.subject} ${ticket.body ?? ""}`, 2);
    const top = hits[0] ?? null;

    if (!top || top.score < AI_CONFIDENCE_THRESHOLD) {
      return { resolved: false, suggestion: top };
    }

    const reply = await ticketsRepository.addReply({
      tenant_id: tenantId,
      ticket_id: ticketId,
      author_user_id: null,
      is_ai: true,
      body: top.snippet,
    });
    await ticketsRepository.update(ticketId, tenantId, {
      status: "RESOLVED",
      resolved_at: new Date(),
      resolved_by: "ai",
    });

    engineService.audit(tenantId, actorId, "ticket.ai_resolved", "ticket", ticketId, {
      articleId: top.article.id,
      score: top.score,
    });
    return { resolved: true, reply, source: top.article };
  }
}

export default new TicketsService();
