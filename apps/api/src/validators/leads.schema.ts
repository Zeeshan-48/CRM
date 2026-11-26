import { z } from "zod";
import { LEAD_IMPORT_MODES, LEAD_IMPORT_TYPES } from "../constants/lead-import.const";
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
  import_type: z.enum(LEAD_IMPORT_TYPES).nullish(),
  extra_fields: optRecord,
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
  import_type: z.enum(LEAD_IMPORT_TYPES).nullish(),
  extra_fields: optRecord,
});

export const bulkActionSchema = z.object({
  ids: z.array(z.string()).min(1, "ids[] required"),
  action: z.enum(["assign", "tag", "delete"]),
  value: optStr,
  ownerId: optStr,
});

// Bulk spreadsheet import: enforces import format type and optional upload-time assignment.
export const bulkImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, "rows[] required"),
  importType: z.enum(LEAD_IMPORT_TYPES).optional(),
  assignment: z
    .object({
      mode: z.enum(LEAD_IMPORT_MODES).default("default"),
      ownerIds: z.array(z.string()).optional(),
    })
    .optional(),
  skipDuplicates: optBool,
});

export const assignLeadSchema = z.object({
  strategy: z.enum(ASSIGN_STRATEGY).optional(),
  ownerId: optStr,
});

export const convertLeadSchema = z.object({
  createDeal: optBool,
  value: optNumeric,
  dealTitle: optStr,
  accountId: optStr,
  accountName: optStr,
  contactName: optStr,
  email: optStr,
  phone: optStr,
  city: optStr,
});
