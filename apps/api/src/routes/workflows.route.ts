import { Router } from "express";
import {
  createWorkflow,
  deleteWorkflow,
  getCatalogue,
  listRuns,
  listWorkflows,
  testRunWorkflow,
  updateWorkflow,
} from "../controllers/workflows.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/catalogue", asyncHandler(getCatalogue));
router.get("/runs", asyncHandler(listRuns));
router.get("/", asyncHandler(listWorkflows));
router.post("/", asyncHandler(createWorkflow));

router.put("/:id", asyncHandler(updateWorkflow));
router.delete("/:id", asyncHandler(deleteWorkflow));
router.post("/:id/run", asyncHandler(testRunWorkflow));

export default router;
