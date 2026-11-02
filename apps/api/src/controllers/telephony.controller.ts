import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import telephonyService from "../services/telephony.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const getConfig = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await telephonyService.getConfig(tenantId) });
};

export const saveConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.saveConfig(tenantId, actorId, req.body ?? {}),
    message: "Telephony credentials saved",
  });
};

export const validateConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.validate(tenantId, actorId),
    message: "Validation checked",
  });
};

export const removeConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.remove(tenantId, actorId),
    message: "Telephony credentials removed",
  });
};

export const placeCall = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.placeCall(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Call placed",
  });
};

export const listCalls = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await telephonyService.listCalls(tenantId) });
};

// An agent logs a call they dialed from their personal SIM (no recording).
export const logManualCall = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.logManualCall(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Call logged",
  });
};

// Short-lived playable URL for a call recording (JSON, not a stream: the audio
// element cannot send a JWT, so the client fetches this and sets src).
export const getRecordingUrl = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.recordingUrl(tenantId, String(req.params.id)),
  });
};

// ---- ExoPhone pool ----

export const listNumbers = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await telephonyService.listNumbers(tenantId) });
};

export const addNumber = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.addNumber(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Number added",
  });
};

export const updateNumber = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.updateNumber(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Number updated",
  });
};

export const removeNumber = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await telephonyService.removeNumber(tenantId, actorId, String(req.params.id)),
    message: "Number removed",
  });
};

// Self-service presence toggle: inbound routing skips unavailable agents.
export const setAvailability = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const available = (req.body ?? {}).available !== false;
  sendSuccessResponse({
    res,
    data: await telephonyService.setAvailability(tenantId, actorId, available),
    message: available ? "You are available for calls" : "You are unavailable for calls",
  });
};
