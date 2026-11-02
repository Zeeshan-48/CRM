import { z } from "zod";
import { reqStr } from "./common";

// Shared by tenant + operator auth. Password rules match the services exactly:
// login accepts any non-empty password; reset/change enforce a minimum of 8
// (mirrors the inline `.length < 8` guards in both auth services).

export const loginSchema = z.object({
  email: reqStr("email"),
  password: reqStr("password"),
});

// Email may be omitted or blank, the service intentionally no-ops (so the
// endpoint can't be used to discover which addresses have accounts).
export const forgotPasswordSchema = z.object({
  email: z.string().nullish(),
});

export const resetPasswordSchema = z.object({
  token: reqStr("token"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const changePasswordSchema = z.object({
  currentPassword: reqStr("currentPassword"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});
