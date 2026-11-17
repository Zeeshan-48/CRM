import { Request, Response } from "express";
import { UnauthorizedError } from "../errors";
import authService from "../services/auth.service";
import { sendSuccessResponse } from "../utils/response.util";

// Best-effort client IP + device, recorded on sign-in / sign-out audit events.
// Prefers the left-most X-Forwarded-For hop (real client behind our proxy),
// falling back to the socket IP.
const clientContext = (req: Request) => {
  const fwd = req.headers["x-forwarded-for"];
  const ip =
    (typeof fwd === "string" ? fwd.split(",")[0]?.trim() : undefined) || req.ip || null;
  const ua = req.headers["user-agent"];
  return { ip, userAgent: typeof ua === "string" ? ua : null };
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  const result = await authService.login(email, password, clientContext(req));
  sendSuccessResponse({ res, data: result, message: "Signed in" });
};

export const logout = async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError("Authentication required");
  const result = await authService.logout(
    { id: req.authUser.id, tenantId: req.authUser.tenantId },
    clientContext(req)
  );
  sendSuccessResponse({ res, data: result, message: "Signed out" });
};

export const me = async (req: Request, res: Response) => {
  if (!req.authUser) throw new UnauthorizedError("Authentication required");
  const user = await authService.me(req.authUser);
  sendSuccessResponse({ res, data: { user } });
};

// Always responds success regardless of whether the email exists, so the
// endpoint can't be used to discover which addresses have accounts.
export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  await authService.requestPasswordReset(email);
  sendSuccessResponse({
    res,
    data: { ok: true },
    message: "If an account exists for that email, a reset link is on its way.",
  });
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, password } = req.body ?? {};
  await authService.resetPassword(token, password);
  sendSuccessResponse({
    res,
    data: { ok: true },
    message: "Your password has been updated. You can now sign in.",
  });
};

