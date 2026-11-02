import type { LoginResponse, User } from "@/types";
import { apiGet, apiPost } from "./client";

export const login = (payload: { email: string; password: string }) =>
  apiPost<LoginResponse>("/auth/login", payload);

/** Records an auth.logout audit event server-side, then the caller clears local state. */
export const logout = () => apiPost<{ ok: boolean }>("/auth/logout", {});

/** Request a password-reset link by email. Always succeeds (no enumeration). */
export const requestPasswordReset = (payload: { email: string }) =>
  apiPost<{ ok: boolean }>("/auth/forgot-password", payload);

/** Set a new password using the one-time token from the reset link. */
export const resetPassword = (payload: { token: string; password: string }) =>
  apiPost<{ ok: boolean }>("/auth/reset-password", payload);

export const getMe = () => apiGet<{ user: User }>("/auth/me");

/** Public endpoint; powers the white-label tenant picker on the sign-in page. */
