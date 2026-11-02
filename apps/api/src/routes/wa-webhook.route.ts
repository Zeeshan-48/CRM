import express, { Router } from "express";
import {
  receiveWaWebhook,
  receiveWaWebhookShared,
  verifyWaWebhook,
  verifyWaWebhookShared,
} from "../controllers/wa-webhook.controller";
import { asyncHandler } from "../utils/asynchandler";

// Public WhatsApp webhook. Mounted BEFORE express.json() with a raw-body parser
// so the exact bytes are available for HMAC verification.
const router = Router();

// Shared Embedded-Signup callback (one URL for every connected WABA; tenant
// resolved by waba_id). Declared BEFORE /:token so "whatsapp" is not captured
// as a per-tenant token.
router.get("/whatsapp", asyncHandler(verifyWaWebhookShared));
router.post(
  "/whatsapp",
  express.raw({ type: "*/*", limit: "5mb" }),
  asyncHandler(receiveWaWebhookShared)
);

// Legacy per-tenant URL-token webhook (kept for backward compatibility).
router.get("/:token", asyncHandler(verifyWaWebhook));
router.post("/:token", express.raw({ type: "*/*", limit: "5mb" }), asyncHandler(receiveWaWebhook));

export default router;
