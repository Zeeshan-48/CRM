import { Router } from "express";
import {
  completeTask,
  countActivities,
  createTask,
  deleteActivity,
  deleteTask,
  listActivities,
  listTasks,
  logActivity,
  updateActivity,
  updateTask,
} from "../controllers/activities.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static / more-specific routes BEFORE parameterised ones (avoids shadowing).
router.get("/", asyncHandler(listActivities));
router.get("/count", asyncHandler(countActivities));
router.get("/tasks/list", asyncHandler(listTasks));
router.post("/tasks", asyncHandler(createTask));
router.post("/tasks/:id/complete", asyncHandler(completeTask));
router.put("/tasks/:id", asyncHandler(updateTask));
router.delete("/tasks/:id", asyncHandler(deleteTask));
router.post("/", asyncHandler(logActivity));
router.put("/:id", asyncHandler(updateActivity));
router.delete("/:id", asyncHandler(deleteActivity));

export default router;
