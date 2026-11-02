import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import emailService from "../services/email.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listTemplates = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailService.templates(tenantId) });
};

export const createTemplate = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const template = await emailService.createTemplate(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: template,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Template created",
  });
};

export const updateTemplate = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const template = await emailService.updateTemplate(
    tenantId,
    actorId,
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({ res, data: template, message: "Template updated" });
};

export const deleteTemplate = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await emailService.deleteTemplate(tenantId, actorId, String(req.params.id));
  sendSuccessResponse({ res, data: result, message: "Template deleted" });
};

export const writeDraft = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailService.write(tenantId, req.body ?? {}) });
};

export const listDraftTypes = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailService.listDraftTypes(tenantId) });
};

export const addDraftType = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const created = await emailService.addDraftType(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: created,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Draft type added",
  });
};

export const deleteDraftType = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await emailService.removeDraftType(tenantId, actorId, String(req.params.key));
  sendSuccessResponse({ res, data: result, message: "Draft type removed" });
};

export const restoreDraftType = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await emailService.restoreDraftType(tenantId, actorId, String(req.params.key));
  sendSuccessResponse({ res, data: result, message: "Draft type restored" });
};

export const sendEmail = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const message = await emailService.send(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: message,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Email sent",
  });
};

export const getMetrics = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailService.metrics(tenantId) });
};
