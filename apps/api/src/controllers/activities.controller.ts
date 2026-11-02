import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import activitiesService from "../services/activities.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, actorRole: user.role };
};

// AI visibility filter. Absent → undefined (include everything, current default
// for every existing caller). Only an explicit "0"/"false" hides AI rows, this
// is what the Activities feed sends when its "Show AI activity" toggle is off.
const parseIncludeAi = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  return !(value === "0" || value === "false");
};

export const listActivities = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const result = await activitiesService.list(tenantId, {
    type: req.query.type as string | undefined,
    leadId: req.query.leadId as string | undefined,
    contactId: req.query.contactId as string | undefined,
    dealId: req.query.dealId as string | undefined,
    owner: req.query.owner as string | undefined,
    includeAi: parseIncludeAi(req.query.includeAi),
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  });
  sendSuccessResponse({ res, data: result });
};

export const countActivities = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const data = await activitiesService.count(tenantId, {
    type: req.query.type as string | undefined,
    leadId: req.query.leadId as string | undefined,
    contactId: req.query.contactId as string | undefined,
    dealId: req.query.dealId as string | undefined,
    owner: req.query.owner as string | undefined,
    includeAi: parseIncludeAi(req.query.includeAi),
  });
  sendSuccessResponse({ res, data });
};

export const logActivity = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const activity = await activitiesService.log(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: activity,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Activity logged",
  });
};

export const listTasks = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const tasks = await activitiesService.listTasks(tenantId, actorId, {
    status: req.query.status as string | undefined,
    mine: !!req.query.mine,
    includeAi: parseIncludeAi(req.query.includeAi),
  });
  sendSuccessResponse({ res, data: tasks });
};

export const createTask = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const task = await activitiesService.createTask(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: task,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Task created",
  });
};

export const completeTask = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const task = await activitiesService.completeTask(tenantId, actorId, String(req.params.id));
  sendSuccessResponse({ res, data: task, message: "Task completed" });
};

export const updateActivity = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await activitiesService.updateActivity(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Activity updated",
  });
};

export const deleteActivity = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await activitiesService.removeActivity(tenantId, actorId, actorRole, String(req.params.id)),
    message: "Activity deleted",
  });
};

export const updateTask = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await activitiesService.updateTask(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Task updated",
  });
};

export const deleteTask = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await activitiesService.removeTask(tenantId, actorId, actorRole, String(req.params.id)),
    message: "Task deleted",
  });
};
