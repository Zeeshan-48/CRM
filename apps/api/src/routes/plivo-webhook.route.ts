import express, { Router } from "express";
import {
  handlePlivoAnswer,
  handlePlivoHangup,
  handlePlivoRecording,
} from "../controllers/plivo-webhook.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

const bodyParsers = [
  express.json({ limit: "1mb" }),
  express.urlencoded({ extended: true, limit: "1mb" }),
];

// Plivo calls Answer URL when call is initiated/answered (supports both GET and POST)
router.get("/:token/answer", asyncHandler(handlePlivoAnswer));
router.post("/:token/answer", ...bodyParsers, asyncHandler(handlePlivoAnswer));
router.get("/answer", asyncHandler(handlePlivoAnswer));
router.post("/answer", ...bodyParsers, asyncHandler(handlePlivoAnswer));

// Plivo calls Hangup URL when call is finished
router.post("/:token/hangup", ...bodyParsers, asyncHandler(handlePlivoHangup));
router.get("/:token/hangup", asyncHandler(handlePlivoHangup));
router.post("/hangup", ...bodyParsers, asyncHandler(handlePlivoHangup));
router.get("/hangup", asyncHandler(handlePlivoHangup));

// Plivo calls Recording URL when audio recording is ready
router.post("/:token/recording", ...bodyParsers, asyncHandler(handlePlivoRecording));
router.get("/:token/recording", asyncHandler(handlePlivoRecording));
router.post("/recording", ...bodyParsers, asyncHandler(handlePlivoRecording));
router.get("/recording", asyncHandler(handlePlivoRecording));

export default router;

