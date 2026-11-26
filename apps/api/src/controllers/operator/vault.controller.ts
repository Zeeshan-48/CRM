import { Request, Response } from "express";
import { BadRequestError, UnauthorizedError } from "../../errors";
import { getRequestBaseUrl } from "../../services/storage.service";
import vaultService from "../../services/operator/vault.service";
import { sendSuccessResponse } from "../../utils/response.util";

const actor = (req: Request) => {
  const operator = req.operatorUser;
  if (!operator) throw new UnauthorizedError("Authentication required");
  return { id: operator.id, email: operator.email };
};

export const getVaultSummary = async (req: Request, res: Response) => {
  const tenantId = (req.query.tenantId || req.query.tenant_id) as string | undefined;
  const summary = await vaultService.summary(tenantId);
  sendSuccessResponse({ res, data: summary });
};

export const getVaultData = async (req: Request, res: Response) => {
  const tenantId = (req.query.tenantId || req.query.tenant_id) as string | undefined;
  const entity = (req.query.entity as string) || "leads";
  const filter = (req.query.filter as "all" | "active" | "deleted") || "all";
  const q = req.query.q as string | undefined;
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  const result = await vaultService.getData({
    tenantId,
    entity,
    filter,
    q,
    page,
    limit,
    baseUrl: getRequestBaseUrl(req),
  });

  sendSuccessResponse({ res, data: result });
};

export const restoreVaultItem = async (req: Request, res: Response) => {
  const tenantId = req.body?.tenantId || req.body?.tenant_id;
  const entity = req.body?.entity;
  const id = req.body?.id;
  if (!tenantId || !entity || !id) {
    throw new BadRequestError("tenantId, entity, and id are required");
  }
  const result = await vaultService.restoreItem(actor(req), tenantId, entity, id);
  sendSuccessResponse({ res, data: result, message: result.message });
};

export const purgeVaultItem = async (req: Request, res: Response) => {
  const tenantId = req.body?.tenantId || req.body?.tenant_id;
  const entity = req.body?.entity;
  const id = req.body?.id;
  if (!tenantId || !entity || !id) {
    throw new BadRequestError("tenantId, entity, and id are required");
  }
  const result = await vaultService.purgeItem(actor(req), tenantId, entity, id);
  sendSuccessResponse({ res, data: result, message: result.message });
};

