import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import ticketsService from "../services/tickets.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listTickets = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const result = await ticketsService.list(tenantId, {
    status: req.query.status as string | undefined,
    priority: req.query.priority as string | undefined,
    assignee: req.query.assignee as string | undefined,
  });
  sendSuccessResponse({ res, data: result });
};

export const listSlaPolicies = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await ticketsService.slaPolicies(tenantId) });
};

export const getMetrics = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await ticketsService.metrics(tenantId) });
};

export const getTicket = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await ticketsService.detail(tenantId, String(req.params.id)) });
};

export const createTicket = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const ticket = await ticketsService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: ticket,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Ticket created",
  });
};

export const updateTicket = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await ticketsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Ticket updated",
  });
};

export const deleteTicket = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await ticketsService.remove(tenantId, actorId, String(req.params.id)),
    message: "Ticket deleted",
  });
};

export const escalateTicket = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await ticketsService.escalate(tenantId, actorId, String(req.params.id)),
    message: "Ticket escalated",
  });
};

export const replyTicket = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await ticketsService.reply(
    tenantId,
    actorId,
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Reply added",
  });
};

export const aiResolveTicket = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await ticketsService.aiResolve(tenantId, actorId, String(req.params.id)),
  });
};
