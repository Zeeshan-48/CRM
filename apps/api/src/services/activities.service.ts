import { db } from "../db/connection";
import {
  activity_type,
  message_direction,
  priority as priorityEnum,
  task_status,
} from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import { assertCanManageRecord } from "../utils/record-policy";
import activitiesRepository, { ActivitiesListParams } from "../repositories/activities.repository";
import leadsRepository from "../repositories/leads.repository";
import engineService from "./engine.service";
import scoringService from "./scoring.service";

const ACTIVITY_TYPES = Object.values(activity_type);
const DIRECTIONS = Object.values(message_direction);
const PRIORITIES = Object.values(priorityEnum);
const TASK_STATUSES = Object.values(task_status);

const parseDate = (value: unknown, field: string): Date => {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${field} must be a valid date`);
  return date;
};

const daysAhead = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

class ActivitiesService {
  async list(
    tenantId: string,
    params: {
      type?: string;
      leadId?: string;
      contactId?: string;
      dealId?: string;
      owner?: string;
      includeAi?: boolean;
      limit?: number;
    }
  ) {
    if (params.type && !(ACTIVITY_TYPES as readonly string[]).includes(params.type)) {
      throw new BadRequestError(`type must be one of ${ACTIVITY_TYPES.join(", ")}`);
    }
    return activitiesRepository.list(tenantId, params as ActivitiesListParams);
  }

  // True total for the activities feed's summary stat (unbounded by the list's
  // page limit). Honours the same type/owner filters as the feed.
  async count(
    tenantId: string,
    params: {
      type?: string;
      leadId?: string;
      contactId?: string;
      dealId?: string;
      owner?: string;
      includeAi?: boolean;
    }
  ) {
    if (params.type && !(ACTIVITY_TYPES as readonly string[]).includes(params.type)) {
      throw new BadRequestError(`type must be one of ${ACTIVITY_TYPES.join(", ")}`);
    }
    return { total: await activitiesRepository.count(tenantId, params as ActivitiesListParams) };
  }

  async log(
    tenantId: string,
    actorId: string,
    body: {
      type?: string;
      direction?: string;
      subject?: string;
      notes?: string;
      owner_id?: string;
      lead_id?: string;
      contact_id?: string;
      deal_id?: string;
      duration_sec?: number;
    }
  ) {
    if (!body.type || !(ACTIVITY_TYPES as readonly string[]).includes(body.type)) {
      throw new BadRequestError(`type must be one of ${ACTIVITY_TYPES.join(", ")}`);
    }
    let direction: message_direction = "OUTBOUND";
    if (body.direction !== undefined) {
      if (!(DIRECTIONS as readonly string[]).includes(body.direction)) {
        throw new BadRequestError(`direction must be one of ${DIRECTIONS.join(", ")}`);
      }
      direction = body.direction as message_direction;
    }

    const durationSec =
      body.duration_sec !== undefined &&
      body.duration_sec !== null &&
      Number.isFinite(Number(body.duration_sec))
        ? Math.floor(Number(body.duration_sec))
        : null;

    const activity = await activitiesRepository.create({
      tenant_id: tenantId,
      type: body.type as activity_type,
      direction,
      subject: body.subject || body.type,
      notes: body.notes ?? "",
      owner_id: body.owner_id ?? actorId,
      lead_id: body.lead_id ?? null,
      contact_id: body.contact_id ?? null,
      deal_id: body.deal_id ?? null,
      duration_sec: durationSec,
    });

    const now = new Date();
    if (activity.lead_id) {
      await leadsRepository.update(activity.lead_id, tenantId, { last_activity_at: now });
      scoringService.recomputeInBackground(tenantId, activity.lead_id);
    }
    if (activity.contact_id) {
      await db
        .updateTable("contacts")
        .set({ last_activity_at: now, updated_at: now })
        .where("id", "=", activity.contact_id)
        .where("tenant_id", "=", tenantId)
        .execute();
    }

    engineService.audit(tenantId, actorId, "activity.logged", "activity", activity.id, {
      type: activity.type,
    });
    return activity;
  }

  async listTasks(
    tenantId: string,
    actorId: string,
    params: { status?: string; mine?: boolean; includeAi?: boolean }
  ) {
    if (params.status && !(TASK_STATUSES as readonly string[]).includes(params.status)) {
      throw new BadRequestError(`status must be one of ${TASK_STATUSES.join(", ")}`);
    }
    return activitiesRepository.listTasks(tenantId, {
      status: params.status as task_status | undefined,
      owner: params.mine ? actorId : undefined,
      includeAi: params.includeAi,
    });
  }

  async createTask(
    tenantId: string,
    actorId: string,
    body: {
      title?: string;
      priority?: string;
      due_at?: string;
      owner_id?: string;
      lead_id?: string;
      contact_id?: string;
      deal_id?: string;
      remind_daily?: boolean;
    }
  ) {
    if (!body.title) throw new BadRequestError("title is required");

    let priority: priorityEnum = "MEDIUM";
    if (body.priority !== undefined) {
      if (!(PRIORITIES as readonly string[]).includes(body.priority)) {
        throw new BadRequestError(`priority must be one of ${PRIORITIES.join(", ")}`);
      }
      priority = body.priority as priorityEnum;
    }

    const dueAt =
      body.due_at !== undefined && body.due_at !== null
        ? parseDate(body.due_at, "due_at")
        : daysAhead(1);

    const task = await activitiesRepository.createTask({
      tenant_id: tenantId,
      title: body.title,
      priority,
      due_at: dueAt,
      owner_id: body.owner_id ?? actorId,
      lead_id: body.lead_id ?? null,
      contact_id: body.contact_id ?? null,
      deal_id: body.deal_id ?? null,
      remind_daily: body.remind_daily === true,
    });

    engineService.audit(tenantId, actorId, "task.created", "task", task.id, {
      title: task.title,
      priority: task.priority,
    });
    return task;
  }

  async completeTask(tenantId: string, actorId: string, taskId: string) {
    const task = await activitiesRepository.findTaskById(taskId, tenantId);
    if (!task) throw new NotFoundError("Task not found");

    const updated = await activitiesRepository.completeTask(taskId, tenantId);
    if (!updated) throw new NotFoundError("Task not found");

    engineService.audit(tenantId, actorId, "task.completed", "task", taskId, {
      title: updated.title,
    });
    return updated;
  }

  async updateActivity(
    tenantId: string,
    actorId: string,
    activityId: string,
    body: {
      type?: string;
      direction?: string;
      subject?: string;
      notes?: string;
      owner_id?: string;
      duration_sec?: number;
    }
  ) {
    const existing = await activitiesRepository.findActivityById(activityId, tenantId);
    if (!existing) throw new NotFoundError("Activity not found");

    const patch: {
      type?: activity_type;
      direction?: message_direction;
      subject?: string;
      notes?: string;
      owner_id?: string;
      duration_sec?: number | null;
    } = {};

    if (body.type !== undefined) {
      if (!(ACTIVITY_TYPES as readonly string[]).includes(body.type)) {
        throw new BadRequestError(`type must be one of ${ACTIVITY_TYPES.join(", ")}`);
      }
      patch.type = body.type as activity_type;
    }
    if (body.direction !== undefined) {
      if (!(DIRECTIONS as readonly string[]).includes(body.direction)) {
        throw new BadRequestError(`direction must be one of ${DIRECTIONS.join(", ")}`);
      }
      patch.direction = body.direction as message_direction;
    }
    if (body.subject !== undefined) patch.subject = body.subject;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.owner_id !== undefined) patch.owner_id = body.owner_id;
    if (body.duration_sec !== undefined) {
      patch.duration_sec =
        body.duration_sec !== null && Number.isFinite(Number(body.duration_sec))
          ? Math.floor(Number(body.duration_sec))
          : null;
    }

    const updated = await activitiesRepository.updateActivity(activityId, tenantId, patch);
    if (!updated) throw new NotFoundError("Activity not found");

    // Notes/type feed lead scoring, recompute if this activity is on a lead.
    if (updated.lead_id) scoringService.recomputeInBackground(tenantId, updated.lead_id);

    engineService.audit(tenantId, actorId, "activity.updated", "activity", activityId, {
      type: updated.type,
    });
    return updated;
  }

  async removeActivity(tenantId: string, actorId: string, actorRole: string, activityId: string) {
    const existing = await activitiesRepository.findActivityById(activityId, tenantId);
    if (!existing) throw new NotFoundError("Activity not found");
    assertCanManageRecord(actorId, actorRole, existing.owner_id, "delete", "activity");

    const deleted = await activitiesRepository.deleteActivity(activityId, tenantId);
    if (!deleted) throw new NotFoundError("Activity not found");

    if (existing.lead_id) scoringService.recomputeInBackground(tenantId, existing.lead_id);

    engineService.audit(tenantId, actorId, "activity.deleted", "activity", activityId, {
      type: existing.type,
    });
    return { ok: true };
  }

  async updateTask(
    tenantId: string,
    actorId: string,
    taskId: string,
    body: {
      title?: string;
      priority?: string;
      status?: string;
      due_at?: string | null;
      owner_id?: string;
      remind_daily?: boolean;
    }
  ) {
    const existing = await activitiesRepository.findTaskById(taskId, tenantId);
    if (!existing) throw new NotFoundError("Task not found");

    const patch: {
      title?: string;
      priority?: priorityEnum;
      status?: task_status;
      due_at?: Date | null;
      completed_at?: Date | null;
      owner_id?: string;
      remind_daily?: boolean;
    } = {};

    if (body.title !== undefined) {
      if (!body.title.trim()) throw new BadRequestError("title cannot be empty");
      patch.title = body.title;
    }
    if (body.priority !== undefined) {
      if (!(PRIORITIES as readonly string[]).includes(body.priority)) {
        throw new BadRequestError(`priority must be one of ${PRIORITIES.join(", ")}`);
      }
      patch.priority = body.priority as priorityEnum;
    }
    if (body.status !== undefined) {
      if (!(TASK_STATUSES as readonly string[]).includes(body.status)) {
        throw new BadRequestError(`status must be one of ${TASK_STATUSES.join(", ")}`);
      }
      patch.status = body.status as task_status;
      // Keep completed_at in sync with the status.
      patch.completed_at = body.status === "DONE" ? new Date() : null;
    }
    if (body.due_at !== undefined) {
      patch.due_at = body.due_at === null || body.due_at === "" ? null : parseDate(body.due_at, "due_at");
    }
    if (body.owner_id !== undefined) patch.owner_id = body.owner_id;
    if (body.remind_daily !== undefined) patch.remind_daily = body.remind_daily === true;

    const updated = await activitiesRepository.updateTask(taskId, tenantId, patch);
    if (!updated) throw new NotFoundError("Task not found");

    engineService.audit(tenantId, actorId, "task.updated", "task", taskId, {
      title: updated.title,
    });
    return updated;
  }

  async removeTask(tenantId: string, actorId: string, actorRole: string, taskId: string) {
    const existing = await activitiesRepository.findTaskById(taskId, tenantId);
    if (!existing) throw new NotFoundError("Task not found");
    assertCanManageRecord(actorId, actorRole, existing.owner_id, "delete", "task");

    const deleted = await activitiesRepository.deleteTask(taskId, tenantId);
    if (!deleted) throw new NotFoundError("Task not found");

    engineService.audit(tenantId, actorId, "task.deleted", "task", taskId, {
      title: existing.title,
    });
    return { ok: true };
  }
}

export default new ActivitiesService();
