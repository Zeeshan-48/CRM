import express, { Router } from "express";
import {
  handlePlivoAnswer,
  handlePlivoHangup,
  handlePlivoRecording,
} from "../controllers/plivo-webhook.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Plivo calls Answer URL when agent answers
router.get("/:token/answer", asyncHandler(handlePlivoAnswer));

// Plivo calls Hangup URL when call is finished
router.post(
  "/:token/hangup",
  express.json({ limit: "1mb" }),
  express.urlencoded({ extended: true, limit: "1mb" }),
  asyncHandler(handlePlivoHangup)
);

// Plivo calls Recording URL when audio recording is ready
router.post(
  "/:token/recording",
  express.json({ limit: "1mb" }),
  express.urlencoded({ extended: true, limit: "1mb" }),
  asyncHandler(handlePlivoRecording)
);

export default router;

