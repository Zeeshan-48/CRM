import { Request, Response } from "express";
import { BadRequestError, ForbiddenError } from "../errors";
import financeService from "../services/finance.service";
import paymentGatewayService from "../services/payment-gateway.service";
import razorpayConfigService from "../services/razorpay-config.service";
import stripeConfigService from "../services/stripe-config.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

// ---- Default payment gateway (tenant-level) ----
export const getGatewayDefault = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: { gateway: await paymentGatewayService.defaultGateway(tenantId) } });
};

export const setGatewayDefault = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const gateway = String((req.body ?? {})?.gateway ?? "");
  if (!paymentGatewayService.isName(gateway)) {
    throw new BadRequestError("gateway must be Razorpay or Stripe");
  }
  await paymentGatewayService.setDefaultGateway(tenantId, gateway);
  sendSuccessResponse({ res, data: { gateway }, message: "Default gateway updated" });
};

// ---- BYO Stripe connection ----
export const getStripeConfig = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await stripeConfigService.getConfig(tenantId) });
};

export const saveStripeConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await stripeConfigService.saveConfig(tenantId, actorId, req.body ?? {}),
    message: "Stripe credentials saved",
  });
};

export const validateStripeConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await stripeConfigService.validate(tenantId, actorId),
    message: "Validation checked",
  });
};

export const removeStripeConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await stripeConfigService.remove(tenantId, actorId),
    message: "Stripe disconnected",
  });
};

// ---- BYO Razorpay connection ----
export const getRazorpayConfig = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await razorpayConfigService.getConfig(tenantId) });
};

export const saveRazorpayConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await razorpayConfigService.saveConfig(tenantId, actorId, req.body ?? {}),
    message: "Razorpay credentials saved",
  });
};

export const validateRazorpayConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await razorpayConfigService.validate(tenantId, actorId),
    message: "Validation checked",
  });
};

export const removeRazorpayConfig = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await razorpayConfigService.remove(tenantId, actorId),
    message: "Razorpay disconnected",
  });
};

export const listGateways = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: financeService.gateways() });
};

export const getSummary = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await financeService.summary(tenantId) });
};

export const listInvoices = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await financeService.invoices(tenantId) });
};

export const listPayments = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await financeService.payments(tenantId) });
};

export const createInvoice = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const invoice = await financeService.createInvoice(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: invoice,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Invoice created",
  });
};

export const updateInvoice = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await financeService.updateInvoice(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Invoice updated",
  });
};

export const deleteInvoice = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await financeService.removeInvoice(tenantId, actorId, String(req.params.id)),
    message: "Invoice deleted",
  });
};

export const payInvoice = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await financeService.payInvoice(tenantId, actorId, String(req.params.id)),
    message: "Invoice paid",
  });
};

export const refundInvoice = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const manual = (req.body ?? {})?.manual === true;
  sendSuccessResponse({
    res,
    data: await financeService.refundInvoice(tenantId, actorId, String(req.params.id), { manual }),
    message: "Invoice refunded",
  });
};

export const createPaymentLink = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await financeService.createPaymentLink(tenantId, actorId, String(req.params.id)),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Payment link created",
  });
};
