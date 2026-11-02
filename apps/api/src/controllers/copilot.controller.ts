import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import copilotService from "../services/copilot.service";
import { sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listSuggestions = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: copilotService.suggestions() });
};

export const ask = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await copilotService.ask(tenantId, actorId, req.body ?? {}),
  });
};
