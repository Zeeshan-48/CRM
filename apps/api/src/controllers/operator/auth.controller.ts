import { Request, Response } from "express";
import { UnauthorizedError } from "../../errors";
import authService from "../../services/operator/auth.service";
import { sendSuccessResponse } from "../../utils/response.util";

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  const result = await authService.login(email, password);
  sendSuccessResponse({ res, data: result, message: "Signed in" });
};

export const me = async (req: Request, res: Response) => {
  if (!req.operatorUser) throw new UnauthorizedError("Authentication required");
  const user = await authService.me(req.operatorUser.id);
  sendSuccessResponse({ res, data: { user } });
};

export const changePassword = async (req: Request, res: Response) => {
  if (!req.operatorUser) throw new UnauthorizedError("Authentication required");
  const { currentPassword, newPassword } = req.body ?? {};
  await authService.changePassword(req.operatorUser.id, currentPassword, newPassword);
  sendSuccessResponse({ res, data: { ok: true }, message: "Password updated" });
};

// Always responds success regardless of whether the email maps to an operator,
// so the endpoint can't be used to discover operator accounts.
export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  await authService.requestPasswordReset(email);
  sendSuccessResponse({
    res,
    data: { ok: true },
    message: "If an operator account exists for that email, a reset link is on its way.",
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
