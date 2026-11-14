import { z } from "zod";
import { optBool, optStr, reqStr } from "../common";

// Mirrors src/db/enums.ts tenant_status.
const TENANT_STATUS = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;

// `gateway` stays a free-form string: the service uppercases it before checking
// it against RAZORPAY/STRIPE, so an enum here would reject the lowercase form
// that works today. `slug` may be "", the service derives one from the name.
export const onboardTenantSchema = z.object({
  name: reqStr("name"),
  plan_key: reqStr("plan_key"),
  slug: optStr,
  domain: optStr,
  industry: optStr,
  brand_color: optStr,
  gateway: optStr,
  billingMode: z.enum(["AUTO", "MANUAL"]).optional(),
  admin: z.object({
    name: reqStr("admin.name"),
    email: reqStr("admin.email"),
    // Blank means "generate a secure one and email it".
    password: optStr,
  }),
});

// Fully partial. The plan_key-must-be-active check and the "nothing to update"
// rule stay in the service.
export const updateTenantSchema = z.object({
  name: z.string().optional(),
  brand_color: z.string().optional(),
  status: z.enum(TENANT_STATUS).optional(),
  plan_key: z.string().optional(),
});

// `limit_value` is nullable: null clears the cap (unlimited).
export const overrideEntitlementSchema = z.object({
  code: reqStr("code"),
  enabled: optBool,
  limit_value: z.number().int().nullable().optional(),
});

export const upsertBillingProfileSchema = z.object({
  legal_name: reqStr("legal_name"),
  brand_name: optStr,
  gstin: optStr,
  cin: optStr,
  pan: optStr,
  is_gst_registered: optBool,
  address: reqStr("address"),
  city: reqStr("city"),
  state: reqStr("state"),
  state_code: optStr,
  pincode: reqStr("pincode"),
  phone: optStr,
  email: optStr,
  website: optStr,
  bank_name: reqStr("bank_name"),
  account_name: reqStr("account_name"),
  account_number: reqStr("account_number"),
  ifsc: reqStr("ifsc"),
  upi_id: optStr,
  invoice_prefix: optStr,
  next_sequence: z.number().int().positive().optional(),
  signatory_name: reqStr("signatory_name"),
  signatory_designation: optStr,
  signature_url: optStr,
  logo_url: optStr,
  jurisdiction_city: optStr,
  notes: optStr,
  is_verified: optBool,
});
