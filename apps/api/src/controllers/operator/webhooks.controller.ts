import { Request, Response } from "express";
import billingWebhookService from "../../services/operator/billing-webhook.service";

// The webhook routes use express.raw(), so req.body is a Buffer, verification
// needs the exact bytes. Fall back to re-stringifying only if a parser ran first.
const rawBody = (req: Request): string =>
  Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? {});

export const razorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const signature = String(req.header("x-razorpay-signature") ?? "");
  const status = await billingWebhookService.processRazorpay(rawBody(req), signature);
  res.status(status).send(status === 200 ? "ok" : "error");
};

export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const signature = String(req.header("stripe-signature") ?? "");
  const status = await billingWebhookService.processStripe(rawBody(req), signature);
  res.status(status).send(status === 200 ? "ok" : "error");
};
