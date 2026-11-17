import { Request, Response } from "express";
import config from "../config";
import plivoWebhookService from "../services/plivo-webhook.service";
import logger from "../utils/logger";

export const handlePlivoAnswer = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  const cfg = await plivoWebhookService.configForToken(token);
  if (!cfg) {
    res.status(404).send("Not found");
    return;
  }

  const leadPhone = String(req.query.leadPhone ?? "");
  const callerId = String(req.query.callerId ?? cfg.from_number ?? "");
  const callId = String(req.query.callId ?? "");

  const hangupUrl = `${config.APP_PUBLIC_URL}/api/v1/telephony/webhooks/plivo/${token}/hangup?callId=${encodeURIComponent(callId)}`;
  const recordingUrl = `${config.APP_PUBLIC_URL}/api/v1/telephony/webhooks/plivo/${token}/recording?callId=${encodeURIComponent(callId)}`;

  const xml = plivoWebhookService.generateAnswerXml({
    callerId,
    leadPhone,
    hangupUrl,
    recordingUrl,
  });

  res.setHeader("Content-Type", "application/xml");
  res.status(200).send(xml);
};

export const handlePlivoHangup = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  const cfg = await plivoWebhookService.configForToken(token);
  if (!cfg) {
    res.status(404).send("Not found");
    return;
  }

  res.status(200).send("OK");

  const payload = { ...req.query, ...req.body };
  const callId = String(req.query.callId ?? "");

  void plivoWebhookService
    .handleHangup(cfg, payload, callId)
    .catch((err) => logger.warn(`plivo hangup error: ${String(err)}`));
};

export const handlePlivoRecording = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  const cfg = await plivoWebhookService.configForToken(token);
  if (!cfg) {
    res.status(404).send("Not found");
    return;
  }

  res.status(200).send("OK");

  const payload = { ...req.query, ...req.body };
  const callId = String(req.query.callId ?? "");

  void plivoWebhookService
    .handleRecording(cfg, payload, callId)
    .catch((err) => logger.warn(`plivo recording error: ${String(err)}`));
};

