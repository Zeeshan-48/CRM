import { Router } from "express";
import {
  createIdentity,
  deleteIdentity,
  listIdentities,
  updateIdentity,
} from "../controllers/email-identities.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listIdentities));
router.post("/", asyncHandler(requireCapability("channels")), asyncHandler(createIdentity));
router.patch("/:id", asyncHandler(requireCapability("channels")), asyncHandler(updateIdentity));
router.delete("/:id", asyncHandler(requireCapability("channels")), asyncHandler(deleteIdentity));

export default router;
