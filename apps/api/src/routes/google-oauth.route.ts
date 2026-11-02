import { Router } from "express";
import { googleCallback } from "../controllers/calendar.controller";
import { asyncHandler } from "../utils/asynchandler";

// PUBLIC router for Google's OAuth redirect. No JWT, the browser arrives here
// straight from Google's consent screen. Trust is established by the HMAC-signed
// `state` (verified in the controller), not by session/auth middleware.
// Mounted at /api/v1/oauth/google, so the callback is
//   /api/v1/oauth/google/calendar/callback
// which must match config.GOOGLE_OAUTH_REDIRECT_URL and the Authorized redirect
// URI registered in the Google Cloud OAuth client.
const router = Router();

router.get("/calendar/callback", asyncHandler(googleCallback));

export default router;
