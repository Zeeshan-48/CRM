import { Router } from "express";
import { unsubscribe } from "../controllers/unsubscribe.controller";
import { asyncHandler } from "../utils/asynchandler";

// Public: no auth (linked from emails). Mounted at /unsubscribe.
const router = Router();
router.get("/", asyncHandler(unsubscribe));
router.post("/", asyncHandler(unsubscribe));

export default router;
