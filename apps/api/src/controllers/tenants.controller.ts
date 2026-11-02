import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import tenantsService from "../services/tenants.service";
import { sendSuccessResponse } from "../utils/response.util";

export const getMyTenant = async (req: Request, res: Response) => {
  if (!req.tenantId) throw new ForbiddenError("Tenant context required");
  sendSuccessResponse({ res, data: await tenantsService.me(req.tenantId) });
};

export const updateMyTenant = async (req: Request, res: Response) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  const { name, brand_color, domain, email_domain, white_label, config } = req.body ?? {};
  const updated = await tenantsService.update(user.tenantId, user.id, {
    name,
    brand_color,
    domain,
    email_domain,
    white_label,
    config,
  });
  sendSuccessResponse({ res, data: updated, message: "Workspace updated" });
};

export const listPlans = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await tenantsService.plans() });
};
