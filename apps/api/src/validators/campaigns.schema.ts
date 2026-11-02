import { z } from "zod";
import { optNumeric, optStr, reqStr } from "./common";

// `status` IS a strict 3-value enum; `channel` is deliberately free-form (ad
// channels like Google/Facebook/LinkedIn are valid ROI-only campaigns and must
// not be enum-restricted). templateParams stays a permissive optional array, // its count/blank/approval rules are stateful and stay in the service.
const CAMPAIGN_STATUS = ["ACTIVE", "PAUSED", "COMPLETED"] as const;

export const createCampaignSchema = z.object({
  name: reqStr("name"),
  channel: reqStr("channel"),
  cost: optNumeric,
  revenue: optNumeric,
  leadsGenerated: optNumeric,
  status: z.enum(CAMPAIGN_STATUS).optional(),
  audienceTag: optStr,
  subject: optStr,
  body: optStr,
  templateParams: z.array(z.string()).nullish(),
  startAt: optStr,
  endAt: optStr,
});

// POST /campaigns/:id/send takes no body, no schema needed.
