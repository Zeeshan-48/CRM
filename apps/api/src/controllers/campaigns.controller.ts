import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import campaignsService from "../services/campaigns.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listCampaigns = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await campaignsService.list(tenantId) });
};

export const createCampaign = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const campaign = await campaignsService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: campaign,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Campaign created",
  });
};

export const getCampaign = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await campaignsService.detail(tenantId, String(req.params.id)),
  });
};

export const sendCampaign = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await campaignsService.send(tenantId, actorId, String(req.params.id)),
    message: "Campaign sent",
  });
};
