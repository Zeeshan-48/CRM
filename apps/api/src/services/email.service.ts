import { db } from "../db/connection";
import { BadRequestError, NotFoundError } from "../errors";
import emailMessagesRepository from "../repositories/email-messages.repository";
import emailRepository, { EmailRecipient, EmailTemplateRow } from "../repositories/email.repository";
import { renderBrandedEmail } from "../utils/email-html";
import { fillTemplate } from "../utils/template-vars";
import type { EmailDraft } from "./ai/heuristics";
import { aiProvider } from "./ai/provider";
import engineService from "./engine.service";
import mailerService from "./mailer.service";

// Draft-type keys that ship with the app (the frontend's DRAFT_TYPES). Custom
// workspace types may not collide with these.
const BUILT_IN_DRAFT_TYPES = [
  "sales",
  "followup",
  "response",
  "referral",
  "meeting",
  "proposal",
  "reengage",
  "thankyou",
  "renewal",
];

// A workspace-defined AI Email Writer type, stored in tenants.config
// .emailDraftTypes. `intent` steers the AI; `subject`/`body` are the no-AI
// fallback copy (with {name}/{company} merge fields).
export interface CustomDraftType {
  key: string;
  label: string;
  intent: string;
  subject?: string;
  body?: string;
}

const slugifyKey = (label: string): string =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

class EmailService {
  async templates(tenantId: string): Promise<EmailTemplateRow[]> {
    return emailRepository.listTemplates(tenantId);
  }

  async createTemplate(
    tenantId: string,
    actorId: string,
    body: { name?: string; subject?: string; body?: string; category?: string }
  ): Promise<EmailTemplateRow> {
    if (!body.name || !body.subject) throw new BadRequestError("name and subject required");

    const template = await emailRepository.createTemplate({
      tenant_id: tenantId,
      name: body.name,
      subject: body.subject,
      body: body.body ?? "",
      category: body.category ?? null,
    });
    engineService.audit(tenantId, actorId, "email.template_created", "email_template", template.id, {
      name: template.name,
    });
    return template;
  }

  async updateTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    body: { name?: string; subject?: string; body?: string; category?: string }
  ): Promise<EmailTemplateRow> {
    if (!body.name || !body.subject) throw new BadRequestError("name and subject required");

    const category = body.category?.trim() ? body.category.trim() : null;
    const updated = await emailRepository.updateTemplate(id, tenantId, {
      name: body.name.trim(),
      subject: body.subject.trim(),
      body: body.body ?? "",
      category,
    });
    if (!updated) throw new NotFoundError("Template not found");

    engineService.audit(tenantId, actorId, "email.template_updated", "email_template", id, {
      name: updated.name,
    });
    return updated;
  }

  async deleteTemplate(
    tenantId: string,
    actorId: string,
    id: string
  ): Promise<{ id: string }> {
    const existing = await emailRepository.findTemplateById(id, tenantId);
    if (!existing) throw new NotFoundError("Template not found");

    await emailRepository.deleteTemplate(id, tenantId);
    engineService.audit(tenantId, actorId, "email.template_deleted", "email_template", id, {
      name: existing.name,
    });
    return { id };
  }

  private async readConfig(tenantId: string): Promise<Record<string, unknown>> {
    const row = await db
      .selectFrom("tenants")
      .select("config")
      .where("id", "=", tenantId)
      .executeTakeFirst();
    return row?.config && typeof row.config === "object"
      ? (row.config as Record<string, unknown>)
      : {};
  }

  private async writeConfig(
    tenantId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const cfg = await this.readConfig(tenantId);
    await db
      .updateTable("tenants")
      .set({ config: JSON.stringify({ ...cfg, ...patch }), updated_at: new Date() })
      .where("id", "=", tenantId)
      .execute();
  }

  // The workspace's custom (added-from-UI) draft types.
  private async customTypes(tenantId: string): Promise<CustomDraftType[]> {
    const cfg = await this.readConfig(tenantId);
    const list = Array.isArray(cfg.emailDraftTypes) ? cfg.emailDraftTypes : [];
    return list.filter(
      (t): t is CustomDraftType =>
        !!t &&
        typeof t === "object" &&
        typeof (t as CustomDraftType).key === "string" &&
        typeof (t as CustomDraftType).label === "string"
    );
  }

  // Built-in types the workspace has hidden. Built-ins can't be deleted (they
  // live in code), so hiding just drops them from the dropdown; they can be
  // restored later.
  private async hiddenBuiltins(tenantId: string): Promise<string[]> {
    const cfg = await this.readConfig(tenantId);
    const list = Array.isArray(cfg.emailDraftTypesHidden) ? cfg.emailDraftTypesHidden : [];
    return list.filter(
      (k): k is string => typeof k === "string" && BUILT_IN_DRAFT_TYPES.includes(k)
    );
  }

  // Everything the UI needs to render + manage the type list.
  async listDraftTypes(
    tenantId: string
  ): Promise<{ custom: CustomDraftType[]; hidden: string[] }> {
    const [custom, hidden] = await Promise.all([
      this.customTypes(tenantId),
      this.hiddenBuiltins(tenantId),
    ]);
    return { custom, hidden };
  }

  async addDraftType(
    tenantId: string,
    actorId: string,
    body: { label?: string; intent?: string; subject?: string; body?: string }
  ): Promise<CustomDraftType> {
    const label = body.label?.trim();
    const intent = body.intent?.trim();
    if (!label) throw new BadRequestError("A name is required");
    if (!intent) throw new BadRequestError("A description of what the email should do is required");

    const key = slugifyKey(label);
    if (!key) throw new BadRequestError("Use letters or numbers in the name");
    if (BUILT_IN_DRAFT_TYPES.includes(key)) {
      throw new BadRequestError("That name matches a built-in type; pick another");
    }

    const existing = await this.customTypes(tenantId);
    if (existing.some((t) => t.key === key)) {
      throw new BadRequestError("A type with that name already exists");
    }

    const created: CustomDraftType = {
      key,
      label,
      intent,
      subject: body.subject?.trim() || undefined,
      body: body.body?.trim() || undefined,
    };
    await this.writeConfig(tenantId, { emailDraftTypes: [...existing, created] });
    engineService.audit(tenantId, actorId, "email.draft_type_created", "tenant", tenantId, {
      key,
      label,
    });
    return created;
  }

  // Removes a type: custom types are deleted outright; built-in types are hidden
  // (and can be restored). Guards against hiding the last remaining type.
  async removeDraftType(
    tenantId: string,
    actorId: string,
    key: string
  ): Promise<{ key: string }> {
    if (BUILT_IN_DRAFT_TYPES.includes(key)) {
      const [custom, hidden] = await Promise.all([
        this.customTypes(tenantId),
        this.hiddenBuiltins(tenantId),
      ]);
      if (hidden.includes(key)) return { key };
      const visibleAfter =
        BUILT_IN_DRAFT_TYPES.length - (hidden.length + 1) + custom.length;
      if (visibleAfter < 1) {
        throw new BadRequestError("Keep at least one email type.");
      }
      await this.writeConfig(tenantId, { emailDraftTypesHidden: [...hidden, key] });
      engineService.audit(tenantId, actorId, "email.draft_type_hidden", "tenant", tenantId, {
        key,
      });
      return { key };
    }

    const custom = await this.customTypes(tenantId);
    if (!custom.some((t) => t.key === key)) throw new NotFoundError("Type not found");
    await this.writeConfig(tenantId, {
      emailDraftTypes: custom.filter((t) => t.key !== key),
    });
    engineService.audit(tenantId, actorId, "email.draft_type_deleted", "tenant", tenantId, {
      key,
    });
    return { key };
  }

  // Un-hides a previously hidden built-in type.
  async restoreDraftType(
    tenantId: string,
    actorId: string,
    key: string
  ): Promise<{ key: string }> {
    const hidden = await this.hiddenBuiltins(tenantId);
    if (!hidden.includes(key)) throw new NotFoundError("Type is not hidden");
    await this.writeConfig(tenantId, {
      emailDraftTypesHidden: hidden.filter((k) => k !== key),
    });
    engineService.audit(tenantId, actorId, "email.draft_type_restored", "tenant", tenantId, {
      key,
    });
    return { key };
  }

  async write(
    tenantId: string,
    body: { type?: string; name?: string; company?: string; brief?: string }
  ): Promise<EmailDraft> {
    const type = body.type || "sales";
    // A custom (workspace) type feeds its own intent + fallback copy into the
    // writer; built-in types resolve by key inside the provider.
    const custom = BUILT_IN_DRAFT_TYPES.includes(type)
      ? undefined
      : (await this.customTypes(tenantId)).find((t) => t.key === type);
    return aiProvider.writeEmail({
      type,
      name: body.name || "there",
      company: body.company || "",
      brief: body.brief,
      intent: custom?.intent,
      fallback: custom
        ? { subject: custom.subject ?? "", body: custom.body ?? "" }
        : undefined,
    });
  }

  async send(
    tenantId: string,
    actorId: string,
    body: { leadId?: string; contactId?: string; subject?: string; body?: string }
  ) {
    if (!body.body) throw new BadRequestError("body required");
    if (!body.leadId && !body.contactId) {
      throw new BadRequestError("leadId or contactId required");
    }

    let recipient: EmailRecipient | undefined;
    if (body.leadId) {
      recipient = await emailRepository.leadRecipient(tenantId, body.leadId);
      if (!recipient) throw new NotFoundError("Lead not found");
    } else if (body.contactId) {
      recipient = await emailRepository.contactRecipient(tenantId, body.contactId);
      if (!recipient) throw new NotFoundError("Contact not found");
    }
    if (!recipient?.email) throw new BadRequestError("Recipient has no email address");

    // Templates carry `{name}` / `{company}` merge fields. Resolve them against
    // the real recipient before sending, and keep the resolved text for the
    // timeline so the CRM shows exactly what landed in their inbox.
    const vars = { name: recipient.name, company: recipient.company };
    const subject = fillTemplate(body.subject || "(no subject)", vars);
    const text = fillTemplate(body.body, vars);

    // Wrap the plain-text body in a branded HTML shell (tenant name + brand
    // color). The text remains the fallback part, so this never breaks delivery
    // for clients that prefer plain text.
    const tenant = await emailRepository.tenantBrand(tenantId);
    const html = renderBrandedEmail({
      brandName: tenant?.name ?? "",
      brandColor: tenant?.brand_color,
      bodyText: text,
    });

    // Deliver over SES when keyed, otherwise the mailer simulates the send. We
    // intentionally don't set Reply-To here: the mailer applies the sender
    // identity's configured reply_to when one exists, and otherwise leaves it
    // unset so replies go to the actual From address on the sending domain.
    // (Previously this forced the logged-in user's internal address, so a Gmail
    // "Reply" went to e.g. maya@northwind.example.com instead of the brand mailbox.)
    const delivery = await mailerService.send({
      tenantId,
      category: "NOTIFICATION",
      to: recipient.email,
      subject,
      text,
      html,
    });

    const message = await engineService.sendMessage({
      tenantId,
      channel: "EMAIL",
      ref: { leadId: body.leadId ?? null, contactId: body.contactId ?? null, subject },
      direction: "OUTBOUND",
      body: text,
      senderUserId: actorId,
      simulated: delivery.provider === "SIMULATED",
    });

    // A freshly-sent email has no engagement yet, opens/clicks arrive later via
    // the SES event pipeline (email_messages.opened_at/clicked_at) and surface in
    // metrics(). The response reports the not-yet-opened state honestly.
    engineService.audit(tenantId, actorId, "email.sent", "message", message.id, {
      leadId: body.leadId ?? null,
      contactId: body.contactId ?? null,
      subject,
      provider: delivery.provider,
    });
    return { ...message, subject, provider: delivery.provider, opened: false, clicked: false };
  }

  async metrics(tenantId: string) {
    // Real engagement comes from the SES event pipeline, recorded on
    // email_messages (created only for real sends from a verified domain). When
    // a tenant has tracked sends we report their true open/click/delivery rates;
    // otherwise we fall back to the raw outbound count (rates stay 0 because
    // untracked/simulated sends carry no engagement signal). Replies are always
    // real (inbound EMAIL messages).
    const [stats, replies, outboundIds] = await Promise.all([
      emailMessagesRepository.engagementStats(tenantId),
      emailRepository.countInboundEmails(tenantId),
      emailRepository.outboundEmailIds(tenantId),
    ]);

    const tracked = stats.sent > 0;
    const sent = tracked ? stats.sent : outboundIds.length;
    return {
      sent,
      openRate: tracked ? Math.round((stats.opened / stats.sent) * 100) : 0,
      clickRate: tracked ? Math.round((stats.clicked / stats.sent) * 100) : 0,
      replies,
      delivered: stats.delivered,
      bounced: stats.bounced,
      // Whether these numbers reflect real SES open/click tracking. The UI uses
      // this to label the engagement figures honestly.
      tracked,
    };
  }
}

export default new EmailService();
