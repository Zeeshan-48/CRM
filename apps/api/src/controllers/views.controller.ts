import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import viewsService from "../services/views.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listViews = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await viewsService.list(tenantId, actorId, req.query.resource as string | undefined),
  });
};

export const createView = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await viewsService.create(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "View saved",
  });
};

export const deleteView = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await viewsService.remove(tenantId, actorId, String(req.params.id)),
    message: "View deleted",
  });
};
