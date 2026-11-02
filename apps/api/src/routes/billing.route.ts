import { Router } from "express";
import {
  getMyBilling,
  getMyTransactions,
  payMyBilling,
  setMyBillingMode,
} from "../controllers/billing.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

// Tenant self-service billing. Auth is applied at mount (authenticateUser);
// access is governed by the RBAC-only `billing` capability (ADMIN by default).
const router = Router();

router.use(asyncHandler(requireCapability("billing")));

router.get("/", asyncHandler(getMyBilling));
router.get("/transactions", asyncHandler(getMyTransactions));
router.post("/pay", asyncHandler(payMyBilling));
router.post("/mode", asyncHandler(setMyBillingMode));

export default router;
