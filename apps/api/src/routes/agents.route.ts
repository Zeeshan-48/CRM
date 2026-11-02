import { Router } from "express";
import {
  approveAllOutreach,
  approveOutreach,
  editOutreach,
  getSalesMetrics,
  getSalesSettings,
  listAgents,
  listOutreach,
  listRuns,
  rejectOutreach,
  runAgent,
  updateSalesSettings,
} from "../controllers/agents.controller";
import { llmLimiter } from "../middlewares/rate-limit.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:agent (avoids shadowing).
router.get("/runs", asyncHandler(listRuns));
router.get("/outreach", asyncHandler(listOutreach));
router.post("/outreach/approve-all", asyncHandler(approveAllOutreach));
router.post("/outreach/:id/approve", asyncHandler(approveOutreach));
router.post("/outreach/:id/reject", asyncHandler(rejectOutreach));
router.patch("/outreach/:id", asyncHandler(editOutreach));
router.get("/sales/settings", asyncHandler(getSalesSettings));
router.put("/sales/settings", asyncHandler(updateSalesSettings));
router.get("/sales/metrics", asyncHandler(getSalesMetrics));
router.get("/", asyncHandler(listAgents));

router.post("/:agent/run", llmLimiter, asyncHandler(runAgent));

export default router;
