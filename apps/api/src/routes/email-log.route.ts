import { Router } from "express";
import {
  addSuppression,
  getReputation,
  listMessages,
  listSuppressions,
  removeSuppression,
} from "../controllers/email-log.controller";
import { requireRole } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

// Mounted at /email-messages.
export const emailMessagesRouter = Router();
emailMessagesRouter.get("/", asyncHandler(listMessages));

// Mounted at /email-reputation.
export const emailReputationRouter = Router();
emailReputationRouter.get("/", asyncHandler(getReputation));

// Mounted at /email-suppressions.
export const emailSuppressionsRouter = Router();
emailSuppressionsRouter.get("/", asyncHandler(listSuppressions));
emailSuppressionsRouter.post(
  "/",
  asyncHandler(requireRole("ADMIN", "MANAGER")),
  asyncHandler(addSuppression)
);
emailSuppressionsRouter.delete(
  "/:id",
  asyncHandler(requireRole("ADMIN", "MANAGER")),
  asyncHandler(removeSuppression)
);
