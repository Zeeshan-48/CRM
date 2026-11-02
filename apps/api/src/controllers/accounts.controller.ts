import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import accountsService from "../services/accounts.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, actorRole: user.role };
};

export const listAccounts = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await accountsService.list(tenantId) });
};

export const getAccount = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await accountsService.detail(tenantId, String(req.params.id)),
  });
};

export const createAccount = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const account = await accountsService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: account,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Account created",
  });
};

export const updateAccount = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await accountsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Account updated",
  });
};

export const deleteAccount = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await accountsService.remove(tenantId, actorId, actorRole, String(req.params.id)),
    message: "Account deleted",
  });
};

export const addContract = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const contract = await accountsService.addContract(
    tenantId,
    actorId,
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({
    res,
    data: contract,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Contract added",
  });
};

export const updateContract = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await accountsService.updateContract(
      tenantId,
      actorId,
      String(req.params.id),
      String(req.params.contractId),
      req.body ?? {}
    ),
    message: "Contract updated",
  });
};

export const deleteContract = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await accountsService.removeContract(
      tenantId,
      actorId,
      String(req.params.id),
      String(req.params.contractId)
    ),
    message: "Contract deleted",
  });
};
