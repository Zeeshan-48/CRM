import { Router } from "express";
import multer from "multer";
import {
  addDocument,
  assignLead,
  bulkAction,
  bulkImport,
  convertLead,
  createLead,
  deleteLead,
  exportCsv,
  getInsight,
  getLead,
  getScore,
  listAssignmentStrategies,
  listDocuments,
  listLeads,
  getLeadEngagement,
  listPlatformEvents,
  listSources,
  listTags,
  updateLead,
} from "../controllers/leads.controller";
import { validateBody } from "../middlewares/validate.middleware";
import {
  assignLeadSchema,
  bulkActionSchema,
  bulkImportSchema,
  convertLeadSchema,
  createLeadSchema,
  updateLeadSchema,
} from "../validators/leads.schema";
import { asyncHandler } from "../utils/asynchandler";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listLeads));
router.get("/sources", asyncHandler(listSources));
router.get("/tags", asyncHandler(listTags));
router.get("/assignment-strategies", asyncHandler(listAssignmentStrategies));
router.post("/bulk-action", validateBody(bulkActionSchema), asyncHandler(bulkAction));
router.get("/export.csv", asyncHandler(exportCsv));
router.post("/bulk", validateBody(bulkImportSchema), asyncHandler(bulkImport));
router.post("/", validateBody(createLeadSchema), asyncHandler(createLead));

router.get("/:id", asyncHandler(getLead));
router.put("/:id", validateBody(updateLeadSchema), asyncHandler(updateLead));
router.post("/:id/assign", validateBody(assignLeadSchema), asyncHandler(assignLead));
router.get("/:id/documents", asyncHandler(listDocuments));
// Multipart (multer), no JSON body schema; multer parses the file + form fields.
router.post("/:id/documents", upload.single("file"), asyncHandler(addDocument));
router.get("/:id/score", asyncHandler(getScore));
router.get("/:id/insight", asyncHandler(getInsight));
router.get("/:id/platform-events", asyncHandler(listPlatformEvents));
// Engagement rollup per connected product (lifecycle, plan, intent, usage).
router.get("/:id/engagement", asyncHandler(getLeadEngagement));
router.post("/:id/convert", validateBody(convertLeadSchema), asyncHandler(convertLead));
router.delete("/:id", asyncHandler(deleteLead));

export default router;
