import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, contacts, leads, sla_policies, ticket_replies, tickets } from "../db/types";
import type { ticket_priority, ticket_status } from "../db/enums";

export type TicketRow = Selectable<tickets>;
export type TicketReplyRow = Selectable<ticket_replies>;
export type SlaPolicyRow = Selectable<sla_policies>;
export type ContactRow = Selectable<contacts>;
export type LeadRow = Selectable<leads>;

export interface TicketsListParams {
  status?: ticket_status;
  priority?: ticket_priority;
  assignee?: string;
}

export interface CreateTicketData {
  tenant_id: string;
  subject: string;
  body?: string | null;
  priority?: ticket_priority;
  contact_id?: string | null;
  lead_id?: string | null;
  assignee_id?: string | null;
  channel?: string | null;
  sla_due_at?: Date | null;
  sentiment?: string | null;
}

export interface TicketPatch {
  status?: ticket_status;
  priority?: ticket_priority;
  assignee_id?: string | null;
  escalated?: boolean;
  first_response_at?: Date;
  resolved_at?: Date | null;
  resolved_by?: string | null;
}

class TicketsRepository {
  async list(
    tenantId: string,
    params: TicketsListParams = {}
  ): Promise<Array<TicketRow & { contact: string | null; lead: string | null }>> {
    let query = db
      .selectFrom("tickets")
      .leftJoin("contacts", (join) =>
        join
          .onRef("contacts.id", "=", "tickets.contact_id")
          .on("contacts.tenant_id", "=", tenantId)
      )
      .leftJoin("leads", (join) =>
        join.onRef("leads.id", "=", "tickets.lead_id").on("leads.tenant_id", "=", tenantId)
      )
      .selectAll("tickets")
      .select(["contacts.name as contact", "leads.name as lead"])
      .where("tickets.tenant_id", "=", tenantId);

    if (params.status) query = query.where("tickets.status", "=", params.status);
    if (params.priority) query = query.where("tickets.priority", "=", params.priority);
    if (params.assignee) query = query.where("tickets.assignee_id", "=", params.assignee);

    return query.orderBy("tickets.created_at", "desc").execute();
  }

  async findById(id: string, tenantId: string): Promise<TicketRow | undefined> {
    return db
      .selectFrom("tickets")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findContact(tenantId: string, contactId: string): Promise<ContactRow | undefined> {
    return db
      .selectFrom("contacts")
      .selectAll()
      .where("id", "=", contactId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findLead(tenantId: string, leadId: string): Promise<LeadRow | undefined> {
    return db
      .selectFrom("leads")
      .selectAll()
      .where("id", "=", leadId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async listSlaPolicies(tenantId: string): Promise<SlaPolicyRow[]> {
    return db
      .selectFrom("sla_policies")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async findDefaultSlaPolicy(tenantId: string): Promise<SlaPolicyRow | undefined> {
    return db
      .selectFrom("sla_policies")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("is_default", "=", true)
      .executeTakeFirst();
  }

  async metrics(tenantId: string) {
    const now = new Date();
    const [totals, priorityRows] = await Promise.all([
      db
        .selectFrom("tickets")
        .where("tenant_id", "=", tenantId)
        .select((eb) => [
          eb.fn.count<number>("id").as("total"),
          eb.fn
            .count<number>("id")
            .filterWhere("status", "not in", ["RESOLVED", "CLOSED"])
            .as("open"),
          eb.fn.count<number>("id").filterWhere("status", "=", "RESOLVED").as("resolved"),
          eb.fn
            .count<number>("id")
            .filterWhere((fb) =>
              fb.and([
                fb("status", "not in", ["RESOLVED", "CLOSED"]),
                fb("sla_due_at", "is not", null),
                fb("sla_due_at", "<", now),
              ])
            )
            .as("breached"),
          eb.fn.avg<string | null>("csat").as("csat"),
        ])
        .executeTakeFirst(),
      db
        .selectFrom("tickets")
        .where("tenant_id", "=", tenantId)
        .select(["priority", db.fn.count<number>("id").as("n")])
        .groupBy("priority")
        .execute(),
    ]);

    return {
      total: Number(totals?.total ?? 0),
      open: Number(totals?.open ?? 0),
      resolved: Number(totals?.resolved ?? 0),
      breached: Number(totals?.breached ?? 0),
      csat: totals?.csat == null ? null : Math.round(Number(totals.csat) * 100) / 100,
      priorityCounts: priorityRows.map((r) => ({
        priority: r.priority,
        count: Number(r.n),
      })),
    };
  }

  async create(data: CreateTicketData, trx?: Transaction<DB>): Promise<TicketRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("tickets")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        subject: data.subject,
        body: data.body ?? null,
        priority: data.priority ?? "MEDIUM",
        status: "OPEN",
        contact_id: data.contact_id ?? null,
        lead_id: data.lead_id ?? null,
        assignee_id: data.assignee_id ?? null,
        channel: data.channel ?? "web",
        sla_due_at: data.sla_due_at ?? null,
        sentiment: data.sentiment ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    data: TicketPatch,
    trx?: Transaction<DB>
  ): Promise<TicketRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    const direct = [
      "status",
      "priority",
      "assignee_id",
      "escalated",
      "first_response_at",
      "resolved_at",
      "resolved_by",
    ] as const;
    for (const key of direct) {
      if (data[key] !== undefined) patch[key] = data[key];
    }

    return (trx || db)
      .updateTable("tickets")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    // ticket_replies cascade-delete via the FK.
    const result = await db
      .deleteFrom("tickets")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  async listReplies(tenantId: string, ticketId: string): Promise<TicketReplyRow[]> {
    return db
      .selectFrom("ticket_replies")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("ticket_id", "=", ticketId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async addReply(data: {
    tenant_id: string;
    ticket_id: string;
    author_user_id?: string | null;
    is_ai?: boolean;
    body: string;
    channel?: string | null;
  }): Promise<TicketReplyRow> {
    return db
      .insertInto("ticket_replies")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        ticket_id: data.ticket_id,
        author_user_id: data.author_user_id ?? null,
        is_ai: data.is_ai ?? false,
        body: data.body,
        channel: data.channel ?? null,
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

export default new TicketsRepository();
