import { Router } from "express";
import { createPlan, listPlans, updatePlan } from "../../controllers/operator/plans.controller";
import { requireSuperadmin } from "../../middlewares/operator-auth.middleware";
import { validateBody } from "../../middlewares/validate.middleware";
import { createPlanSchema, updatePlanSchema } from "../../validators/operator/plans.schema";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listPlans));
router.post(
  "/",
  asyncHandler(requireSuperadmin),
  validateBody(createPlanSchema),
  asyncHandler(createPlan)
);
router.put(
  "/:id",
  asyncHandler(requireSuperadmin),
  validateBody(updatePlanSchema),
  asyncHandler(updatePlan)
);

export default router;
