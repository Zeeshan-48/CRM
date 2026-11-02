import { Request, Response } from "express";
import { UnauthorizedError } from "../errors";
import plansRepository from "../repositories/operator/plans.repository";
import billingService from "../services/operator/billing.service";
import { sendSuccessResponse } from "../utils/response.util";

// Tenant-facing billing (the workspace's own subscription). Scope is always the
// caller's tenant, resolved from the JWT, never a URL param, so a tenant can
// only ever see/act on its own billing. Reuses the platform billing service.
const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new UnauthorizedError("Authentication required");
  return { tenantId: user.tenantId, actor: { id: user.id, email: user.email } };
};

export const getMyBilling = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const { subscription } = await billingService.getForTenant(tenantId);
  const plan = subscription ? await plansRepository.findByKey(subscription.plan_key) : null;
  sendSuccessResponse({ res, data: { subscription, plan } });
};

export const getMyTransactions = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await billingService.listTransactions(tenantId) });
};

export const payMyBilling = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const result = await billingService.payNow(tenantId);
  sendSuccessResponse({ res, data: result, message: "Payment link ready" });
};

export const setMyBillingMode = async (req: Request, res: Response) => {
  const { tenantId, actor } = ctx(req);
  const mode = String((req.body ?? {}).mode ?? "");
  const result = await billingService.setMode(actor, tenantId, mode);
  sendSuccessResponse({ res, data: result, message: "Billing preference updated" });
};
