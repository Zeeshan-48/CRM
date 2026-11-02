import { Router } from "express";
import { overview } from "../../controllers/operator/metrics.controller";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.get("/overview", asyncHandler(overview));

export default router;
