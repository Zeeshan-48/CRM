import { z } from "zod";
import { optBool, optNumeric, optRecord, optStr, optStrArray } from "./common";

// DB-backed enums (safe to enforce: valid callers only ever send these values;
// invalid ones fail at the DB today, so this just turns a 500 into a clear 400).
const LEAD_STATUS = [
  "NEW",
  "ATTEMPTED",
  "CONNECTED",
  "QUALIFIED",
  "NURTURE",
  "NOT_INTERESTED",
  "DISQUALIFIED",
  "CONVERTED",
] as const;
const ASSIGN_STRATEGY = [
  "ROUND_ROBIN",
  "AI",
  "SKILL_BASED",
  "TERRITORY_BASED",
  "MANUAL",
] as const;

// `source` and `campaign` are deliberately free-form strings (not enums).
// The cross-field "at least one of name/email/phone" rule stays in the service.
export const createLeadSchema = z.object({
  name: optStr,
  email: optStr,
  phone: optStr,
  city: optStr,
  country: optStr,
  source: optStr,
  campaign: optStr,
  notes: optStr,
  tags: optStrArray,
  socials: optRecord,
  budget: optBool,
  owner_id: optStr,
});

export const updateLeadSchema = z.object({
  name: optStr,
  email: optStr,
  phone: optStr,
  city: optStr,
  country: optStr,
  source: optStr,
  campaign: optStr,
  notes: optStr,
  status: z.enum(LEAD_STATUS).optional(),
  tags: optStrArray,
  socials: optRecord,
  budget: optBool,
  owner_id: optStr,
});

export const bulkActionSchema = z.object({
  ids: z.array(z.string()).min(1, "ids[] required"),
  action: z.enum(["assign", "tag", "delete"]),
  value: optStr,
  ownerId: optStr,
});

// Bulk CSV import: only assert a non-empty array of row objects. Field-level
// coercion/defaults stay in the very lenient service.
export const bulkImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, "rows[] required"),
});

export const assignLeadSchema = z.object({
  strategy: z.enum(ASSIGN_STRATEGY).optional(),
  ownerId: optStr,
});

export const convertLeadSchema = z.object({
  createDeal: optBool,
  value: optNumeric,
});
