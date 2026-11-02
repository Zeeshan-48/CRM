import { db } from "../db/connection";
import { channel as CHANNEL } from "../db/enums";
import type { channel as ChannelEnum } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import inboxRepository, { ConversationListRow } from "../repositories/inbox.repository";
import logger from "../utils/logger";
import engineService from "./engine.service";
import mailerService from "./mailer.service";
import whatsappDeliveryService from "./whatsapp-delivery.service";

const CHANNELS = Object.values(CHANNEL);

const isChannel = (value: string): value is ChannelEnum =>
  (CHANNELS as readonly string[]).includes(value);

const who = (c: ConversationListRow) =>
  c.lead_id
    ? { id: c.lead_id, name: c.lead_name, email: c.lead_email, phone: c.lead_phone }
    : c.contact_id
      ? {
          id: c.contact_id,
          name: c.contact_name,
          email: c.contact_email,
          phone: c.contact_phone,
        }
      : null;

class InboxService {
  async overview(tenantId: string, channelFilter?: string) {
    let channel: ChannelEnum | undefined;
    if (channelFilter) {
      const normalized = channelFilter.toUpperCase();
      if (!isChannel(normalized)) {
        throw new BadRequestError(`channel must be one of ${CHANNELS.join(", ")}`);
      }
      channel = normalized;
    }

    const [summary, conversations] = await Promise.all([
      inboxRepository.channelSummary(tenantId),
      inboxRepository.listConversations(tenantId, channel),
    ]);

    const byChannel = new Map(summary.map((row) => [row.channel, row]));
    const channels = CHANNELS.map((ch) => ({
      channel: ch,
      conversations: byChannel.get(ch)?.conversations ?? 0,
      unread: byChannel.get(ch)?.unread ?? 0,
    }));

    return {
      channels,
      conversations: conversations.map((c) => ({ ...c, who: who(c) })),
    };
  }

  async detail(tenantId: string, conversationId: string) {
    const conv = await inboxRepository.findConversation(conversationId, tenantId);
    if (!conv) throw new NotFoundError("Conversation not found");
    const messages = await inboxRepository.listMessages(tenantId, conversationId);
    await inboxRepository.resetUnread(conversationId, tenantId);
    return { ...conv, unread_count: 0, who: who(conv), messages };
  }

  async send(
    tenantId: string,
    actorId: string,
    conversationId: string,
    body: { body?: string }
  ) {
    const conv = await inboxRepository.findConversation(conversationId, tenantId);
    if (!conv) throw new NotFoundError("Conversation not found");
    const text = (body.body ?? "").trim();
    if (!text) throw new BadRequestError("Message body required");

    // EMAIL replies go over SES; WHATSAPP replies go over the Meta Cloud API
    // (session message, the thread is an open conversation). Other channels
    // have no real transport yet and are recorded as simulated. The send is
    // best-effort so a transport hiccup never loses the reply from the thread.
    let simulated = true;
    let externalId: string | null = null;
    let status: string | undefined;
    if (conv.channel === "EMAIL") {
      const to = await engineService.recipientEmail(tenantId, {
        leadId: conv.lead_id,
        contactId: conv.contact_id,
      });
      if (!to) throw new BadRequestError("Recipient has no email address");
      try {
        const delivery = await mailerService.send({
          tenantId,
          category: "NOTIFICATION",
          to,
          subject: conv.subject || "(no subject)",
          text,
        });
        simulated = delivery.provider === "SIMULATED";
        externalId = delivery.messageId || null;
      } catch (err) {
        logger.warn(`inbox EMAIL transport failed: ${String(err)}`);
      }
    } else if (conv.channel === "WHATSAPP") {
      try {
        const delivery = await whatsappDeliveryService.deliver(tenantId, {
          leadId: conv.lead_id,
          contactId: conv.contact_id,
          text,
        });
        simulated = delivery.simulated;
        externalId = delivery.messageId;
        status = delivery.delivered ? "sent" : delivery.error ? "failed" : undefined;
      } catch (err) {
        logger.warn(`inbox WHATSAPP transport failed: ${String(err)}`);
      }
    }

    return engineService.sendMessage({
      tenantId,
      channel: conv.channel,
      ref: { leadId: conv.lead_id, contactId: conv.contact_id, subject: conv.subject },
      direction: "OUTBOUND",
      body: text,
      senderUserId: actorId,
      simulated,
      externalId,
      status,
    });
  }

  async simulateInbound(
    tenantId: string,
    body: { channel?: string; leadId?: string; contactId?: string; body?: string }
  ) {
    const text = (body.body ?? "").trim();
    if (!body.channel || !text) throw new BadRequestError("channel and body required");
    const normalized = String(body.channel).toUpperCase();
    if (!isChannel(normalized)) {
      throw new BadRequestError(`channel must be one of ${CHANNELS.join(", ")}`);
    }

    if (body.leadId) {
      const lead = await db
        .selectFrom("leads")
        .select(["id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", body.leadId)
        .executeTakeFirst();
      if (!lead) throw new NotFoundError("Lead not found");
    }
    if (body.contactId) {
      const contact = await db
        .selectFrom("contacts")
        .select(["id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", body.contactId)
        .executeTakeFirst();
      if (!contact) throw new NotFoundError("Contact not found");
    }

    return engineService.sendMessage({
      tenantId,
      channel: normalized,
      ref: { leadId: body.leadId ?? null, contactId: body.contactId ?? null },
      direction: "INBOUND",
      body: text,
    });
  }
}

export default new InboxService();
