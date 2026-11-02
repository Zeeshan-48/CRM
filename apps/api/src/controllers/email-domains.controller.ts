import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import emailDomainsService from "../services/email-domains.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listDomains = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailDomainsService.list(tenantId) });
};

export const getDomain = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailDomainsService.get(tenantId, String(req.params.id)) });
};

export const onboardDomain = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const domain = await emailDomainsService.onboard(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: domain,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Sending domain created",
  });
};

export const checkDomain = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const domain = await emailDomainsService.check(tenantId, actorId, String(req.params.id));
  sendSuccessResponse({ res, data: domain, message: "Verification checked" });
};

export const getDomainHealth = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailDomainsService.health(tenantId, String(req.params.id)) });
};

export const deleteDomain = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await emailDomainsService.remove(tenantId, actorId, String(req.params.id)),
    message: "Sending domain removed",
  });
};
