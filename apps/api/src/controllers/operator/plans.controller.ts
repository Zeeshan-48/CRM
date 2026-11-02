import { Request, Response } from "express";
import { UnauthorizedError } from "../../errors";
import plansService from "../../services/operator/plans.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../../utils/response.util";

const actor = (req: Request) => {
  const operator = req.operatorUser;
  if (!operator) throw new UnauthorizedError("Authentication required");
  return { id: operator.id, email: operator.email };
};

export const listPlans = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await plansService.list() });
};

export const createPlan = async (req: Request, res: Response) => {
  const created = await plansService.create(actor(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: created,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Plan created",
  });
};

export const updatePlan = async (req: Request, res: Response) => {
  const updated = await plansService.update(actor(req), String(req.params.id), req.body ?? {});
  sendSuccessResponse({ res, data: updated, message: "Plan updated" });
};
