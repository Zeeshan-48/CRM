import { z } from "zod";
import { optNumeric, optStr, optUnknownArray, reqStr } from "./common";

// Money (`value`) is coerced server-side (toMoney) with no range clamp, and
// status/stage are never taken from the body, so no numeric range or status
// field appears here. `expected_close_at` accepts a string/""/null; the service
// does the actual date-parse + BadRequest on an unparseable value.

export const createPipelineSchema = z.object({
  // Stages are fixed platform-wide (DEAL_STAGES); only the name is accepted.
  name: reqStr("name"),
});

export const createDealSchema = z.object({
  title: reqStr("title"),
  value: optNumeric,
  owner_id: optStr,
  lead_id: optStr,
  account_id: optStr,
  contact_id: optStr,
  pipeline_id: optStr,
  stage_id: optStr,
  expected_close_at: optStr,
  competitors: optUnknownArray,
  stakeholders: optUnknownArray,
});

export const updateDealSchema = z.object({
  title: optStr,
  value: optNumeric,
  owner_id: optStr,
  expected_close_at: optStr,
  competitors: optUnknownArray,
  stakeholders: optUnknownArray,
});

// NOTE camelCase `stageId` here (create/update use snake_case), intentional,
// matches the existing move endpoint contract.
export const moveDealSchema = z.object({
  stageId: reqStr("stageId"),
});

export const loseDealSchema = z.object({
  reason: optStr,
});
