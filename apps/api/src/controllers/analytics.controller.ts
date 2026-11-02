import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import analyticsService from "../services/analytics.service";
import dealLineItemsService from "../services/deal-line-items.service";
import { sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const getOverview = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await analyticsService.overview(tenantId) });
};

export const getSales = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await analyticsService.sales(tenantId) });
};

export const getMarketing = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await analyticsService.marketing(tenantId) });
};

export const getSupport = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await analyticsService.support(tenantId) });
};

export const getPredictive = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await analyticsService.predictive(tenantId) });
};

export const getConversationIntelligence = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await analyticsService.conversationIntelligence(tenantId) });
};

// Revenue attributed to catalog products across won deals. Only meaningful once
// deals carry line items; returns an empty list otherwise rather than erroring.
export const getProductRevenue = async (req: Request, res: Response) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  const days = Number(req.query.days);
  sendSuccessResponse({
    res,
    data: await dealLineItemsService.revenueByProduct(
      user.tenantId,
      Number.isFinite(days) ? days : undefined
    ),
  });
};
