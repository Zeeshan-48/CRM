import nodemailer, { type Transporter } from "nodemailer";
import config from "../config";
import logger from "../utils/logger";

export interface SmtpSendParams {
  from?: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string> | Array<{ name: string; value: string }>;
}

export interface SmtpSendResult {
  messageId: string;
  provider: "SMTP";
}

class SmtpClient {
  private transporter: Transporter | null = null;

  isConfigured(): boolean {
    const underTest = config.NODE_ENV === "test" || process.env.VITEST === "true";
    return Boolean(config.SMTP_USER && config.SMTP_PASS) && !underTest;
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASS.replace(/\s+/g, ""),
        },
      });
    }
    return this.transporter;
  }

  async sendEmail(params: SmtpSendParams): Promise<SmtpSendResult> {
    if (!this.isConfigured()) {
      throw new Error("SMTP is not configured (SMTP_USER or SMTP_PASS missing)");
    }

    const fromAddress =
      params.from ||
      (config.SMTP_FROM_NAME
        ? `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM_EMAIL || config.SMTP_USER}>`
        : config.SMTP_FROM_EMAIL || config.SMTP_USER);

    const toAddresses = Array.isArray(params.to) ? params.to.join(", ") : params.to;

    let headersObj: Record<string, string> | undefined;
    if (params.headers) {
      if (Array.isArray(params.headers)) {
        headersObj = {};
        for (const h of params.headers) {
          headersObj[h.name] = h.value;
        }
      } else {
        headersObj = params.headers;
      }
    }

    const transport = this.getTransporter();
    const info = await transport.sendMail({
      from: fromAddress,
      to: toAddresses,
      subject: params.subject,
      text: params.text,
      html: params.html || undefined,
      replyTo: params.replyTo || undefined,
      headers: headersObj,
    });

    logger.info(`[SMTP] Email sent to ${toAddresses} (id: ${info.messageId})`);
    return {
      messageId: info.messageId,
      provider: "SMTP",
    };
  }
}

export const smtpClient = new SmtpClient();
export default smtpClient;

