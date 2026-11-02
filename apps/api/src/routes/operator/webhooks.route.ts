import express, { Router } from "express";
import { razorpayWebhook, stripeWebhook } from "../../controllers/operator/webhooks.controller";
import { asyncHandler } from "../../utils/asynchandler";

// Public platform-billing webhooks. Mounted BEFORE express.json() (see app.ts)
// with a raw-body parser so the exact bytes are available for signature
// verification. No operator JWT, each request is authenticated by its gateway
// HMAC signature instead.
const router = Router();

router.post("/razorpay", express.raw({ type: "*/*", limit: "2mb" }), asyncHandler(razorpayWebhook));
router.post("/stripe", express.raw({ type: "*/*", limit: "2mb" }), asyncHandler(stripeWebhook));

export default router;
