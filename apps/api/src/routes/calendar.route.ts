import { Router } from "express";
import {
  bookSlot,
  cancelMeeting,
  createBookingLink,
  createMyBookingLink,
  deleteMeeting,
  getMyBookingLink,
  getWorkingHours,
  googleConnect,
  googleDisconnect,
  googleStatus,
  listBookingLinks,
  listMeetings,
  listProviders,
  listReminders,
  resyncMeeting,
  scheduleMeeting,
  shareMyBookingLink,
  updateMyBookingLink,
  updateWorkingHours,
} from "../controllers/calendar.controller";
import { requireRole } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE parameterised ones (avoids shadowing).
router.get("/providers", asyncHandler(listProviders));

// Google Calendar OAuth (per-user). The public redirect callback lives on its
// own unauthenticated router (see routes/index.ts -> /oauth/google).
router.get("/google/status", asyncHandler(googleStatus));
router.post("/google/connect", asyncHandler(googleConnect));
router.delete("/google/connection", asyncHandler(googleDisconnect));
// Working hours are a WORKSPACE-WIDE setting (stored on tenants.config) used by
// scheduling, booking links and the sales agent alike. Anyone may read them
// (booking UIs need to), but only an ADMIN may change them, the editor lives on
// the Settings page.
router.get("/working-hours", asyncHandler(getWorkingHours));
router.put("/working-hours", requireRole("ADMIN"), asyncHandler(updateWorkingHours));
router.get("/meetings", asyncHandler(listMeetings));
router.post("/meetings", asyncHandler(scheduleMeeting));
router.post("/meetings/:id/sync", asyncHandler(resyncMeeting));
router.post("/meetings/:id/cancel", asyncHandler(cancelMeeting));
router.delete("/meetings/:id", asyncHandler(deleteMeeting));
router.get("/reminders", asyncHandler(listReminders));
router.get("/booking-links", asyncHandler(listBookingLinks));
router.post("/booking-links", asyncHandler(createBookingLink));
// The agent's single reusable link. Static "mine" segment MUST be registered
// before the parameterised ":slug/book" route so it isn't shadowed.
router.get("/booking-links/mine", asyncHandler(getMyBookingLink));
router.post("/booking-links/mine", asyncHandler(createMyBookingLink));
router.patch("/booking-links/mine", asyncHandler(updateMyBookingLink));
router.post("/booking-links/mine/share", asyncHandler(shareMyBookingLink));
router.post("/booking-links/:slug/book", asyncHandler(bookSlot));

export default router;
