import { z } from "zod";
import { optStr, reqStr } from "../common";

// Mirrors src/db/enums.ts. Kept as literal tuples (not derived) so the accepted
// values are visible at the edge; the services re-check against the enum.
const OPERATOR_ROLE = ["SUPERADMIN", "OPERATOR"] as const;
const USER_STATUS = ["ACTIVE", "DISABLED", "PENDING"] as const;

// `password` stays optional: blank means "generate a secure one and email it".
// Email format is deliberately not enforced here, the service lowercases and
// the DB owns uniqueness, and no existing caller sends a non-email.
export const createOperatorSchema = z.object({
  name: reqStr("name"),
  email: reqStr("email"),
  role: z.enum(OPERATOR_ROLE),
  password: optStr,
});

// Fully partial. The "nothing to update" rule stays in the service.
export const updateOperatorSchema = z.object({
  name: z.string().optional(),
  role: z.enum(OPERATOR_ROLE).optional(),
  status: z.enum(USER_STATUS).optional(),
});
