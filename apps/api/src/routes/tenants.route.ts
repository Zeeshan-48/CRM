import { Router } from "express";
import { getMyTenant, listPlans, updateMyTenant } from "../controllers/tenants.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/me", asyncHandler(getMyTenant));
router.put("/me", asyncHandler(requireCapability("settings")), asyncHandler(updateMyTenant));
router.get("/plans", asyncHandler(listPlans));

export default router;
