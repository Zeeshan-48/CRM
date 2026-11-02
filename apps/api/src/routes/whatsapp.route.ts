import { Router } from "express";
import {
  agentReply,
  broadcastCampaign,
  createTemplate,
  deleteTemplate,
  exchangeEmbeddedSignup,
  getWhatsappConfig,
  listTemplates,
  removeWhatsappConfig,
  sendWhatsapp,
  syncTemplates,
  validateWhatsappConfig,
} from "../controllers/whatsapp.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// ---- BYO WhatsApp connection via Meta Embedded Signup. Connecting is limited
// to admins & managers; reading status is open to any authenticated user so the
// rest of the UI can react to it. ----
router.get("/config", asyncHandler(getWhatsappConfig));
router.post(
  "/config/embedded-signup/exchange",
  asyncHandler(requireCapability("channels")),
  asyncHandler(exchangeEmbeddedSignup)
);
router.post("/config/validate", asyncHandler(requireCapability("channels")), asyncHandler(validateWhatsappConfig));
router.delete("/config", asyncHandler(requireCapability("channels")), asyncHandler(removeWhatsappConfig));

router.get("/templates", asyncHandler(listTemplates));
router.post("/templates", asyncHandler(createTemplate));
router.post("/templates/sync", asyncHandler(syncTemplates));
router.delete("/templates/:id", asyncHandler(deleteTemplate));
router.post("/send", asyncHandler(sendWhatsapp));
router.post("/campaigns", asyncHandler(broadcastCampaign));
router.post("/agent/reply", asyncHandler(agentReply));

export default router;
