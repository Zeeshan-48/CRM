import { Request, Response } from "express";
import { UnauthorizedError } from "../../errors";
import billingService from "../../services/operator/billing.service";
import tenantsService from "../../services/operator/tenants.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../../utils/response.util";

const actor = (req: Request) => {
  const operator = req.operatorUser;
  if (!operator) throw new UnauthorizedError("Authentication required");
  return { id: operator.id, email: operator.email };
};

export const listTenants = async (req: Request, res: Response) => {
  const result = await tenantsService.list({
    q: req.query.q as string | undefined,
    status: req.query.status as string | undefined,
  });
  sendSuccessResponse({ res, data: result });
};

export const getTenant = async (req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await tenantsService.detail(String(req.params.id)) });
};

export const createTenant = async (req: Request, res: Response) => {
  const result = await tenantsService.onboard(actor(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Tenant onboarded",
  });
};

export const updateTenant = async (req: Request, res: Response) => {
  const updated = await tenantsService.update(actor(req), String(req.params.id), req.body ?? {});
  sendSuccessResponse({ res, data: updated, message: "Tenant updated" });
};

export const overrideEntitlement = async (req: Request, res: Response) => {
  const row = await tenantsService.overrideEntitlement(
    actor(req),
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({ res, data: row, message: "Entitlement updated" });
};

// --- Platform billing (subscription + transactions) ---

export const getSubscription = async (req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await billingService.getForTenant(String(req.params.id)) });
};

export const createSubscription = async (req: Request, res: Response) => {
  const result = await billingService.createForTenant(actor(req), String(req.params.id), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Subscription created",
  });
};

export const cancelSubscription = async (req: Request, res: Response) => {
  const sub = await billingService.cancel(actor(req), String(req.params.id), req.body ?? {});
  sendSuccessResponse({ res, data: sub, message: "Subscription canceled" });
};

export const listTransactions = async (req: Request, res: Response) => {
  sendSuccessResponse({ res, data: await billingService.listTransactions(String(req.params.id)) });
};

export const getTenantBillingProfile = async (req: Request, res: Response) => {
  const profile = await tenantsService.getBillingProfile(String(req.params.id));
  sendSuccessResponse({ res, data: profile ?? null });
};

export const saveTenantBillingProfile = async (req: Request, res: Response) => {
  const profile = await tenantsService.saveBillingProfile(
    actor(req),
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({
    res,
    data: profile,
    message: "Tax invoice & legal profile saved successfully",
  });
};
