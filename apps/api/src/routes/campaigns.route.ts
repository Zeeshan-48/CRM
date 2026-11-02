import { Router } from "express";
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  sendCampaign,
} from "../controllers/campaigns.controller";
import { validateBody } from "../middlewares/validate.middleware";
import { createCampaignSchema } from "../validators/campaigns.schema";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listCampaigns));
router.post("/", validateBody(createCampaignSchema), asyncHandler(createCampaign));

router.get("/:id", asyncHandler(getCampaign));
// Send takes no body, validated by business rules in the service.
router.post("/:id/send", asyncHandler(sendCampaign));

export default router;
