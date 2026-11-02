import { Router } from "express";
import {
  createInvoice,
  createPaymentLink,
  deleteInvoice,
  getGatewayDefault,
  getRazorpayConfig,
  getStripeConfig,
  getSummary,
  listGateways,
  listInvoices,
  listPayments,
  payInvoice,
  refundInvoice,
  removeRazorpayConfig,
  removeStripeConfig,
  saveRazorpayConfig,
  saveStripeConfig,
  setGatewayDefault,
  updateInvoice,
  validateRazorpayConfig,
  validateStripeConfig,
} from "../controllers/finance.controller";
import { requireRole } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/gateways", asyncHandler(listGateways));
router.get("/summary", asyncHandler(getSummary));
router.get("/invoices", asyncHandler(listInvoices));
router.get("/payments", asyncHandler(listPayments));
router.post("/invoices", asyncHandler(createInvoice));
router.put("/invoices/:id", asyncHandler(updateInvoice));
router.delete("/invoices/:id", asyncHandler(deleteInvoice));
// Manual / offline "mark paid" (records a payment without a real charge).
router.post("/invoices/:id/pay", asyncHandler(payInvoice));
// Online collection: generate a real Razorpay payment link (polled to PAID).
router.post("/invoices/:id/payment-link", asyncHandler(createPaymentLink));
router.post("/invoices/:id/refund", asyncHandler(refundInvoice));

// ---- Default payment gateway (which one new links use). ADMIN sets it. ----
router.get("/gateway-default", asyncHandler(getGatewayDefault));
router.put("/gateway-default", asyncHandler(requireRole("ADMIN")), asyncHandler(setGatewayDefault));

// ---- BYO Razorpay connection. Config is ADMIN-managed. ----
router.get("/razorpay/config", asyncHandler(getRazorpayConfig));
router.put("/razorpay/config", asyncHandler(requireRole("ADMIN")), asyncHandler(saveRazorpayConfig));
router.post("/razorpay/config/validate", asyncHandler(requireRole("ADMIN")), asyncHandler(validateRazorpayConfig));
router.delete("/razorpay/config", asyncHandler(requireRole("ADMIN")), asyncHandler(removeRazorpayConfig));

// ---- BYO Stripe connection. Config is ADMIN-managed. ----
router.get("/stripe/config", asyncHandler(getStripeConfig));
router.put("/stripe/config", asyncHandler(requireRole("ADMIN")), asyncHandler(saveStripeConfig));
router.post("/stripe/config/validate", asyncHandler(requireRole("ADMIN")), asyncHandler(validateStripeConfig));
router.delete("/stripe/config", asyncHandler(requireRole("ADMIN")), asyncHandler(removeStripeConfig));

export default router;
