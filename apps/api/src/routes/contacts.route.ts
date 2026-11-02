import { Router } from "express";
import {
  createContact,
  deleteContact,
  getContact,
  getContactEngagement,
  listContactPlatformEvents,
  listContacts,
  updateContact,
} from "../controllers/contacts.controller";
import { validateBody } from "../middlewares/validate.middleware";
import {
  createContactSchema,
  updateContactSchema,
} from "../validators/contacts.schema";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listContacts));
router.post("/", validateBody(createContactSchema), asyncHandler(createContact));

router.get("/:id", asyncHandler(getContact));
// Product engagement + raw stream. History follows the person through
// lead-to-contact conversion, so these mirror the lead endpoints.
router.get("/:id/engagement", asyncHandler(getContactEngagement));
router.get("/:id/platform-events", asyncHandler(listContactPlatformEvents));
router.put("/:id", validateBody(updateContactSchema), asyncHandler(updateContact));
router.delete("/:id", asyncHandler(deleteContact));

export default router;
