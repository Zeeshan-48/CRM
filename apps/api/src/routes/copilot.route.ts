import { Router } from "express";
import { ask, listSuggestions } from "../controllers/copilot.controller";
import { llmLimiter } from "../middlewares/rate-limit.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/suggestions", asyncHandler(listSuggestions));
router.post("/ask", llmLimiter, asyncHandler(ask));

export default router;
