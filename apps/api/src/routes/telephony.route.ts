import { Router } from "express";
import {
  addNumber,
  getConfig,
  getRecordingUrl,
  listCalls,
  listNumbers,
  logManualCall,
  placeCall,
  removeConfig,
  removeNumber,
  saveConfig,
  setAvailability,
  updateNumber,
  validateConfig,
} from "../controllers/telephony.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Config is managed by admins & managers; placing calls is open to any authenticated user.
router.get("/", asyncHandler(getConfig));
router.put("/", asyncHandler(requireCapability("channels")), asyncHandler(saveConfig));
router.post("/validate", asyncHandler(requireCapability("channels")), asyncHandler(validateConfig));
router.delete("/", asyncHandler(requireCapability("channels")), asyncHandler(removeConfig));
router.post("/call", asyncHandler(placeCall));
router.get("/calls", asyncHandler(listCalls));
// Manual log for calls dialed from an agent's personal SIM; open like /call.
router.post("/calls/manual", asyncHandler(logManualCall));
router.get("/calls/:id/recording", asyncHandler(getRecordingUrl));

// ExoPhone pool: reading is open (agents see which number they dial out from);
// writes are channel governance like the config itself.
router.get("/numbers", asyncHandler(listNumbers));
router.post("/numbers", asyncHandler(requireCapability("channels")), asyncHandler(addNumber));
router.put("/numbers/:id", asyncHandler(requireCapability("channels")), asyncHandler(updateNumber));
router.delete("/numbers/:id", asyncHandler(requireCapability("channels")), asyncHandler(removeNumber));

// Self-service: an agent toggles their own inbound-call availability.
router.post("/availability", asyncHandler(setAvailability));

export default router;
