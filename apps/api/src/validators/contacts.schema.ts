import { z } from "zod";
import { optRecord, optStr, optStrArray, reqStr } from "./common";

// Only `name` is required on create; the service already validates `lifecycle`
// against this exact set (asLifecycle), so enforcing it here is a faithful match.
const LIFECYCLE = ["LEAD", "PROSPECT", "CUSTOMER"] as const;

export const createContactSchema = z.object({
  name: reqStr("name"),
  email: optStr,
  phone: optStr,
  company: optStr,
  title: optStr,
  city: optStr,
  account_id: optStr,
  owner_id: optStr,
  tags: optStrArray,
  socials: optRecord,
  lifecycle: z.enum(LIFECYCLE).optional(),
});

// Partial update, nothing required (existence is checked on the :id row).
export const updateContactSchema = z.object({
  name: optStr,
  email: optStr,
  phone: optStr,
  company: optStr,
  title: optStr,
  city: optStr,
  account_id: optStr,
  owner_id: optStr,
  tags: optStrArray,
  socials: optRecord,
  lifecycle: z.enum(LIFECYCLE).optional(),
});
