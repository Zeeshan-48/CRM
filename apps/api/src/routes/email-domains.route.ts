import { Router } from "express";
import {
  checkDomain,
  deleteDomain,
  getDomain,
  getDomainHealth,
  listDomains,
  onboardDomain,
} from "../controllers/email-domains.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listDomains));
router.post("/", asyncHandler(requireCapability("channels")), asyncHandler(onboardDomain));
// Static sub-routes before the /:id param route.
router.post("/:id/check", asyncHandler(requireCapability("channels")), asyncHandler(checkDomain));
router.get("/:id/health", asyncHandler(getDomainHealth));
router.get("/:id", asyncHandler(getDomain));
router.delete("/:id", asyncHandler(requireCapability("channels")), asyncHandler(deleteDomain));

export default router;
