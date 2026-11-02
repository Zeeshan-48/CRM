import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import whatsappConfigService from "../services/whatsapp-config.service";
import whatsappService from "../services/whatsapp.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

// ---- BYO WhatsApp connection (Meta Cloud API) ----
export const getWhatsappConfig = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await whatsappConfigService.getConfig(tenantId) });
};

// Meta Embedded Signup, exchange the popup's OAuth code + ids for a connected
// account. Body: { code, wabaId, phoneNumberId, businessId }.
export const exchangeEmbeddedSignup = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await whatsappConfigService.onboardEmbedded(tenantId, actorId, req.body ?? {}),
    message: "WhatsApp connected",
  });
};

export const validateWhatsappConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await whatsappConfigService.validate(tenantId, actorId),
    message: "Validation checked",
  });
};

export const removeWhatsappConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await whatsappConfigService.remove(tenantId, actorId),
    message: "WhatsApp disconnected",
  });
};

export const listTemplates = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await whatsappService.listTemplates(tenantId) });
};

export const createTemplate = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const template = await whatsappService.createTemplate(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: template,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Template created",
  });
};

export const syncTemplates = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await whatsappService.syncTemplates(tenantId, actorId),
    message: "Templates synced from Meta",
  });
};

export const deleteTemplate = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await whatsappService.deleteTemplate(tenantId, actorId, String(req.params.id)),
    message: "Template deleted",
  });
};

export const sendWhatsapp = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const message = await whatsappService.send(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: message,
    statusCode: HttpSuccessStatus.CREATED,
    message: "WhatsApp message sent",
  });
};

export const broadcastCampaign = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await whatsappService.broadcast(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Broadcast sent",
  });
};

export const agentReply = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await whatsappService.agentReply(tenantId, req.body ?? {}) });
};
