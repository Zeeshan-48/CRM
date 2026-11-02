import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import emailMessagesRepository from "../repositories/email-messages.repository";
import emailReputationRepository from "../repositories/email-reputation.repository";
import emailSuppressionsService from "../services/email-suppressions.service";
import reputationService from "../services/reputation.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listMessages = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailMessagesRepository.listByTenant(tenantId) });
};

export const getReputation = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const [state, rates, events] = await Promise.all([
    emailReputationRepository.getTenantState(tenantId),
    reputationService.getRates(tenantId),
    emailReputationRepository.listByTenant(tenantId),
  ]);
  sendSuccessResponse({
    res,
    data: {
      status: state?.email_sending_status ?? "ACTIVE",
      statusChangedAt: state?.email_sending_status_changed_at ?? null,
      rates,
      events,
    },
  });
};

export const listSuppressions = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailSuppressionsService.list(tenantId) });
};

export const addSuppression = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await emailSuppressionsService.add(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Suppression added",
  });
};

export const removeSuppression = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await emailSuppressionsService.remove(tenantId, actorId, String(req.params.id)),
    message: "Suppression removed",
  });
};
