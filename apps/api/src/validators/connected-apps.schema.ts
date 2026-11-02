import { z } from "zod";
import { APP_ENVIRONMENTS, APP_STATUSES, CATALOG_MODES, KEY_SCOPES } from "../constants/connected-apps.const";
import { EVENT_CATEGORIES, REVIEW_STATUSES } from "../constants/semantic-events.const";
import { optStr, optStrArray, reqStr } from "./common";

// Booleans only, and only the keys we know about. Unknown keys are dropped
// rather than rejected, so a newer client sending a capability this build has
// not shipped yet degrades instead of 400-ing.
const capabilitiesSchema = z
  .object({
    catalog: z.boolean().optional(),
    events: z.boolean().optional(),
    identity: z.boolean().optional(),
    deeplink: z.boolean().optional(),
    outbound: z.boolean().optional(),
    actions: z.boolean().optional(),
  })
  .nullish();

export const createConnectedAppSchema = z.object({
  name: reqStr("Product name"),
  // Derived from the name when omitted; still validated when supplied because
  // the key is permanent and appears in every producer's payloads.
  key: optStr,
  description: optStr,
  logo_url: optStr,
  product_url: optStr,
  environment: z.enum(APP_ENVIRONMENTS).nullish(),
  capabilities: capabilitiesSchema,
  catalog_mode: z.enum(CATALOG_MODES).nullish(),
  catalog_pull_url: optStr,
  actions_url: optStr,
  allowed_origins: optStrArray,
});

export const updateConnectedAppSchema = z.object({
  name: optStr,
  description: optStr,
  logo_url: optStr,
  product_url: optStr,
  status: z.enum(APP_STATUSES).nullish(),
  environment: z.enum(APP_ENVIRONMENTS).nullish(),
  capabilities: capabilitiesSchema,
  catalog_mode: z.enum(CATALOG_MODES).nullish(),
  catalog_pull_url: optStr,
  actions_url: optStr,
  allowed_origins: optStrArray,
});

export const createAppKeySchema = z.object({
  name: optStr,
  scope: z.enum(KEY_SCOPES).nullish(),
});

export const updateEventDefinitionSchema = z.object({
  label: optStr,
  description: optStr,
  icon: optStr,
  category: z.enum(EVENT_CATEGORIES).nullish(),
  // Range is enforced in the service so the error names the real constraint.
  intent_weight: z.union([z.number(), z.string()]).nullish(),
  is_high_intent: z.boolean().nullish(),
  review_status: z.enum(REVIEW_STATUSES).nullish(),
});
