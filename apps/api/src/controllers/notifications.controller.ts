import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import notificationsService from "../services/notifications.service";
import { sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listNotifications = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({ res, data: await notificationsService.list(tenantId, actorId) });
};

export const markNotificationRead = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await notificationsService.markRead(tenantId, actorId, String(req.params.id)),
  });
};

export const markAllNotificationsRead = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({ res, data: await notificationsService.markAllRead(tenantId, actorId) });
};
