import type { priority, reminder_status } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import remindersRepository, { ReminderFilter } from "../repositories/reminders.repository";

const PRIORITIES: priority[] = ["LOW", "MEDIUM", "HIGH"];
const FILTERS: ReminderFilter[] = ["open", "today", "done", "all"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const todayStr = (): string => new Date().toISOString().slice(0, 10);

const parseDueDate = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null;
  const due = String(value);
  if (!DATE_RE.test(due)) throw new BadRequestError("dueDate must be YYYY-MM-DD");
  return due;
};

class RemindersService {
  async list(tenantId: string, userId: string, rawFilter?: string) {
    const filter: ReminderFilter = FILTERS.includes(rawFilter as ReminderFilter)
      ? (rawFilter as ReminderFilter)
      : "all";
    return remindersRepository.listForUser(tenantId, userId, filter, todayStr());
  }

  async count(tenantId: string, userId: string) {
    return remindersRepository.counts(tenantId, userId, todayStr());
  }

  async today(tenantId: string, userId: string) {
    return remindersRepository.listForUser(tenantId, userId, "today", todayStr());
  }

  async create(
    tenantId: string,
    userId: string,
    body: { title?: unknown; note?: unknown; priority?: unknown; dueDate?: unknown }
  ) {
    const title = String(body.title ?? "").trim();
    if (!title) throw new BadRequestError("title is required");

    return remindersRepository.create({
      tenant_id: tenantId,
      user_id: userId,
      title: title.slice(0, 200),
      note: body.note !== undefined && body.note !== null ? String(body.note).slice(0, 1000) : "",
      priority: PRIORITIES.includes(body.priority as priority)
        ? (body.priority as priority)
        : "MEDIUM",
      due_date: parseDueDate(body.dueDate),
    });
  }

  async update(
    tenantId: string,
    userId: string,
    reminderId: string,
    body: {
      title?: unknown;
      note?: unknown;
      priority?: unknown;
      dueDate?: unknown;
      status?: unknown;
    }
  ) {
    const existing = await remindersRepository.findById(reminderId, tenantId, userId);
    if (!existing) throw new NotFoundError("Reminder not found");

    const patch: Partial<{
      title: string;
      note: string | null;
      priority: priority;
      status: reminder_status;
      due_date: string | null;
    }> = {};
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw new BadRequestError("title cannot be empty");
      patch.title = title.slice(0, 200);
    }
    if (body.note !== undefined) {
      patch.note = body.note === null ? "" : String(body.note).slice(0, 1000);
    }
    if (body.priority !== undefined && PRIORITIES.includes(body.priority as priority)) {
      patch.priority = body.priority as priority;
    }
    if (body.dueDate !== undefined) patch.due_date = parseDueDate(body.dueDate);
    if (body.status === "OPEN" || body.status === "DONE") patch.status = body.status;

    const updated = await remindersRepository.update(reminderId, tenantId, userId, patch);
    if (!updated) throw new NotFoundError("Reminder not found");
    return updated;
  }

  async toggle(tenantId: string, userId: string, reminderId: string) {
    const existing = await remindersRepository.findById(reminderId, tenantId, userId);
    if (!existing) throw new NotFoundError("Reminder not found");
    const status: reminder_status = existing.status === "OPEN" ? "DONE" : "OPEN";
    const updated = await remindersRepository.update(reminderId, tenantId, userId, { status });
    if (!updated) throw new NotFoundError("Reminder not found");
    return updated;
  }

  async remove(tenantId: string, userId: string, reminderId: string) {
    const deleted = await remindersRepository.delete(reminderId, tenantId, userId);
    if (!deleted) throw new NotFoundError("Reminder not found");
    return { ok: true };
  }
}

export default new RemindersService();
