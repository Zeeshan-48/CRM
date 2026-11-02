import { Router } from "express";
import {
  createReminder,
  deleteReminder,
  getReminderCount,
  listReminders,
  listTodayReminders,
  toggleReminder,
  updateReminder,
} from "../controllers/reminders.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listReminders));
router.get("/count", asyncHandler(getReminderCount));
router.get("/today", asyncHandler(listTodayReminders));
router.post("/", asyncHandler(createReminder));

router.put("/:id", asyncHandler(updateReminder));
router.post("/:id/toggle", asyncHandler(toggleReminder));
router.delete("/:id", asyncHandler(deleteReminder));

export default router;
