import { sesClientOptions, sesConfigured } from "../utils/aws";
import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SendEmailCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2";
import config from "../config";
import logger from "../utils/logger";

export interface IdentityStatus {
  dkimStatus: string | null;
  mailFromStatus: string | null;
}

export interface SesSendParams {
  from: string;
  to: string;
  subject: string;
  text: string;
  // Optional HTML alternative. When present SES sends multipart/alternative
  // (HTML preferred, `text` as the plain-text fallback for non-HTML clients).
  html?: string | null;
  replyTo?: string | null;
  configurationSetName?: string | null;
  tags?: Array<{ name: string; value: string }>;
  headers?: Array<{ name: string; value: string }>;
}

export interface SesSendResult {
  messageId: string;
  provider: "SES" | "SIMULATED";
}

const isAlreadyExists = (err: unknown): boolean =>
  err instanceof Error &&
  (err.name === "AlreadyExistsException" || /already exists/i.test(err.message));

// Deterministic fake DKIM tokens so the onboarding flow (and tests) render a
// DNS table without touching AWS when SES is not keyed / under test.
const simulatedDkimTokens = (subdomain: string): string[] => {
  let h = 0;
  for (let i = 0; i < subdomain.length; i++) h = (h * 31 + subdomain.charCodeAt(i)) >>> 0;
  return [0, 1, 2].map((n) => `sim${(h + n * 7919).toString(36)}`.padEnd(12, "0").slice(0, 12));
};

// SESv2 wrapper for per-tenant identity + configuration-set management. Live
// only when SES is keyed and not under test; otherwise simulates so the whole
// onboard/verify flow is usable and testable offline.
class EmailSesClient {
  private ses: SESv2Client | null = null;

  constructor() {
    const keyed = sesConfigured();
    const underTest = config.NODE_ENV === "test" || process.env.VITEST === "true";
    if (keyed && !underTest) {
      this.ses = new SESv2Client(sesClientOptions(config.AWS_SES_REGION));
      logger.info("Email domains: SESv2 driver enabled");
    } else {
      logger.info(`Email domains: simulated (${underTest ? "test mode" : "AWS_SES_FROM_EMAIL unset"})`);
    }
  }

  isLive(): boolean {
    return this.ses !== null;
  }

  // Per-tenant config set wired to the SNS event topic (idempotent).
  async ensureConfigurationSet(tenantId: string): Promise<string> {
    const name = `email-tenant-${tenantId}`;
    if (!this.ses) return name;

    try {
      await this.ses.send(
        new CreateConfigurationSetCommand({
          ConfigurationSetName: name,
          ReputationOptions: { ReputationMetricsEnabled: true },
          SendingOptions: { SendingEnabled: true },
        })
      );
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }

    if (config.SES_EVENTS_SNS_TOPIC_ARN) {
      try {
        await this.ses.send(
          new CreateConfigurationSetEventDestinationCommand({
            ConfigurationSetName: name,
            EventDestinationName: "sns-fanout",
            EventDestination: {
              Enabled: true,
              MatchingEventTypes: [
                "SEND",
                "DELIVERY",
                "BOUNCE",
                "COMPLAINT",
                "REJECT",
                "OPEN",
                "CLICK",
              ],
              SnsDestination: { TopicArn: config.SES_EVENTS_SNS_TOPIC_ARN },
            },
          })
        );
      } catch (err) {
        if (!isAlreadyExists(err)) throw err;
      }
    }
    return name;
  }

  // Create the domain identity; returns DKIM CNAME tokens (usually 3).
  async createIdentity(params: {
    subdomain: string;
    configSet: string;
    tenantId: string;
  }): Promise<string[]> {
    if (!this.ses) return simulatedDkimTokens(params.subdomain);
    try {
      const created = await this.ses.send(
        new CreateEmailIdentityCommand({
          EmailIdentity: params.subdomain,
          DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
          ConfigurationSetName: params.configSet,
          Tags: [{ Key: "tenantId", Value: params.tenantId }],
        })
      );
      return created.DkimAttributes?.Tokens ?? [];
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      // Identity already exists in SES: reuse its current DKIM tokens.
      const existing = await this.ses.send(
        new GetEmailIdentityCommand({ EmailIdentity: params.subdomain })
      );
      return existing.DkimAttributes?.Tokens ?? [];
    }
  }

  // Unified low-level send used by the mailer for both the custom-domain and
  // legacy platform-default paths. Simulated when SES is not keyed / under test.
  async sendEmail(params: SesSendParams): Promise<SesSendResult> {
    if (!this.ses) {
      return { messageId: `sim_${Date.now()}_${params.to}`, provider: "SIMULATED" };
    }
    const result = await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: params.from,
        Destination: { ToAddresses: [params.to] },
        ReplyToAddresses: params.replyTo ? [params.replyTo] : undefined,
        ConfigurationSetName: params.configurationSetName ?? undefined,
        EmailTags: params.tags?.map((t) => ({ Name: t.name, Value: t.value })),
        Content: {
          Simple: {
            Subject: { Data: params.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: params.text, Charset: "UTF-8" },
              ...(params.html
                ? { Html: { Data: params.html, Charset: "UTF-8" } }
                : {}),
            },
            Headers: params.headers?.map((h) => ({ Name: h.name, Value: h.value })),
          },
        },
      })
    );
    return { messageId: result.MessageId ?? "", provider: "SES" };
  }

  async putMailFrom(subdomain: string, mailFromDomain: string): Promise<void> {
    if (!this.ses) return;
    await this.ses.send(
      new PutEmailIdentityMailFromAttributesCommand({
        EmailIdentity: subdomain,
        MailFromDomain: mailFromDomain,
        BehaviorOnMxFailure: "REJECT_MESSAGE",
      })
    );
  }

  async getIdentity(subdomain: string): Promise<IdentityStatus> {
    if (!this.ses) return { dkimStatus: "PENDING", mailFromStatus: "PENDING" };
    const id = await this.ses.send(new GetEmailIdentityCommand({ EmailIdentity: subdomain }));
    return {
      dkimStatus: id.DkimAttributes?.Status ?? null,
      mailFromStatus: id.MailFromAttributes?.MailFromDomainStatus ?? null,
    };
  }

  async deleteIdentity(subdomain: string): Promise<void> {
    if (!this.ses) return;
    try {
      await this.ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: subdomain }));
    } catch (err) {
      // A missing identity is fine on teardown.
      if (!(err instanceof Error && /not.?found/i.test(err.message))) throw err;
    }
  }
}

export default new EmailSesClient();
