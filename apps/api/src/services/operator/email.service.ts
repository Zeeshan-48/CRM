import { sesClientOptions, sesConfigured } from "../../utils/aws";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import config from "../../config";
import logger from "../../utils/logger";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  sent: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
}

// Email transport seam. When AWS SES keys + a verified from-address are present
// it sends for real via SESv2; otherwise it logs and skips so onboarding never
// fails on a missing email config. This method never throws.
class EmailService {
  private client: SESv2Client | null = null;

  isConfigured(): boolean {
    // Never sends from the test runner, like the tenant mail path.
    const underTest = config.NODE_ENV === "test" || process.env.VITEST === "true";
    return sesConfigured() && !underTest;
  }

  private getClient(): SESv2Client {
    if (!this.client) {
      this.client = new SESv2Client(sesClientOptions(config.AWS_SES_REGION));
    }
    return this.client;
  }

  private fromAddress(): string {
    const name = config.AWS_SES_FROM_NAME?.trim();
    const email = config.AWS_SES_FROM_EMAIL.trim();
    return name ? `${name} <${email}>` : email;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.isConfigured()) {
      logger.warn(
        `[email] SES not configured (set a verified AWS_SES_FROM_EMAIL); skipped email to ${input.to} "${input.subject}"`
      );
      return { sent: false, skipped: true };
    }

    try {
      const command = new SendEmailCommand({
        FromEmailAddress: this.fromAddress(),
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: input.html, Charset: "UTF-8" },
              Text: { Data: input.text, Charset: "UTF-8" },
            },
          },
        },
      });

      const out = await this.getClient().send(command);
      logger.info(
        `[email] sent to ${input.to} "${input.subject}" (messageId=${out.MessageId ?? "n/a"})`
      );
      return { sent: true, messageId: out.MessageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[email] failed to send to ${input.to} "${input.subject}": ${msg}`);
      return { sent: false, error: msg };
    }
  }
}

export default new EmailService();
