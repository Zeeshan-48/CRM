import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import kbService from "../services/kb.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listArticles = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await kbService.list(tenantId, req.query.status as string | undefined),
  });
};

export const searchArticles = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await kbService.search(tenantId, req.body ?? {}) });
};

export const getArticle = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await kbService.detail(tenantId, String(req.params.id)) });
};

export const createArticle = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const article = await kbService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: article,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Article created",
  });
};
