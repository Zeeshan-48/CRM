import { Request, Response } from "express";
import billingService from "../../services/operator/billing.service";
import { sendSuccessResponse } from "../../utils/response.util";

export const billingMetrics = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await billingService.metrics() });
};
