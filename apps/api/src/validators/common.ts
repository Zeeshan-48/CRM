import { z } from "zod";

// Shared field primitives. These mirror the backend's EXISTING leniency rather
// than tightening it, the goal is to reject clearly-malformed payloads (wrong
// types, missing required fields) without rejecting anything the services accept
// today. Optional fields accept null (services use `?? default` / `x?.trim()`).

/** Optional free-form string: string | null | omitted. Empty "" is allowed. */
export const optStr = z.string().nullish();

/** Optional boolean flag. */
export const optBool = z.boolean().nullish();

/**
 * Optional coerced-numeric field. The services do `Number(x) || 0` (or toMoney),
 * tolerating numeric strings and blanks from form inputs, so accept number OR
 * string here, never reject a value the backend would coerce today.
 */
export const optNumeric = z.union([z.number(), z.string()]).nullish();

/** Optional array of strings (e.g. tags). */
export const optStrArray = z.array(z.string()).nullish();

/** Optional array of anything, for permissive fields (competitors, stakeholders). */
export const optUnknownArray = z.array(z.unknown()).nullish();

/** Optional free-form JSON object (e.g. socials). Kept permissive on purpose. */
export const optRecord = z.record(z.string(), z.unknown()).nullish();

/** A required, non-empty string, the only thing several create endpoints enforce. */
export const reqStr = (label: string): z.ZodString =>
  z.string({ message: `${label} is required` }).min(1, `${label} is required`);
