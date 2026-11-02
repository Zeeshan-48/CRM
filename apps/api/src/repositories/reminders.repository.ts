import { Selectable, Transaction, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { priority, reminder_status } from "../db/enums";
import type { DB, reminders } from "../db/types";

export type ReminderRow = Selectable<reminders>;

export type ReminderFilter = "open" | "today" | "done" | "all";

class RemindersRepository {
  async listForUser(
    tenantId: string,
    userId: string,
    filter: ReminderFilter,
    today: string
  ): Promise<ReminderRow[]> {
    let qb = db
      .selectFrom("reminders")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId);
    if (filter === "open") qb = qb.where("status", "=", "OPEN");
    if (filter === "done") qb = qb.where("status", "=", "DONE");
    if (filter === "today") {
      qb = qb
        .where("status", "=", "OPEN")
        .where("due_date", "is not", null)
        .where("due_date", "<=", today);
    }
    // Open first, earliest due date next (no due date sinks), newest last.
    return qb
      .orderBy(sql`case when status = 'OPEN' then 0 else 1 end`, "asc")
      .orderBy(sql`coalesce(due_date, '9999-12-31')`, "asc")
      .orderBy("created_at", "desc")
      .execute();
  }

  async counts(tenantId: string, userId: string, today: string) {
    const [openRow, dueTodayRow] = await Promise.all([
      db
        .selectFrom("reminders")
        .select(db.fn.count<number>("id").as("n"))
        .where("tenant_id", "=", tenantId)
        .where("user_id", "=", userId)
        .where("status", "=", "OPEN")
        .executeTakeFirst(),
      db
        .selectFrom("reminders")
        .select(db.fn.count<number>("id").as("n"))
        .where("tenant_id", "=", tenantId)
        .where("user_id", "=", userId)
        .where("status", "=", "OPEN")
        .where("due_date", "is not", null)
        .where("due_date", "<=", today)
        .executeTakeFirst(),
    ]);
    return { open: Number(openRow?.n ?? 0), dueToday: Number(dueTodayRow?.n ?? 0) };
  }

  async findById(
    id: string,
    tenantId: string,
    userId: string
  ): Promise<ReminderRow | undefined> {
    return db
      .selectFrom("reminders")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  async create(
    data: {
      tenant_id: string;
      user_id: string;
      title: string;
      note: string | null;
      priority: priority;
      due_date: string | null;
    },
    trx?: Transaction<DB>
  ): Promise<ReminderRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("reminders")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        user_id: data.user_id,
        title: data.title,
        note: data.note,
        priority: data.priority,
        status: "OPEN",
        due_date: data.due_date,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    userId: string,
    data: Partial<{
      title: string;
      note: string | null;
      priority: priority;
      status: reminder_status;
      due_date: string | null;
    }>
  ): Promise<ReminderRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.note !== undefined) patch.note = data.note;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.status !== undefined) patch.status = data.status;
    if (data.due_date !== undefined) patch.due_date = data.due_date;
    return db
      .updateTable("reminders")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string, userId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("reminders")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }
}

export default new RemindersRepository();
