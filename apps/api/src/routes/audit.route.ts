import { Router } from "express";
import { getCompliance, listAuditLogs } from "../controllers/audit.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listAuditLogs));
router.get("/compliance", asyncHandler(getCompliance));

export default router;
