import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import auditService from "../services/audit.service";
import { sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listAuditLogs = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await auditService.list(tenantId, {
      action: req.query.action as string | undefined,
      entityType: req.query.entityType as string | undefined,
    }),
  });
};

export const getCompliance = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await auditService.compliance(tenantId) });
};
