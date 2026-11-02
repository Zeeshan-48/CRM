import express, { Router } from "express";
import {
  receiveExotelPassthru,
  receiveExotelStatusCallback,
  routeExotelCall,
} from "../controllers/exotel-webhook.controller";
import { asyncHandler } from "../utils/asynchandler";

// Public Exotel telephony webhooks, mounted in app.ts BEFORE the global JSON
// parser and BEFORE globalApiLimiter (provider callbacks must never be
// throttled, a rate-limited Connect fetch is a caller hearing dead air).
//
// Exotel's callbacks are unsigned; the unguessable per-tenant :token is the
// entire authentication, exactly like the WhatsApp webhook's URL token.
//
//   GET  /:token/route     Connect applet dynamic URL (who should we dial?)
//   GET  /:token/status    Passthru applet at flow end (how did it go?)
//   POST /:token/callback  StatusCallback for API-placed outbound calls
const router = Router();

router.get("/:token/route", asyncHandler(routeExotelCall));
router.get("/:token/status", asyncHandler(receiveExotelPassthru));
// Router-local JSON parser: this mounts before the app-wide express.json().
router.post(
  "/:token/callback",
  express.json({ limit: "1mb" }),
  express.urlencoded({ extended: true, limit: "1mb" }),
  asyncHandler(receiveExotelStatusCallback)
);

export default router;
