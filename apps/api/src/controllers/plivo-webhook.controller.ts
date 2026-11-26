import { Request, Response } from "express";
import config from "../config";
import { db } from "../db/connection";
import plivoWebhookService from "../services/plivo-webhook.service";
import logger from "../utils/logger";

const E164_REGEX = /^\+[1-9]\d{6,14}$/;
const SAFE_DIAL_REGEX = /^\+?[1-9]\d{6,14}$/;

export const handlePlivoAnswer = async (req: Request, res: Response) => {
  let callId = String(
    req.query.callId ||
      req.body?.callId ||
      req.body?.["X-PH-callId"] ||
      req.body?.["SIP-H-X-PH-callId"] ||
      req.headers?.["x-ph-callid"] ||
      req.headers?.["sip-h-x-ph-callid"] ||
      ""
  ).trim();

  const auth = await plivoWebhookService.authenticateWebhook(req, callId);
  if (!auth.ok) {
    res.status(auth.statusCode).send(auth.message ?? "Unauthorized");
    return;
  }

  const cfg = auth.cfg;
  const token = auth.resolvedToken;

  // When dialed from WebRTC softphone or bridge, destination phone is in To or query leadPhone
  let leadPhone = String(
    req.query.leadPhone ||
      req.body?.To ||
      req.query?.To ||
      req.body?.Destination ||
      req.query?.Destination ||
      req.body?.leadPhone ||
      ""
  ).trim();

  // Strip SIP URI prefix/domain if present (e.g. sip:+919876543210@example.com)
  if (leadPhone.startsWith("sip:")) {
    leadPhone = leadPhone.replace(/^sip:/, "").split("@")[0];
  }
  // Format Indian mobile numbers into E.164 if entered as 10 digits
  if (/^\d{10}$/.test(leadPhone)) {
    leadPhone = `+91${leadPhone}`;
  } else if (/^91\d{10}$/.test(leadPhone)) {
    leadPhone = `+${leadPhone}`;
  } else if (!leadPhone.startsWith("+") && /^\d+$/.test(leadPhone)) {
    leadPhone = `+${leadPhone}`;
  }

  // Fallback 1: If callId was provided, look up to_number from voice_calls if leadPhone was missing
  if (!leadPhone && callId) {
    let q = db
      .selectFrom("voice_calls")
      .select(["to_number"])
      .where("id", "=", callId);
    if (cfg?.tenant_id) q = q.where("tenant_id", "=", cfg.tenant_id);
    const callRow = await q.executeTakeFirst();
    if (callRow?.to_number) {
      leadPhone = callRow.to_number;
    }
  }

  // Fallback 2: match most recent queued call for this destination number if callId was not directly supplied
  if (!callId && leadPhone && SAFE_DIAL_REGEX.test(leadPhone)) {
    let q = db
      .selectFrom("voice_calls")
      .select(["id", "tenant_id"])
      .where("to_number", "=", leadPhone)
      .where("call_status", "=", "queued")
      .where("created_at", ">", new Date(Date.now() - 5 * 60 * 1000))
      .orderBy("created_at", "desc")
      .limit(1);
    if (cfg?.tenant_id) q = q.where("tenant_id", "=", cfg.tenant_id);
    const recentCall = await q.executeTakeFirst();
    if (recentCall) {
      callId = recentCall.id;
    }
  }

  const callUuid = String(req.body?.CallUUID ?? req.query?.CallUUID ?? "").trim();
  if (callId && callUuid) {
    let uq = db
      .updateTable("voice_calls")
      .set({
        external_call_id: callUuid,
        call_status: "in-progress",
        updated_at: new Date(),
      })
      .where("id", "=", callId);
    if (cfg?.tenant_id) uq = uq.where("tenant_id", "=", cfg.tenant_id);
    await uq.execute();
  }

  if (!SAFE_DIAL_REGEX.test(leadPhone)) {
    res.setHeader("Content-Type", "application/xml");
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<Response />');
    return;
  }

  // Caller ID shown to recipient MUST be a valid purchased/verified E.164 phone number,
  // NEVER a SIP endpoint username (like agent123) which telecom carriers reject!
  let callerId = String(
    req.query.callerId ||
      req.body?.["X-PH-callerId"] ||
      req.body?.["SIP-H-X-PH-callerId"] ||
      req.headers?.["x-ph-callerid"] ||
      req.headers?.["sip-h-x-ph-callerid"] ||
      cfg?.from_number ||
      config.PLIVO_DEFAULT_FROM_NUMBER ||
      ""
  ).trim();

  if (!E164_REGEX.test(callerId)) {
    callerId = config.PLIVO_DEFAULT_FROM_NUMBER || "";
  }

  // Dynamically derive publicBase URL from the incoming request host (works across tunnel reconnects)
  const host = req.get("x-forwarded-host") || req.get("host");
  const proto = req.get("x-forwarded-proto") || (req.secure ? "https" : "http");
  const publicBase =
    host && !host.includes("localhost") && !host.includes("127.0.0.1")
      ? `${proto}://${host}`
      : config.APP_PUBLIC_URL || `${proto}://${host || "localhost"}`;

  const hangupUrl = `${publicBase}/api/v1/telephony/webhooks/plivo/${encodeURIComponent(token)}/hangup?callId=${encodeURIComponent(callId)}`;
  const recordingUrl = `${publicBase}/api/v1/telephony/webhooks/plivo/${encodeURIComponent(token)}/recording?callId=${encodeURIComponent(callId)}`;

  const xml = plivoWebhookService.generateAnswerXml({
    callerId,
    leadPhone,
    hangupUrl,
    recordingUrl,
  });

  logger.info(
    `[plivo-webhook] Answer XML generated: callerId=${callerId}, leadPhone=${leadPhone}, callUuid=${callUuid}, callId=${callId}`
  );

  res.setHeader("Content-Type", "application/xml");
  res.status(200).send(xml);
};

export const handlePlivoHangup = async (req: Request, res: Response) => {
  const callId = String(
    req.query.callId ||
      req.body?.callId ||
      req.body?.["X-PH-callId"] ||
      req.body?.["SIP-H-X-PH-callId"] ||
      ""
  ).trim();

  const auth = await plivoWebhookService.authenticateWebhook(req, callId);
  if (!auth.ok) {
    res.status(auth.statusCode).send(auth.message ?? "Unauthorized");
    return;
  }

  res.status(200).send("OK");

  const payload = { ...req.query, ...req.body };

  void plivoWebhookService
    .handleHangup(auth.cfg, payload, callId)
    .catch((err) => logger.warn(`plivo hangup error: ${String(err)}`));
};

export const handlePlivoRecording = async (req: Request, res: Response) => {
  const callId = String(
    req.query.callId ||
      req.body?.callId ||
      req.body?.["X-PH-callId"] ||
      req.body?.["SIP-H-X-PH-callId"] ||
      ""
  ).trim();

  const auth = await plivoWebhookService.authenticateWebhook(req, callId);
  if (!auth.ok) {
    res.status(auth.statusCode).send(auth.message ?? "Unauthorized");
    return;
  }

  res.status(200).send("OK");

  const payload = { ...req.query, ...req.body };

  void plivoWebhookService
    .handleRecording(auth.cfg, payload, callId)
    .catch((err) => logger.warn(`plivo recording error: ${String(err)}`));
};
