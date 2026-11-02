import { Request, Response } from "express";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import { verifyUnsubToken } from "../utils/unsubscribe";

// Public (unauthenticated) unsubscribe handler for the List-Unsubscribe header.
// GET serves a confirmation page; POST is the RFC 8058 one-click form post.
// Both verify the signed token and add a MARKETING suppression.
export const unsubscribe = async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query.token ?? (req.body as { token?: string })?.token ?? "");
  const payload = verifyUnsubToken(token);

  if (!payload) {
    res.status(400).send("Invalid or expired unsubscribe link.");
    return;
  }

  await emailSuppressionsRepository.add(
    payload.tenantId,
    payload.email,
    "MANUAL_UNSUBSCRIBE",
    "MARKETING"
  );

  if (req.method === "POST") {
    res.status(200).json({ success: true });
    return;
  }
  res
    .status(200)
    .send(
      `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
        `<h2>You're unsubscribed</h2>` +
        `<p>${payload.email} will no longer receive marketing emails.</p>` +
        `</body></html>`
    );
};
