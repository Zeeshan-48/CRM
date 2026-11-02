import { Router } from "express";
import { listAudit } from "../../controllers/operator/audit.controller";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listAudit));

export default router;
