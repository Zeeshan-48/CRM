import { Router } from "express";
import {
  createOperator,
  listOperators,
  updateOperator,
} from "../../controllers/operator/operators.controller";
import { requireSuperadmin } from "../../middlewares/operator-auth.middleware";
import { validateBody } from "../../middlewares/validate.middleware";
import {
  createOperatorSchema,
  updateOperatorSchema,
} from "../../validators/operator/operators.schema";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listOperators));
router.post(
  "/",
  asyncHandler(requireSuperadmin),
  validateBody(createOperatorSchema),
  asyncHandler(createOperator)
);
router.put(
  "/:id",
  asyncHandler(requireSuperadmin),
  validateBody(updateOperatorSchema),
  asyncHandler(updateOperator)
);

export default router;
