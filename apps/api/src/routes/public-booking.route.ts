import { Router } from "express";
import { publicBook, publicBookingInfo } from "../controllers/calendar.controller";
import { publicBookingLimiter } from "../middlewares/rate-limit.middleware";
import { asyncHandler } from "../utils/asynchandler";

// PUBLIC (no auth) booking page API. A prospect loads a shared booking link,
// sees open slots, and books, turning into a lead. Tenant is resolved from the
// URL slug; only ACTIVE tenants are bookable. Mounted at /api/v1/public/booking.
const router = Router();

router.get("/:tenantSlug/:linkSlug", asyncHandler(publicBookingInfo));
router.post("/:tenantSlug/:linkSlug", publicBookingLimiter, asyncHandler(publicBook));

export default router;
