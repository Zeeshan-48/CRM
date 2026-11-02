import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import emailIdentitiesService from "../services/email-identities.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listIdentities = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await emailIdentitiesService.list(tenantId) });
};

export const createIdentity = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const identity = await emailIdentitiesService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: identity,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Sender added",
  });
};

export const updateIdentity = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const identity = await emailIdentitiesService.update(
    tenantId,
    actorId,
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({ res, data: identity, message: "Sender updated" });
};

export const deleteIdentity = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await emailIdentitiesService.remove(tenantId, actorId, String(req.params.id)),
    message: "Sender removed",
  });
};
