import { Router } from "express";
import {
  addDraftType,
  createTemplate,
  deleteDraftType,
  deleteTemplate,
  getMetrics,
  listDraftTypes,
  listTemplates,
  restoreDraftType,
  sendEmail,
  updateTemplate,
  writeDraft,
} from "../controllers/email.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/templates", asyncHandler(listTemplates));
router.post("/templates", asyncHandler(createTemplate));
router.put("/templates/:id", asyncHandler(updateTemplate));
router.delete("/templates/:id", asyncHandler(deleteTemplate));
router.get("/draft-types", asyncHandler(listDraftTypes));
router.post("/draft-types", asyncHandler(addDraftType));
router.post("/draft-types/:key/restore", asyncHandler(restoreDraftType));
router.delete("/draft-types/:key", asyncHandler(deleteDraftType));
router.post("/write", asyncHandler(writeDraft));
router.post("/send", asyncHandler(sendEmail));
router.get("/metrics", asyncHandler(getMetrics));

export default router;
