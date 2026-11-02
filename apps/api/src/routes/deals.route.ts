import { Router } from "express";
import {
  addDealLineItem,
  createDeal,
  createPipeline,
  deleteDeal,
  deleteDealLineItem,
  getBoard,
  getCoach,
  getDeal,
  getInsight,
  getForecast,
  listDealLineItems,
  listPipelines,
  loseDeal,
  moveDeal,
  updateDeal,
  updateDealLineItem,
  winDeal,
} from "../controllers/deals.controller";
import { validateBody } from "../middlewares/validate.middleware";
import {
  createDealSchema,
  createPipelineSchema,
  loseDealSchema,
  moveDealSchema,
  updateDealSchema,
} from "../validators/deals.schema";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/pipelines", asyncHandler(listPipelines));
router.post("/pipelines", validateBody(createPipelineSchema), asyncHandler(createPipeline));
router.get("/board", asyncHandler(getBoard));
router.get("/forecast", asyncHandler(getForecast));
router.post("/", validateBody(createDealSchema), asyncHandler(createDeal));

router.get("/:id", asyncHandler(getDeal));
router.put("/:id", validateBody(updateDealSchema), asyncHandler(updateDeal));
router.delete("/:id", asyncHandler(deleteDeal));
router.post("/:id/move", validateBody(moveDealSchema), asyncHandler(moveDeal));
router.post("/:id/win", asyncHandler(winDeal));
router.post("/:id/lost", validateBody(loseDealSchema), asyncHandler(loseDeal));
router.get("/:id/coach", asyncHandler(getCoach));
router.get("/:id/insight", asyncHandler(getInsight));

// ---- Line items (products on the deal) ----
// deals.value becomes DERIVED from these when any exist, and falls back to the
// manually entered scalar when none do, so nothing about existing deals changes.
router.get("/:id/line-items", asyncHandler(listDealLineItems));
router.post("/:id/line-items", asyncHandler(addDealLineItem));
router.patch("/:id/line-items/:itemId", asyncHandler(updateDealLineItem));
router.delete("/:id/line-items/:itemId", asyncHandler(deleteDealLineItem));

export default router;
