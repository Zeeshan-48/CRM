import { Router } from "express";
import {
  getVaultData,
  getVaultSummary,
  purgeVaultItem,
  restoreVaultItem,
} from "../../controllers/operator/vault.controller";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.get("/summary", asyncHandler(getVaultSummary));
router.get("/data", asyncHandler(getVaultData));
router.post("/restore", asyncHandler(restoreVaultItem));
router.post("/purge", asyncHandler(purgeVaultItem));

export default router;

