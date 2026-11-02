import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { activity_type, message_direction, priority, task_status } from "../db/enums";
import type { activities, DB, tasks } from "../db/types";

export type ActivityRow = Selectable<activities>;
export type TaskRow = Selectable<tasks>;

// An activity row enriched with the display names the feed needs so it can read
// "<agent> did <X> with <lead/contact/deal>" without extra client lookups:
//  - owner_name: the agent who logged/owns it
//  - with_type/with_name: the linked record (lead > contact > deal precedence)
export type ActivityWithMeta = ActivityRow & {
  owner_name: string | null;
  with_type: "LEAD" | "CONTACT" | "DEAL" | null;
  with_name: string | null;
};

export interface ActivitiesListParams {
  type?: activity_type;
  leadId?: string;
  contactId?: string;
  dealId?: string;
  owner?: string;
  // When false, exclude AI-generated rows. Undefined/true = include everything
  // (preserves existing callers; only the team feed opts into hiding).
  includeAi?: boolean;
  limit?: number;
}

export interface CreateActivityData {
  tenant_id: string;
  type: activity_type;
  direction?: message_direction | null;
  subject?: string | null;
  notes?: string | null;
  owner_id?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  duration_sec?: number | null;
  ai_generated?: boolean;
}

export interface UpdateActivityData {
  type?: activity_type;
  direction?: message_direction | null;
  subject?: string | null;
  notes?: string | null;
  owner_id?: string | null;
  duration_sec?: number | null;
}

export interface UpdateTaskData {
  title?: string;
  priority?: priority;
  status?: task_status;
  due_at?: Date | null;
  completed_at?: Date | null;
  owner_id?: string | null;
  remind_daily?: boolean;
  reminder_last_sent_at?: Date | null;
}

export interface TasksListParams {
  status?: task_status;
  owner?: string;
  // When false, exclude AI-created tasks (undefined/true = include all).
  includeAi?: boolean;
}

export interface CreateTaskData {
  tenant_id: string;
  title: string;
  priority?: priority;
  due_at?: Date | null;
  owner_id?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  remind_daily?: boolean;
  ai_generated?: boolean;
}

// A task due for its daily reminder email, pre-joined with the owner's address
// and the linked lead's name so the reminder job needs no extra lookups.
export interface DueReminderTask {
  id: string;
  tenant_id: string;
  title: string;
  priority: priority;
  due_at: Date | null;
  lead_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string;
  lead_name: string | null;
}

class ActivitiesRepository {
  async list(tenantId: string, params: ActivitiesListParams = {}): Promise<ActivityWithMeta[]> {
    const limit = Math.min(500, Math.max(1, params.limit ?? 100));
    // Join the owner (agent) and each possible linked record so the feed can show
    // real names. Joins are tenant-scoped and left, so an activity with no link
    // (or a deleted one) still returns, just with null names.
    let query = db
      .selectFrom("activities")
      .leftJoin("users", (join) =>
        join
          .onRef("users.id", "=", "activities.owner_id")
          .onRef("users.tenant_id", "=", "activities.tenant_id")
      )
      .leftJoin("leads", (join) =>
        join
          .onRef("leads.id", "=", "activities.lead_id")
          .onRef("leads.tenant_id", "=", "activities.tenant_id")
      )
      .leftJoin("contacts", (join) =>
        join
          .onRef("contacts.id", "=", "activities.contact_id")
          .onRef("contacts.tenant_id", "=", "activities.tenant_id")
      )
      .leftJoin("deals", (join) =>
        join
          .onRef("deals.id", "=", "activities.deal_id")
          .onRef("deals.tenant_id", "=", "activities.tenant_id")
      )
      .selectAll("activities")
      .select([
        "users.name as owner_name",
        "leads.name as lead_name",
        "contacts.name as contact_name",
        "deals.title as deal_name",
      ])
      .where("activities.tenant_id", "=", tenantId);
    if (params.type) query = query.where("activities.type", "=", params.type);
    if (params.leadId) query = query.where("activities.lead_id", "=", params.leadId);
    if (params.contactId) query = query.where("activities.contact_id", "=", params.contactId);
    if (params.dealId) query = query.where("activities.deal_id", "=", params.dealId);
    if (params.owner) query = query.where("activities.owner_id", "=", params.owner);
    if (params.includeAi === false) query = query.where("activities.ai_generated", "=", false);

    const rows = await query.orderBy("activities.created_at", "desc").limit(limit).execute();

    return rows.map(({ lead_name, contact_name, deal_name, ...rest }) => {
      // Precedence lead > contact > deal (an activity is linked to at most one in
      // practice; this fixes an order if it ever carries more than one id).
      let with_type: ActivityWithMeta["with_type"] = null;
      let with_name: string | null = null;
      if (rest.lead_id) {
        with_type = "LEAD";
        with_name = lead_name;
      } else if (rest.contact_id) {
        with_type = "CONTACT";
        with_name = contact_name;
      } else if (rest.deal_id) {
        with_type = "DEAL";
        with_name = deal_name;
      }
      return { ...rest, with_type, with_name };
    });
  }

  // Real total count of activities matching the same filters as list(), but with
  // NO limit, so the UI can show a true "activities logged" figure instead of
  // the length of a page-capped list (which pins at the limit and never grows).
  async count(tenantId: string, params: ActivitiesListParams = {}): Promise<number> {
    let query = db
      .selectFrom("activities")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId);
    if (params.type) query = query.where("type", "=", params.type);
    if (params.leadId) query = query.where("lead_id", "=", params.leadId);
    if (params.contactId) query = query.where("contact_id", "=", params.contactId);
    if (params.dealId) query = query.where("deal_id", "=", params.dealId);
    if (params.owner) query = query.where("owner_id", "=", params.owner);
    if (params.includeAi === false) query = query.where("ai_generated", "=", false);
    const row = await query.executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async create(data: CreateActivityData, trx?: Transaction<DB>): Promise<ActivityRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("activities")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        type: data.type,
        direction: data.direction ?? null,
        subject: data.subject ?? null,
        notes: data.notes ?? "",
        owner_id: data.owner_id ?? null,
        lead_id: data.lead_id ?? null,
        contact_id: data.contact_id ?? null,
        deal_id: data.deal_id ?? null,
        duration_sec: data.duration_sec ?? null,
        ai_generated: data.ai_generated ?? false,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findActivityById(id: string, tenantId: string): Promise<ActivityRow | undefined> {
    return db
      .selectFrom("activities")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async updateActivity(
    id: string,
    tenantId: string,
    patch: UpdateActivityData
  ): Promise<ActivityRow | undefined> {
    return db
      .updateTable("activities")
      .set({
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
        ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.owner_id !== undefined ? { owner_id: patch.owner_id } : {}),
        ...(patch.duration_sec !== undefined ? { duration_sec: patch.duration_sec } : {}),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteActivity(id: string, tenantId: string): Promise<boolean> {
    const row = await db
      .deleteFrom("activities")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returning("id")
      .executeTakeFirst();
    return !!row;
  }

  async listTasks(tenantId: string, params: TasksListParams = {}): Promise<TaskRow[]> {
    let query = db.selectFrom("tasks").selectAll().where("tenant_id", "=", tenantId);
    if (params.status) query = query.where("status", "=", params.status);
    if (params.owner) query = query.where("owner_id", "=", params.owner);
    if (params.includeAi === false) query = query.where("ai_generated", "=", false);
    return query.orderBy("due_at", "asc").execute();
  }

  async createTask(data: CreateTaskData, trx?: Transaction<DB>): Promise<TaskRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("tasks")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        title: data.title,
        status: "OPEN",
        priority: data.priority ?? "MEDIUM",
        due_at: data.due_at ?? null,
        completed_at: null,
        owner_id: data.owner_id ?? null,
        lead_id: data.lead_id ?? null,
        contact_id: data.contact_id ?? null,
        deal_id: data.deal_id ?? null,
        remind_daily: data.remind_daily ?? false,
        reminder_last_sent_at: null,
        ai_generated: data.ai_generated ?? false,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findTaskById(id: string, tenantId: string): Promise<TaskRow | undefined> {
    return db
      .selectFrom("tasks")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async completeTask(id: string, tenantId: string): Promise<TaskRow | undefined> {
    const now = new Date();
    return db
      .updateTable("tasks")
      .set({ status: "DONE", completed_at: now, updated_at: now })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async updateTask(
    id: string,
    tenantId: string,
    patch: UpdateTaskData
  ): Promise<TaskRow | undefined> {
    return db
      .updateTable("tasks")
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.due_at !== undefined ? { due_at: patch.due_at } : {}),
        ...(patch.completed_at !== undefined ? { completed_at: patch.completed_at } : {}),
        ...(patch.owner_id !== undefined ? { owner_id: patch.owner_id } : {}),
        ...(patch.remind_daily !== undefined ? { remind_daily: patch.remind_daily } : {}),
        ...(patch.reminder_last_sent_at !== undefined
          ? { reminder_last_sent_at: patch.reminder_last_sent_at }
          : {}),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  // Tasks whose daily reminder is due: still OPEN, opted in, with an owner who
  // has an email, and not already reminded today (dayStart is midnight UTC).
  // Joined with the owner + lead so the job sends without further queries.
  async dueReminderTasks(dayStart: Date): Promise<DueReminderTask[]> {
    return db
      .selectFrom("tasks")
      .innerJoin("users", "users.id", "tasks.owner_id")
      .leftJoin("leads", "leads.id", "tasks.lead_id")
      .select([
        "tasks.id as id",
        "tasks.tenant_id as tenant_id",
        "tasks.title as title",
        "tasks.priority as priority",
        "tasks.due_at as due_at",
        "tasks.lead_id as lead_id",
        "tasks.owner_id as owner_id",
        "users.name as owner_name",
        "users.email as owner_email",
        "leads.name as lead_name",
      ])
      .where("tasks.status", "=", "OPEN")
      .where("tasks.remind_daily", "=", true)
      .where((eb) =>
        eb.or([
          eb("tasks.reminder_last_sent_at", "is", null),
          eb("tasks.reminder_last_sent_at", "<", dayStart),
        ])
      )
      .execute();
  }

  // Idempotency stamp written after a reminder email goes out (best-effort).
  async markReminderSent(id: string, at: Date): Promise<void> {
    await db
      .updateTable("tasks")
      .set({ reminder_last_sent_at: at })
      .where("id", "=", id)
      .execute();
  }

  async deleteTask(id: string, tenantId: string): Promise<boolean> {
    const row = await db
      .deleteFrom("tasks")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returning("id")
      .executeTakeFirst();
    return !!row;
  }
}

export default new ActivitiesRepository();
