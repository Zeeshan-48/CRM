import { z } from "zod";
import { optBool, optStr } from "../common";

// `gateway` and `planKey` stay free-form strings: billing.service uppercases the
// gateway before checking it against RAZORPAY/STRIPE and resolves planKey against
// the plans table (falling back to the tenant's current plan when omitted).
export const createSubscriptionSchema = z.object({
  gateway: optStr,
  planKey: optStr,
  billingMode: z.enum(["AUTO", "MANUAL"]).optional(),
});

export const cancelSubscriptionSchema = z.object({
  atPeriodEnd: optBool,
});
