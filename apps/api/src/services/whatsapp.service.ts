import { db } from "../db/connection";
import { wa_template_category as WA_CATEGORY } from "../db/enums";
import type { wa_template_category, wa_template_status } from "../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import whatsappConfigRepository from "../repositories/whatsapp-config.repository";
import whatsappRepository from "../repositories/whatsapp.repository";
import { decryptSecret } from "../utils/crypto";
import { ragSearch } from "./ai/heuristics";
import engineService from "./engine.service";
import whatsappClient from "./whatsapp.client";
import whatsappDeliveryService from "./whatsapp-delivery.service";

const firstName = (name?: string | null): string => (name || "there").split(" ")[0];

// Map Meta's template taxonomy onto our local enums.
const mapMetaStatus = (s: string): wa_template_status =>
  s === "APPROVED" ? "APPROVED" : s === "REJECTED" ? "REJECTED" : "PENDING";
const mapMetaCategory = (c: string): wa_template_category =>
  c === "MARKETING" ? "MARKETING" : "TRANSACTIONAL";

const FALLBACK_REPLY =
  "Thanks for your message! A specialist will get back to you shortly. Reply 1 to book a free demo.";

const inferAction = (question: string): string => {
  if (/demo|book/i.test(question)) return "book_demo";
  if (/price|pricing|cost/i.test(question)) return "send_pricing";
  if (/issue|problem|refund/i.test(question)) return "create_ticket";
  return "answer";
};

class WhatsappService {
  async listTemplates(tenantId: string) {
    return whatsappRepository.listTemplates(tenantId);
  }

  // Pull the tenant's approved templates from Meta (the "verified" ones they
  // created in the Meta dashboard) into whatsapp_templates, capturing each one's
  // language, status and body-variable count so sends are built correctly.
  async syncTemplates(tenantId: string, actorId: string) {
    const cfg = await whatsappConfigRepository.getConfig(tenantId);
    if (!cfg?.access_token_encrypted) {
      throw new BadRequestError("Connect WhatsApp first");
    }
    if (!cfg.waba_id) {
      throw new BadRequestError(
        "Add your WhatsApp Business Account (WABA) ID in WhatsApp settings to sync templates"
      );
    }
    let token: string;
    try {
      token = decryptSecret(cfg.access_token_encrypted);
    } catch {
      throw new BadRequestError("Stored token is unreadable, reconnect WhatsApp");
    }

    const templates = await whatsappClient.fetchTemplates(token, cfg.waba_id);
    const seenMetaIds: string[] = [];
    for (const t of templates) {
      if (!t.name) continue;
      if (t.metaId) seenMetaIds.push(t.metaId);
      await whatsappRepository.upsertMetaTemplate({
        tenant_id: tenantId,
        key: t.name,
        body: t.body || `(${t.name})`,
        category: mapMetaCategory(t.category),
        status: mapMetaStatus(t.status),
        language: t.language,
        variables: t.variables,
        meta_id: t.metaId,
      });
    }
    // Drop Meta-backed rows Meta no longer returns, so the synced set is real.
    // Local drafts (no meta_id) are left alone.
    const pruned = await whatsappRepository.pruneMetaTemplates(tenantId, seenMetaIds);
    engineService.audit(tenantId, actorId, "whatsapp.templates_synced", "tenant_whatsapp", cfg.id, {
      synced: templates.length,
      pruned,
    });
    return { synced: templates.length, pruned };
  }

  async deleteTemplate(tenantId: string, actorId: string, id: string) {
    const removed = await whatsappRepository.deleteTemplate(tenantId, id);
    if (!removed) throw new NotFoundError("Template not found");
    engineService.audit(tenantId, actorId, "whatsapp.template_deleted", "whatsapp_template", id, {});
    return { deleted: true };
  }

  async createTemplate(
    tenantId: string,
    actorId: string,
    body: { key?: string; body?: string; category?: string; status?: string }
  ) {
    const key = (body.key ?? "").trim();
    const text = (body.body ?? "").trim();
    if (!key || !text) throw new BadRequestError("key and body required");

    if (body.category && !(body.category in WA_CATEGORY)) {
      throw new BadRequestError(
        `category must be one of ${Object.values(WA_CATEGORY).join(", ")}`
      );
    }

    const existing = await whatsappRepository.findTemplateByKey(tenantId, key);
    if (existing) throw new ConflictError(`Template key "${key}" already exists`);

    // A template drafted here is NOT approved by Meta, status is always PENDING
    // until Meta approves it and a "Sync from Meta" attaches its meta_id. We
    // never trust a client-supplied approval status.
    const template = await whatsappRepository.createTemplate({
      tenant_id: tenantId,
      key,
      body: text,
      category: body.category as wa_template_category | undefined,
      status: "PENDING",
    });
    engineService.audit(tenantId, actorId, "whatsapp.template_created", "whatsapp_template", template.id, { key });
    return template;
  }

  async send(
    tenantId: string,
    actorId: string,
    body: { leadId?: string; contactId?: string; templateKey?: string; body?: string }
  ) {
    const target = await this.resolveTarget(tenantId, body.leadId, body.contactId);

    const usingTemplate = !body.body?.trim() && !!body.templateKey;
    let text = (body.body ?? "").trim();
    if (!text && body.templateKey) {
      text = await engineService.resolveWaTemplate(tenantId, body.templateKey);
    }
    if (!text) throw new BadRequestError("Provide body or a templateKey");
    text = text.replace(/{name}/g, firstName(target?.name));

    // Deliver via the Meta Cloud API: a templateKey means a cold/approved
    // template send (the key is the Meta template name, {name} -> {{1}}); free
    // text is a session message (only delivers inside the 24h window). The
    // rendered text is still stored for the inbox thread regardless.
    const delivery = await whatsappDeliveryService.deliver(tenantId, {
      leadId: body.leadId ?? null,
      contactId: body.contactId ?? null,
      ...(usingTemplate
        ? { templateName: body.templateKey, bodyParams: [firstName(target?.name)] }
        : { text }),
    });

    const message = await engineService.sendMessage({
      tenantId,
      channel: "WHATSAPP",
      ref: {
        leadId: body.leadId ?? null,
        contactId: body.contactId ?? null,
        subject: "WhatsApp",
      },
      direction: "OUTBOUND",
      body: text,
      senderUserId: actorId,
      simulated: delivery.simulated,
      externalId: delivery.messageId,
      // Seed the delivery tick so the inbox shows "sent" immediately; the status
      // webhook then advances it to delivered/read (or failed).
      status: delivery.delivered ? "sent" : delivery.error ? "failed" : undefined,
    });
    return { ...message, delivered: delivery.delivered, error: delivery.error };
  }

  async broadcast(
    tenantId: string,
    actorId: string,
    body: { templateKey?: string; audienceTag?: string }
  ) {
    const templateKey = (body.templateKey ?? "").trim();
    const audienceTag = (body.audienceTag ?? "").trim();
    if (!templateKey || !audienceTag) {
      throw new BadRequestError("templateKey and audienceTag required");
    }

    const template = await engineService.resolveWaTemplate(tenantId, templateKey);
    const audience = await whatsappRepository.findLeadsByTag(tenantId, audienceTag);

    // Broadcasts are cold outreach, so each goes out as an approved Meta
    // template (the key is the template name). Tally real deliveries vs failures.
    let delivered = 0;
    let failed = 0;
    for (const lead of audience) {
      const delivery = await whatsappDeliveryService.deliver(tenantId, {
        leadId: lead.id,
        templateName: templateKey,
        bodyParams: [firstName(lead.name)],
      });
      if (delivery.delivered) delivered++;
      else failed++;
      await engineService.sendMessage({
        tenantId,
        channel: "WHATSAPP",
        ref: { leadId: lead.id, subject: "WhatsApp" },
        direction: "OUTBOUND",
        body: template.replace(/{name}/g, firstName(lead.name)),
        senderUserId: actorId,
        simulated: delivery.simulated,
        externalId: delivery.messageId,
      });
    }

    const campaign = await whatsappRepository.createCampaign({
      tenant_id: tenantId,
      name: `WhatsApp Broadcast - ${templateKey}`,
    });
    engineService.audit(tenantId, actorId, "whatsapp.broadcast", "campaign", campaign.id, {
      sent: audience.length,
      delivered,
      failed,
      audienceTag,
    });

    // Return shape kept stable for existing clients; delivery breakdown lives in
    // the audit log above.
    return { sent: audience.length, audienceTag };
  }

  async agentReply(tenantId: string, body: { question?: string; leadId?: string }) {
    const question = (body.question ?? "").trim();
    if (!question) throw new BadRequestError("question required");

    let lead: { id: string; name: string } | null = null;
    if (body.leadId) {
      lead = await this.resolveTarget(tenantId, body.leadId, undefined);
    }

    const articles = await whatsappRepository.publishedKbArticles(tenantId);
    const hits = ragSearch(articles, question, 3);
    const reply = hits[0]?.snippet || FALLBACK_REPLY;
    const action = inferAction(question);

    if (lead) {
      await engineService.sendMessage({
        tenantId,
        channel: "WHATSAPP",
        ref: { leadId: lead.id, subject: "WhatsApp" },
        direction: "INBOUND",
        body: question,
      });
      // The agent's reply is a session message, deliver it for real (it's
      // answering an inbound question, so the 24h window is open).
      const delivery = await whatsappDeliveryService.deliver(tenantId, {
        leadId: lead.id,
        text: reply,
      });
      await engineService.sendMessage({
        tenantId,
        channel: "WHATSAPP",
        ref: { leadId: lead.id, subject: "WhatsApp" },
        direction: "OUTBOUND",
        body: reply,
        simulated: delivery.simulated,
        externalId: delivery.messageId,
      });
    }

    return { reply, action, sources: hits.map((h) => h.article) };
  }

  private async resolveTarget(
    tenantId: string,
    leadId?: string,
    contactId?: string
  ): Promise<{ id: string; name: string } | null> {
    if (leadId) {
      const lead = await db
        .selectFrom("leads")
        .select(["id", "name"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", leadId)
        .executeTakeFirst();
      if (!lead) throw new NotFoundError("Lead not found");
      return lead;
    }
    if (contactId) {
      const contact = await db
        .selectFrom("contacts")
        .select(["id", "name"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", contactId)
        .executeTakeFirst();
      if (!contact) throw new NotFoundError("Contact not found");
      return contact;
    }
    return null;
  }
}

export default new WhatsappService();
