import { Router } from "express";
import { createView, deleteView, listViews } from "../controllers/views.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listViews));
router.post("/", asyncHandler(createView));
router.delete("/:id", asyncHandler(deleteView));

export default router;
