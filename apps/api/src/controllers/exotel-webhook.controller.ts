import { Request, Response } from "express";
import exotelWebhookService from "../services/exotel-webhook.service";
import logger from "../utils/logger";

// Public Exotel callbacks, authenticated only by the per-tenant URL token.
// Two rules govern everything here:
//   1. Never leak anything: unknown token = a bare 404, errors = logs only.
//   2. Answer fast: the Connect dynamic URL has a 5-second budget and holds a
//      live caller; Passthru/StatusCallback get an immediate 200 with the real
//      work running after the response (the wa-webhook idiom).

const asStringRecord = (q: Request["query"]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(q)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
  }
  return out;
};

// GET /:token/route, the Connect applet asks who to dial for this attempt.
export const routeExotelCall = async (req: Request, res: Response) => {
  const cfg = await exotelWebhookService.configForToken(String(req.params.token ?? ""));
  if (!cfg) {
    res.status(404).send("Not found");
    return;
  }
  try {
    const body = await exotelWebhookService.routeCall(cfg, asStringRecord(req.query));
    res.status(200).json(body);
  } catch (err) {
    // A routing failure must degrade to "didn't dial anyone" (the flow's
    // voicemail branch), never to a hung caller waiting on a 500.
    logger.warn(`exotel route webhook: ${String(err)}`);
    res.status(200).json({ fetch_after_attempt: false, destination: { numbers: [] } });
  }
};

// GET /:token/status, Passthru applet at the end of the inbound flow.
export const receiveExotelPassthru = async (req: Request, res: Response) => {
  const cfg = await exotelWebhookService.configForToken(String(req.params.token ?? ""));
  if (!cfg) {
    res.status(404).send("Not found");
    return;
  }
  res.status(200).send("OK");
  void exotelWebhookService
    .finalizeInbound(cfg, asStringRecord(req.query))
    .catch((err) => logger.warn(`exotel passthru webhook: ${String(err)}`));
};

// POST /:token/callback, StatusCallback for API-placed outbound calls.
export const receiveExotelStatusCallback = async (req: Request, res: Response) => {
  const cfg = await exotelWebhookService.configForToken(String(req.params.token ?? ""));
  if (!cfg) {
    res.status(404).send("Not found");
    return;
  }
  res.status(200).send("OK");
  const body =
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  void exotelWebhookService
    .applyOutboundStatus(cfg, body)
    .catch((err) => logger.warn(`exotel status callback: ${String(err)}`));
};
