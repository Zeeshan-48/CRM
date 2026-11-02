import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import dealLineItemsService from "../services/deal-line-items.service";
import dealsService from "../services/deals.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, actorRole: user.role };
};

export const listPipelines = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await dealsService.listPipelines(tenantId) });
};

export const createPipeline = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const pipeline = await dealsService.createPipeline(tenantId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: pipeline,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Pipeline created",
  });
};

export const getBoard = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealsService.board(tenantId, req.query.pipelineId as string | undefined),
  });
};

export const getForecast = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await dealsService.forecast(tenantId) });
};

export const getDeal = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await dealsService.detail(tenantId, String(req.params.id)) });
};

export const createDeal = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const deal = await dealsService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: deal,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Deal created",
  });
};

export const updateDeal = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealsService.update(tenantId, String(req.params.id), req.body ?? {}),
    message: "Deal updated",
  });
};

export const deleteDeal = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealsService.remove(tenantId, actorId, actorRole, String(req.params.id)),
    message: "Deal deleted",
  });
};

export const moveDeal = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealsService.move(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Deal moved",
  });
};

export const winDeal = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealsService.win(tenantId, actorId, String(req.params.id)),
    message: "Deal won",
  });
};

export const loseDeal = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealsService.lost(tenantId, actorId, String(req.params.id), req.body?.reason),
    message: "Deal lost",
  });
};

export const getCoach = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await dealsService.coach(tenantId, String(req.params.id)) });
};

export const getInsight = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await dealsService.insight(tenantId, String(req.params.id)) });
};

// ---- Line items (products on the deal) ----

export const listDealLineItems = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealLineItemsService.list(tenantId, String(req.params.id)),
  });
};

export const addDealLineItem = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealLineItemsService.add(tenantId, actorId, String(req.params.id), req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Product added to deal",
  });
};

export const updateDealLineItem = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealLineItemsService.update(
      tenantId,
      actorId,
      String(req.params.id),
      String(req.params.itemId),
      req.body ?? {}
    ),
    message: "Line item updated",
  });
};

export const deleteDealLineItem = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await dealLineItemsService.remove(
      tenantId,
      actorId,
      String(req.params.id),
      String(req.params.itemId)
    ),
    message: "Line item removed",
  });
};
