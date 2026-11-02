import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import searchService from "../services/search.service";
import { sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const globalSearch = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await searchService.search(tenantId, req.query.q) });
};
