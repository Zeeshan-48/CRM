import type { channel as ChannelEnum } from "../db/enums";
import inboundRepository from "../repositories/inbound.repository";
import logger from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import agentsService from "./agents.service";
import engineService from "./engine.service";

export interface IngestParams {
  tenantId: string;
  channel: ChannelEnum;
  // The sender's phone (WhatsApp) or email address.
  from: string;
  // The sender's display name, if the provider gave one.
  name?: string;
  body: string;
  subject?: string;
  // The provider's message id (wamid / email id), dedup + status correlation.
  externalId?: string | null;
}

export interface IngestResult {
  deduped: boolean;
  messageId: string | null;
  leadId?: string | null;
  contactId?: string | null;
  createdLead?: boolean;
}

const channelSource = (channel: ChannelEnum): string =>
  channel.charAt(0) + channel.slice(1).toLowerCase();

// Channel-agnostic inbound ingestion: matches the sender to a lead/contact
// (creating a lead when unknown), records the message on the unified inbox, and
// dedups on the provider message id. Used by the WhatsApp webhook and the email
// inbound consumer alike.
class InboundService {
  async ingest(params: IngestParams): Promise<IngestResult> {
    // Dedup: providers redeliver webhooks/events.
    if (params.externalId) {
      const existing = await inboundRepository.findMessageByExternalId(
        params.tenantId,
        params.externalId
      );
      if (existing) return { deduped: true, messageId: existing.id };
    }

    const sender = await this.resolveSender(
      params.tenantId,
      params.channel,
      params.from,
      params.name
    );

    const message = await engineService.sendMessage({
      tenantId: params.tenantId,
      channel: params.channel,
      ref: {
        leadId: sender.leadId ?? null,
        contactId: sender.contactId ?? null,
        subject: params.subject || channelSource(params.channel),
      },
      direction: "INBOUND",
      body: params.body,
      simulated: false,
      externalId: params.externalId ?? null,
      status: "received",
    });

    // If this lead is in an active sales sequence, their reply pauses it and
    // drafts a contextual response for review (best-effort; never blocks ingest).
    if (sender.leadId) {
      void agentsService
        .handleInboundReply(params.tenantId, sender.leadId, params.body)
        .catch((err) => logger.warn(`sales reply handler failed: ${String(err)}`));
    }

    return {
      deduped: false,
      messageId: message.id,
      leadId: sender.leadId ?? null,
      contactId: sender.contactId ?? null,
      createdLead: sender.created,
    };
  }

  // Applies a provider delivery/read status to the matching outbound message.
  // `detail` carries Meta's failure reason (only present when status is "failed")
  // so an accepted-but-undelivered send can be diagnosed from the logs.
  async applyStatus(
    tenantId: string,
    externalId: string,
    status: string,
    detail?: string
  ): Promise<void> {
    if (!externalId || !status) return;
    if (status === "failed" && detail) {
      logger.warn(`WA delivery failed (tenant ${tenantId}) ${externalId}: ${detail}`);
    }
    await inboundRepository.updateMessageStatus(tenantId, externalId, status);
  }

  private async resolveSender(
    tenantId: string,
    channel: ChannelEnum,
    from: string,
    name?: string
  ): Promise<{ leadId?: string; contactId?: string; created: boolean }> {
    if (channel === "EMAIL") {
      const email = from.trim().toLowerCase();
      const lead = await inboundRepository.leadByEmail(tenantId, email);
      if (lead) return { leadId: lead.id, created: false };
      const contact = await inboundRepository.contactByEmail(tenantId, email);
      if (contact) return { contactId: contact.id, created: false };
      const created = await inboundRepository.createLead({
        tenant_id: tenantId,
        name: name || email,
        email,
        phone: null,
        source: "Email",
      });
      return { leadId: created.id, created: true };
    }

    // Phone-based channels (WhatsApp, SMS, …). Match how leads store phones.
    const phone = normalizePhone(from);
    const lead = await inboundRepository.leadByPhone(tenantId, phone);
    if (lead) return { leadId: lead.id, created: false };
    const contact = await inboundRepository.contactByPhone(tenantId, phone);
    if (contact) return { contactId: contact.id, created: false };
    const created = await inboundRepository.createLead({
      tenant_id: tenantId,
      name: name || phone,
      email: null,
      phone,
      source: channelSource(channel),
    });
    return { leadId: created.id, created: true };
  }
}

export default new InboundService();
