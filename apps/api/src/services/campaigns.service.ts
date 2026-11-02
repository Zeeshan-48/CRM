import { campaign_status } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import campaignsRepository, { CampaignRow } from "../repositories/campaigns.repository";
import whatsappRepository from "../repositories/whatsapp.repository";
import logger from "../utils/logger";
import engineService from "./engine.service";
import mailerService from "./mailer.service";
import whatsappDeliveryService from "./whatsapp-delivery.service";

const CAMPAIGN_STATUSES = Object.values(campaign_status);

const firstName = (name?: string | null): string => (name || "there").split(" ")[0];

// campaigns.template_params is a jsonb array of strings (each may contain the
// {name} token). node-postgres returns jsonb already parsed, but tolerate a
// string too. Returns null when absent so callers fall back to legacy behaviour.
const parseTemplateParams = (raw: unknown): string[] | null => {
  let val = raw;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      return null;
    }
  }
  return Array.isArray(val) ? val.map((v) => String(v ?? "")) : null;
};

const withRoi = (campaign: CampaignRow) => {
  const cost = Number(campaign.cost);
  const revenue = Number(campaign.revenue);
  return {
    ...campaign,
    roi: cost > 0 ? Math.round(((revenue - cost) / cost) * 100) : 0,
    roas: cost ? +(revenue / cost).toFixed(2) : 0,
  };
};

const parseDate = (value: unknown, field: string): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${field} must be a valid date`);
  return date;
};

class CampaignsService {
  async list(tenantId: string) {
    const rows = await campaignsRepository.list(tenantId);

    // Real per-campaign WhatsApp delivery counts (from the status webhook),
    // attached to sent WhatsApp campaigns so the UI can show accepted vs
    // delivered vs failed instead of a flat "sent".
    const waSentIds = rows
      .filter((c) => c.channel.trim().toUpperCase() === "WHATSAPP" && c.sent_at)
      .map((c) => c.id);
    const statsById = await campaignsRepository.deliveryStats(tenantId, waSentIds);

    const campaigns = rows.map((c) => ({
      ...withRoi(c),
      delivery: statsById.get(c.id) ?? null,
    }));

    const totals = {
      cost: campaigns.reduce((s, c) => s + Number(c.cost), 0),
      revenue: campaigns.reduce((s, c) => s + Number(c.revenue), 0),
      leadsGenerated: campaigns.reduce((s, c) => s + Number(c.leads_generated), 0),
      roi: 0,
    };
    totals.roi = totals.cost
      ? Math.round(((totals.revenue - totals.cost) / totals.cost) * 100)
      : 0;

    return { campaigns, totals };
  }

  async detail(tenantId: string, campaignId: string) {
    const campaign = await campaignsRepository.findById(campaignId, tenantId);
    if (!campaign) throw new NotFoundError("Campaign not found");
    return withRoi(campaign);
  }

  async create(
    tenantId: string,
    actorId: string,
    body: {
      name?: string;
      channel?: string;
      cost?: number;
      revenue?: number;
      leadsGenerated?: number;
      status?: string;
      audienceTag?: string;
      subject?: string;
      body?: string;
      templateParams?: unknown;
      startAt?: string;
      endAt?: string;
    }
  ) {
    if (!body.name || !body.channel) throw new BadRequestError("name and channel required");

    let status: campaign_status | undefined;
    if (body.status !== undefined) {
      if (!CAMPAIGN_STATUSES.includes(body.status as campaign_status)) {
        throw new BadRequestError(`status must be one of ${CAMPAIGN_STATUSES.join(", ")}`);
      }
      status = body.status as campaign_status;
    }

    // WhatsApp business-initiated messages must use a pre-approved template
    // (Meta rejects free text outside the 24h service window). A WhatsApp
    // campaign therefore references an APPROVED template by key, carried in the
    // `subject` field (WhatsApp campaigns have no email subject).
    let templateParams: string[] | null = null;
    if (body.channel.trim().toUpperCase() === "WHATSAPP") {
      const key = body.subject?.trim();
      if (!key) {
        throw new BadRequestError("Select an approved WhatsApp template for this campaign");
      }
      const template = await whatsappRepository.findTemplateByKey(tenantId, key);
      if (!template || template.status !== "APPROVED") {
        throw new BadRequestError(
          "That WhatsApp template is not approved. WhatsApp campaigns must use a pre-approved template, create and sync one in WhatsApp settings first."
        );
      }
      // The template's {{1}}..{{n}} body variables. The client sends one value
      // per variable (each may contain the {name} token). Validate the count so
      // Meta doesn't reject the send for a parameter-count mismatch.
      const varCount = Number(template.variables) || 0;
      if (Array.isArray(body.templateParams)) {
        const provided = body.templateParams.map((v) => String(v ?? ""));
        if (provided.length !== varCount) {
          throw new BadRequestError(
            `This template has ${varCount} variable${varCount === 1 ? "" : "s"}, provide a value for each.`
          );
        }
        if (provided.some((v) => !v.trim())) {
          throw new BadRequestError("Every template variable needs a value (Meta rejects blanks).");
        }
        templateParams = provided;
      } else if (varCount > 0) {
        // Backwards-compatible default: first variable gets the recipient's name,
        // any remaining variables are left for the sender to fill explicitly.
        templateParams = Array.from({ length: varCount }, (_, i) => (i === 0 ? "{name}" : ""));
        if (varCount > 1) {
          throw new BadRequestError(
            `This template has ${varCount} variables, provide a value for each.`
          );
        }
      }
    }

    const campaign = await campaignsRepository.create({
      tenant_id: tenantId,
      name: body.name,
      channel: body.channel,
      cost: Number(body.cost) || 0,
      revenue: Number(body.revenue) || 0,
      leads_generated: Number(body.leadsGenerated) || 0,
      status,
      audience_tag: body.audienceTag?.trim() || null,
      subject: body.subject?.trim() || null,
      body: typeof body.body === "string" && body.body.trim() ? body.body : null,
      template_params: templateParams,
      start_at: parseDate(body.startAt, "startAt"),
      end_at: parseDate(body.endAt, "endAt"),
    });

    engineService.audit(tenantId, actorId, "campaign.created", "campaign", campaign.id, {
      channel: campaign.channel,
    });
    return withRoi(campaign);
  }

  // Bulk-send an EMAIL or WHATSAPP campaign to its audience (leads by tag, or all
  // leads). Explicit action only, ROI-only / ad-channel campaigns are never
  // auto-sent. Idempotent guard: a campaign can only be sent once.
  async send(tenantId: string, actorId: string, campaignId: string) {
    const campaign = await campaignsRepository.findById(campaignId, tenantId);
    if (!campaign) throw new NotFoundError("Campaign not found");
    if (campaign.sent_at) throw new BadRequestError("This campaign has already been sent");

    const channel = campaign.channel.trim().toUpperCase();
    if (channel !== "EMAIL" && channel !== "WHATSAPP") {
      throw new BadRequestError("Only Email or WhatsApp campaigns can be sent from here");
    }
    if (!campaign.body || !campaign.body.trim()) {
      throw new BadRequestError("Add message content before sending");
    }

    // For WhatsApp, the approved template key lives in `subject`. Older campaigns
    // (created before templates were required) fall back to the branded default.
    const waTemplateKey = channel === "WHATSAPP" ? campaign.subject?.trim() || "followup" : null;
    // The template's {{1}}..{{n}} values (each may hold the {name} token). Legacy
    // campaigns (null) fall back to a single first-name param.
    const templateParams = parseTemplateParams(campaign.template_params);

    const audience = await campaignsRepository.audienceLeads(tenantId, campaign.audience_tag);
    const recipients = audience.length;
    // `sent` = messages a provider really accepted; `simulated` = attempted but
    // not actually delivered (no SES/marketing sender, WhatsApp window, etc.);
    // `skipped` = recipients with no email/phone for this channel.
    let sent = 0;
    let simulated = 0;
    let skipped = 0;

    for (const lead of audience) {
      const fill = (s: string): string => s.replace(/{name}/g, firstName(lead.name));
      try {
        if (channel === "EMAIL") {
          if (!lead.email) {
            skipped++;
            continue;
          }
          const subject = fill(campaign.subject?.trim() || campaign.name);
          const text = fill(campaign.body);
          const delivery = await mailerService.send({
            tenantId,
            category: "MARKETING",
            to: lead.email,
            subject,
            text,
            idempotencyKey: `campaign_${campaign.id}_${lead.id}`,
          });
          const delivered = delivery.provider !== "SIMULATED";
          await engineService.sendMessage({
            tenantId,
            channel: "EMAIL",
            ref: { leadId: lead.id, subject },
            direction: "OUTBOUND",
            body: text,
            senderUserId: actorId,
            simulated: !delivered,
          });
          if (delivered) sent++;
          else simulated++;
        } else {
          if (!lead.phone) {
            skipped++;
            continue;
          }
          // Resolve each template variable for this lead ({name} -> first name).
          // Legacy campaigns with no stored params send just the first name.
          const bodyParams = (templateParams ?? ["{name}"]).map((p) => fill(p));
          // Record the actual rendered message: substitute {{1}}..{{n}} with the
          // resolved values so the inbox shows what the recipient received.
          let text = fill(campaign.body);
          bodyParams.forEach((value, i) => {
            text = text.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g"), value);
          });
          const delivery = await whatsappDeliveryService.deliver(tenantId, {
            leadId: lead.id,
            text,
            templateName: waTemplateKey ?? undefined,
            bodyParams,
          });
          await engineService.sendMessage({
            tenantId,
            channel: "WHATSAPP",
            ref: { leadId: lead.id, subject: "Campaign" },
            direction: "OUTBOUND",
            body: text,
            senderUserId: actorId,
            simulated: delivery.simulated,
            campaignId: campaign.id,
            // Store the wamid only for real accepts, so the status webhook can
            // correlate delivery/read/failed back to this campaign's messages.
            externalId: delivery.delivered ? delivery.messageId : null,
            status: delivery.delivered ? "sent" : delivery.error ? "failed" : null,
          });
          if (delivery.delivered) sent++;
          else simulated++;
        }
      } catch (err) {
        // One bad recipient never stops the campaign.
        logger.warn(`campaign ${campaign.id} send to lead ${lead.id}: ${String(err)}`);
      }
    }

    const updated = await campaignsRepository.recordSend(campaign.id, tenantId, { recipients, sent });
    engineService.audit(tenantId, actorId, "campaign.sent", "campaign", campaign.id, {
      channel,
      recipients,
      sent,
      simulated,
      skipped,
    });
    return { ...withRoi(updated ?? campaign), recipients, sent, simulated, skipped };
  }
}

export default new CampaignsService();
