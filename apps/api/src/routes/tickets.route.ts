import { Router } from "express";
import {
  aiResolveTicket,
  createTicket,
  deleteTicket,
  escalateTicket,
  getMetrics,
  getTicket,
  listSlaPolicies,
  listTickets,
  replyTicket,
  updateTicket,
} from "../controllers/tickets.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listTickets));
router.get("/sla", asyncHandler(listSlaPolicies));
router.get("/metrics", asyncHandler(getMetrics));
router.post("/", asyncHandler(createTicket));

router.get("/:id", asyncHandler(getTicket));
router.put("/:id", asyncHandler(updateTicket));
router.delete("/:id", asyncHandler(deleteTicket));
router.post("/:id/escalate", asyncHandler(escalateTicket));
router.post("/:id/reply", asyncHandler(replyTicket));
router.post("/:id/ai-resolve", asyncHandler(aiResolveTicket));

export default router;
