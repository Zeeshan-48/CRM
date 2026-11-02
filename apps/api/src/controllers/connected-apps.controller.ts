import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import connectedAppsService from "../services/connected-apps.service";
import productActionsService from "../services/product-actions.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listApps = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await connectedAppsService.list(tenantId) });
};

export const getApp = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.detail(tenantId, String(req.params.id)),
  });
};

export const createApp = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.create(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Connected product created",
  });
};

export const updateApp = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Connected product updated",
  });
};

export const deleteApp = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.remove(tenantId, actorId, String(req.params.id)),
    message: "Connected product removed",
  });
};

export const createAppKey = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.createKey(
      tenantId,
      actorId,
      String(req.params.id),
      req.body ?? {}
    ),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Key created. Save it now, it will not be shown again.",
  });
};

export const rotateActionsSecret = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.rotateActionsSecret(tenantId, actorId, String(req.params.id)),
    message: "Signing secret rotated",
  });
};

// ---- Event definitions (the registry an admin reviews and tunes) ----

export const listEventDefinitions = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.listEventDefinitions(tenantId, String(req.params.id)),
  });
};

export const updateEventDefinition = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await connectedAppsService.updateEventDefinition(
      tenantId,
      actorId,
      String(req.params.definitionId),
      req.body ?? {}
    ),
    message: "Event updated",
  });
};

// ---- Product actions (CRM -> product) ----

export const listAllActions = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await productActionsService.listAllActions(tenantId) });
};

export const listAppActions = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productActionsService.listActions(tenantId, String(req.params.id)),
  });
};

export const invokeAction = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await productActionsService.invoke(
    tenantId,
    actorId,
    String(req.params.id),
    String(req.params.actionKey),
    (req.body ?? {}) as { params?: Record<string, unknown>; lead_id?: string; contact_id?: string }
  );
  sendSuccessResponse({ res, data: result, message: result.message });
};
