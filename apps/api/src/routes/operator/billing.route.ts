import { Router } from "express";
import { billingMetrics } from "../../controllers/operator/billing.controller";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

// Platform billing overview: MRR, subscription status counts, upcoming renewals.
router.get("/metrics", asyncHandler(billingMetrics));

export default router;
