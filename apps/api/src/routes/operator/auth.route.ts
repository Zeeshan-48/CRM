import { Router } from "express";
import {
  changePassword,
  forgotPassword,
  login,
  me,
  resetPassword,
} from "../../controllers/operator/auth.controller";
import { authenticateOperator } from "../../middlewares/operator-auth.middleware";
import {
  changePasswordLimiter,
  forgotEmailLimiter,
  forgotIpLimiter,
  loginEmailLimiter,
  loginIpLimiter,
  resetPasswordLimiter,
} from "../../middlewares/rate-limit.middleware";
import { validateBody } from "../../middlewares/validate.middleware";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "../../validators/auth.schema";
import { asyncHandler } from "../../utils/asynchandler";

const router = Router();

router.post(
  "/login",
  loginIpLimiter,
  loginEmailLimiter,
  validateBody(loginSchema),
  asyncHandler(login)
);

// Public: self-service password reset (request a link, then set a new password).
router.post(
  "/forgot-password",
  forgotIpLimiter,
  forgotEmailLimiter,
  validateBody(forgotPasswordSchema),
  asyncHandler(forgotPassword)
);
router.post(
  "/reset-password",
  resetPasswordLimiter,
  validateBody(resetPasswordSchema),
  asyncHandler(resetPassword)
);
router.get("/me", asyncHandler(authenticateOperator), asyncHandler(me));
router.post(
  "/change-password",
  asyncHandler(authenticateOperator),
  changePasswordLimiter,
  validateBody(changePasswordSchema),
  asyncHandler(changePassword)
);

export default router;
