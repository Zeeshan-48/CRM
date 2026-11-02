import { Router } from "express";
import {
  getConversation,
  getInbox,
  sendReply,
  simulateInbound,
} from "../controllers/inbox.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(getInbox));
router.post("/simulate-inbound", asyncHandler(simulateInbound));

router.get("/:id", asyncHandler(getConversation));
router.post("/:id/send", asyncHandler(sendReply));

export default router;
