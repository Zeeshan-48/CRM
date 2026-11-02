import { Router } from "express";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notifications.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listNotifications));
router.post("/read-all", asyncHandler(markAllNotificationsRead));
router.post("/:id/read", asyncHandler(markNotificationRead));

export default router;
