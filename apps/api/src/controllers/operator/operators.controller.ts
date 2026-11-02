import { Request, Response } from "express";
import { UnauthorizedError } from "../../errors";
import operatorsService from "../../services/operator/operators.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../../utils/response.util";

const actor = (req: Request) => {
  const operator = req.operatorUser;
  if (!operator) throw new UnauthorizedError("Authentication required");
  return { id: operator.id, email: operator.email };
};

export const listOperators = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await operatorsService.list() });
};

export const createOperator = async (req: Request, res: Response) => {
  const created = await operatorsService.create(actor(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: created,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Operator created",
  });
};

export const updateOperator = async (req: Request, res: Response) => {
  const updated = await operatorsService.update(actor(req), String(req.params.id), req.body ?? {});
  sendSuccessResponse({ res, data: updated, message: "Operator updated" });
};
