import emailDomainsRepository from "../repositories/email-domains.repository";
import logger from "../utils/logger";
import inboundService from "./inbound.service";

// Parse "Display Name <email@example.com>" (or a bare address) into name + email.
const parseAddress = (raw: string): { name: string; email: string } => {
  const s = String(raw || "").trim();
  const angle = s.match(/^(.*?)<([^>]+)>$/);
  if (angle) return { name: angle[1].replace(/["']/g, "").trim(), email: angle[2].trim() };
  return { name: "", email: s };
};

const domainOf = (email: string): string => (email.split("@")[1] ?? "").toLowerCase();

// Best-effort plain-text body extraction from a raw MIME email, good enough for
// simple text replies. (For rich/multipart mail a full MIME parser can be
// swapped in here; the from/subject already come reliably from SES headers.)
const extractBody = (raw: string): string => {
  if (!raw) return "";
  let text = raw;
  // Prefer the text/plain part of a multipart message.
  const plainIdx = raw.search(/content-type:\s*text\/plain/i);
  if (plainIdx >= 0) text = raw.slice(plainIdx);
  // Drop that part's own headers (up to the first blank line).
  const blankRn = text.indexOf("\r\n\r\n");
  const blankN = text.indexOf("\n\n");
  const start = blankRn >= 0 ? blankRn + 4 : blankN >= 0 ? blankN + 2 : 0;
  let body = text.slice(start);
  // Cut at the next MIME boundary, if any.
  const boundary = body.search(/\r?\n--[-_A-Za-z0-9]+/);
  if (boundary >= 0) body = body.slice(0, boundary);
  // Minimal quoted-printable decode.
  body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  return body.trim().slice(0, 8000);
};

interface SesReceived {
  notificationType?: string;
  content?: string;
  mail?: {
    source?: string;
    destination?: string[];
    commonHeaders?: { from?: string[]; to?: string[]; subject?: string; messageId?: string };
  };
}

// Handles an inbound-email SQS message (SNS-wrapped SES "Received" notification):
// resolves the tenant from the recipient domain, then ingests it into the inbox.
class EmailInboundService {
  async processRaw(body: string): Promise<void> {
    let payload: SesReceived & { Type?: string; Message?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      logger.warn("email inbound: unparseable body");
      return;
    }
    // Unwrap the SNS envelope.
    if (payload.Type === "Notification" && typeof payload.Message === "string") {
      payload = JSON.parse(payload.Message);
    }
    if (payload.notificationType !== "Received" || !payload.mail) return;

    const mail = payload.mail;
    const headers = mail.commonHeaders ?? {};

    // Recipient domain -> tenant.
    const recipient = mail.destination?.[0] ?? headers.to?.[0] ?? "";
    const domain = domainOf(parseAddress(recipient).email);
    if (!domain) return;
    const tenantId = await emailDomainsRepository.tenantBySubdomain(domain);
    if (!tenantId) {
      logger.warn(`email inbound: no tenant for domain ${domain}`);
      return;
    }

    const sender = parseAddress(mail.source ?? headers.from?.[0] ?? "");
    if (!sender.email) return;

    await inboundService.ingest({
      tenantId,
      channel: "EMAIL",
      from: sender.email,
      name: sender.name || undefined,
      body: extractBody(payload.content ?? ""),
      subject: headers.subject || "(no subject)",
      externalId: headers.messageId ?? null,
    });
  }
}

export default new EmailInboundService();
