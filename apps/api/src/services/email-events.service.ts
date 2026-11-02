import emailMessagesRepository from "../repositories/email-messages.repository";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import logger from "../utils/logger";
import reputationService from "./reputation.service";

// SES event JSON shape (config-set event publishing). Tag values are arrays.
interface SesMailTags {
  [key: string]: string[] | undefined;
}
interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; destination?: string[]; tags?: SesMailTags };
  bounce?: { bounceType?: string; bouncedRecipients?: Array<{ emailAddress?: string }> };
  complaint?: { complainedRecipients?: Array<{ emailAddress?: string }> };
}

const firstTag = (tags: SesMailTags | undefined, key: string): string | undefined => {
  const v = tags?.[key];
  return Array.isArray(v) ? v[0] : undefined;
};

// Maps an SES delivery/bounce/complaint/open/click event back to its
// email_messages row via the messageId mail tag and applies the update. All
// writes are idempotent so SQS at-least-once redelivery is safe.
class EmailEventsService {
  // Accepts the raw SQS message body, unwrapping an SNS envelope when raw
  // message delivery is not configured.
  async processRaw(body: string): Promise<void> {
    let payload: SesEvent & { Type?: string; Message?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      logger.warn("SES event: unparseable body");
      return;
    }
    if (payload.Type === "Notification" && typeof payload.Message === "string") {
      payload = JSON.parse(payload.Message);
    }
    await this.process(payload);
  }

  async process(event: SesEvent): Promise<void> {
    const type = event.eventType ?? event.notificationType;
    const tags = event.mail?.tags;
    const messageId = firstTag(tags, "messageId");
    const tenantId = firstTag(tags, "tenantId");
    if (!messageId) {
      logger.warn(`SES event ${type ?? "?"} without a messageId tag, skipping`);
      return;
    }

    switch (type) {
      case "Delivery":
        await emailMessagesRepository.markDelivered(messageId);
        break;
      case "Bounce":
        if (event.bounce?.bounceType === "Permanent") {
          const transitioned = await emailMessagesRepository.markBounced(messageId);
          await this.suppressRecipients(tenantId, event.bounce?.bouncedRecipients, "HARD_BOUNCE");
          if (transitioned && tenantId) {
            await reputationService.recordBounce(tenantId, messageId);
            await reputationService.evaluateAndApply(tenantId, "bounce");
          }
        }
        // Transient bounces: SES retries; metric only, no status change.
        break;
      case "Complaint": {
        const transitioned = await emailMessagesRepository.markComplained(messageId);
        await this.suppressRecipients(tenantId, event.complaint?.complainedRecipients, "COMPLAINT");
        if (transitioned && tenantId) {
          await reputationService.recordComplaint(tenantId, messageId);
          await reputationService.evaluateAndApply(tenantId, "complaint");
        }
        break;
      }
      case "Open":
        await emailMessagesRepository.markOpened(messageId);
        break;
      case "Click":
        await emailMessagesRepository.markClicked(messageId);
        break;
      case "Reject":
        await emailMessagesRepository.markRejected(messageId);
        break;
      case "Send":
      case "DeliveryDelay":
        break;
      default:
        logger.warn(`Unhandled SES event type: ${type}`);
    }
  }

  private async suppressRecipients(
    tenantId: string | undefined,
    recipients: Array<{ emailAddress?: string }> | undefined,
    reason: "HARD_BOUNCE" | "COMPLAINT"
  ): Promise<void> {
    if (!tenantId || !recipients) return;
    for (const r of recipients) {
      if (r.emailAddress) {
        await emailSuppressionsRepository.add(tenantId, r.emailAddress, reason, null);
      }
    }
  }
}

export default new EmailEventsService();
