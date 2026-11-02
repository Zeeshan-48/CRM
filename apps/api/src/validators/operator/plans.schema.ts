import { z } from "zod";
import { optStr, reqStr } from "../common";

// `modules` and `limits` stay `unknown` on purpose: plans.service owns the real
// rules (module-key allowlist, the three required limit fields, non-negative
// integers) and returns precise messages. Typing them here would duplicate that
// and risk diverging from the module registry.
const modules = z.unknown().optional();
const limits = z.unknown().optional();

// price_monthly is required and must be a non-negative integer, exactly what
// the service already enforces (`Number.isInteger(...)`), so a string "499"
// is rejected here the same way it is today, just earlier.
const priceMonthly = z
  .number({ message: "price_monthly must be a non-negative integer" })
  .int("price_monthly must be a non-negative integer")
  .min(0, "price_monthly must be a non-negative integer");

// The UPPER_SNAKE_CASE key pattern stays in the service.
export const createPlanSchema = z.object({
  key: reqStr("key"),
  name: reqStr("name"),
  description: optStr,
  price_monthly: priceMonthly,
  modules,
  limits,
});

// Fully partial. `description` is explicitly nullable (the service treats null
// as "clear it"). The "nothing to update" rule stays in the service.
export const updatePlanSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  price_monthly: priceMonthly.optional(),
  modules,
  limits,
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});
