import { apiGet, apiPost } from "@/lib/api/client";
import type { LoginResponse, OperatorUser } from "@/types";

export const login = (payload: { email: string; password: string }) =>
  apiPost<LoginResponse>("/auth/login", payload);

/** Request a password-reset link by email. Always succeeds (no enumeration). */
export const requestPasswordReset = (payload: { email: string }) =>
  apiPost<{ ok: boolean }>("/auth/forgot-password", payload);

/** Set a new password using the one-time token from the reset link. */
export const resetPassword = (payload: { token: string; password: string }) =>
  apiPost<{ ok: boolean }>("/auth/reset-password", payload);

export const getMe = () => apiGet<{ user: OperatorUser }>("/auth/me");

export const changePassword = (payload: {
  currentPassword: string;
  newPassword: string;
}) => apiPost<{ ok: boolean }>("/auth/change-password", payload);
