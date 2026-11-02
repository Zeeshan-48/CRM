import { Router } from "express";
import {
  forgotPassword,
  login,
  logout,
  me,
  resetPassword,
} from "../controllers/auth.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import {
  forgotEmailLimiter,
  forgotIpLimiter,
  loginEmailLimiter,
  loginIpLimiter,
  resetPasswordLimiter,
} from "../middlewares/rate-limit.middleware";
import { validateBody } from "../middlewares/validate.middleware";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "../validators/auth.schema";
import { asyncHandler } from "../utils/asynchandler";

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

router.get("/me", asyncHandler(authenticateUser), asyncHandler(me));

// Records an auth.logout audit event. Auth is stateless JWT, so this only
// captures the trail, the client drops the token itself.
router.post("/logout", asyncHandler(authenticateUser), asyncHandler(logout));

export default router;
