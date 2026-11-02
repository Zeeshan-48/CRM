import { Request, Response } from "express";
import auditService from "../../services/operator/audit.service";
import { sendSuccessResponse } from "../../utils/response.util";

export const listAudit = async (req: Request, res: Response) => {
  const rows = await auditService.list({
    action: req.query.action as string | undefined,
    tenantId: req.query.tenantId as string | undefined,
  });
  sendSuccessResponse({ res, data: rows });
};
