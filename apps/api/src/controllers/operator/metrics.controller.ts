import { Request, Response } from "express";
import metricsService from "../../services/operator/metrics.service";
import { sendSuccessResponse } from "../../utils/response.util";

export const overview = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await metricsService.overview() });
};
