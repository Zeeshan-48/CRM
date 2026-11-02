import { Router } from "express";
import {
  getConversationIntelligence,
  getMarketing,
  getOverview,
  getPredictive,
  getProductRevenue,
  getSales,
  getSupport,
} from "../controllers/analytics.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/overview", asyncHandler(getOverview));
router.get("/sales", asyncHandler(getSales));
router.get("/marketing", asyncHandler(getMarketing));
router.get("/support", asyncHandler(getSupport));
router.get("/predictive", asyncHandler(getPredictive));
// Revenue by catalog product (from deal line items).
router.get("/product-revenue", asyncHandler(getProductRevenue));
router.get("/conversation-intelligence", asyncHandler(getConversationIntelligence));

export default router;
