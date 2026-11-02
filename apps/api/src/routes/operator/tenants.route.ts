import { Router } from "express";
import {
  cancelSubscription,
  createSubscription,
  createTenant,
  getSubscription,
  getTenant,
  listTenants,
  listTransactions,
  overrideEntitlement,
  updateTenant,
} from "../../controllers/operator/tenants.controller";
import { requireSuperadmin } from "../../middlewares/operator-auth.middleware";
import { validateBody } from "../../middlewares/validate.middleware";
import {
  cancelSubscriptionSchema,
  createSubscriptionSchema,
} from "../../validators/operator/billing.schema";
import {
  onboardTenantSchema,
  overrideEntitlementSchema,
  updateTenantSchema,
} from "../../validators/operator/tenants.schema";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listTenants));
router.post(
  "/",
  asyncHandler(requireSuperadmin),
  validateBody(onboardTenantSchema),
  asyncHandler(createTenant)
);
router.get("/:id", asyncHandler(getTenant));
router.put(
  "/:id",
  asyncHandler(requireSuperadmin),
  validateBody(updateTenantSchema),
  asyncHandler(updateTenant)
);
router.put(
  "/:id/entitlements",
  asyncHandler(requireSuperadmin),
  validateBody(overrideEntitlementSchema),
  asyncHandler(overrideEntitlement)
);

// Platform billing (subscription + transaction ledger) for a tenant.
router.get("/:id/subscription", asyncHandler(getSubscription));
router.post(
  "/:id/subscription",
  asyncHandler(requireSuperadmin),
  validateBody(createSubscriptionSchema),
  asyncHandler(createSubscription)
);
router.post(
  "/:id/subscription/cancel",
  asyncHandler(requireSuperadmin),
  validateBody(cancelSubscriptionSchema),
  asyncHandler(cancelSubscription)
);
router.get("/:id/transactions", asyncHandler(listTransactions));

export default router;
