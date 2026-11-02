import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import remindersService from "../services/reminders.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listReminders = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await remindersService.list(tenantId, actorId, req.query.filter as string | undefined),
  });
};

export const getReminderCount = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({ res, data: await remindersService.count(tenantId, actorId) });
};

export const listTodayReminders = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({ res, data: await remindersService.today(tenantId, actorId) });
};

export const createReminder = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await remindersService.create(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Reminder created",
  });
};

export const updateReminder = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await remindersService.update(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Reminder updated",
  });
};

export const toggleReminder = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await remindersService.toggle(tenantId, actorId, String(req.params.id)),
  });
};

export const deleteReminder = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await remindersService.remove(tenantId, actorId, String(req.params.id)),
    message: "Reminder deleted",
  });
};
