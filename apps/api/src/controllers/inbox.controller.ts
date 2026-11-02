import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import inboxService from "../services/inbox.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const getInbox = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await inboxService.overview(tenantId, req.query.channel as string | undefined),
  });
};

export const getConversation = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await inboxService.detail(tenantId, String(req.params.id)),
  });
};

export const sendReply = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const message = await inboxService.send(tenantId, actorId, String(req.params.id), req.body ?? {});
  sendSuccessResponse({
    res,
    data: message,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Reply sent",
  });
};

export const simulateInbound = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const message = await inboxService.simulateInbound(tenantId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: message,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Inbound message recorded",
  });
};
