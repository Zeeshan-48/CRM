import { db } from "../db/connection";
import type { email_category } from "../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import emailDomainsRepository from "../repositories/email-domains.repository";
import emailIdentitiesRepository, {
  EmailSenderIdentityRow,
} from "../repositories/email-identities.repository";
import emailResolverService from "./email-resolver.service";
import engineService from "./engine.service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES: email_category[] = ["TRANSACTIONAL", "NOTIFICATION", "MARKETING"];

interface DefaultFlags {
  is_default_transactional: boolean;
  is_default_notification: boolean;
  is_default_marketing: boolean;
}

const flagFor = (category: email_category): keyof DefaultFlags =>
  category === "TRANSACTIONAL"
    ? "is_default_transactional"
    : category === "MARKETING"
      ? "is_default_marketing"
      : "is_default_notification";

class EmailIdentitiesService {
  async list(tenantId: string): Promise<EmailSenderIdentityRow[]> {
    return emailIdentitiesRepository.listByTenant(tenantId);
  }

  async create(
    tenantId: string,
    actorId: string,
    body: {
      sendingDomainId?: string;
      emailAddress?: string;
      displayName?: string;
      replyTo?: string;
      defaultFor?: string[];
    }
  ): Promise<EmailSenderIdentityRow> {
    if (!body.sendingDomainId) throw new BadRequestError("sendingDomainId required");
    const email = String(body.emailAddress ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestError("A valid email address is required");

    const domain = await emailDomainsRepository.findById(body.sendingDomainId, tenantId);
    if (!domain) throw new NotFoundError("Sending domain not found");
    if (domain.status !== "VERIFIED") {
      throw new BadRequestError("The sending domain must be verified before adding senders");
    }

    const host = email.split("@")[1];
    if (host !== domain.subdomain && !host.endsWith(`.${domain.subdomain}`)) {
      throw new BadRequestError(`The address must be on ${domain.subdomain}`);
    }

    if (await emailIdentitiesRepository.findByEmail(tenantId, email)) {
      throw new ConflictError("That sender address already exists");
    }

    const defaults = this.defaultFlags(body.defaultFor);

    const identity = await db.transaction().execute(async (trx) => {
      for (const category of CATEGORIES) {
        if (defaults[flagFor(category)]) {
          await emailIdentitiesRepository.clearDefault(tenantId, category, trx);
        }
      }
      return emailIdentitiesRepository.create(
        {
          tenant_id: tenantId,
          sending_domain_id: domain.id,
          email_address: email,
          display_name: body.displayName?.trim() || null,
          reply_to: body.replyTo?.trim().toLowerCase() || null,
          ...defaults,
        },
        trx
      );
    });

    engineService.audit(tenantId, actorId, "email_identity.created", "email_sender_identity", identity.id, {
      email,
    });
    emailResolverService.invalidate(tenantId);
    return identity;
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    body: {
      displayName?: string;
      replyTo?: string;
      status?: string;
      defaultFor?: string[];
    }
  ): Promise<EmailSenderIdentityRow> {
    const current = await emailIdentitiesRepository.findById(id, tenantId);
    if (!current) throw new NotFoundError("Sender identity not found");

    const patch: {
      display_name?: string | null;
      reply_to?: string | null;
      status?: "ACTIVE" | "ARCHIVED";
      is_default_transactional?: boolean;
      is_default_notification?: boolean;
      is_default_marketing?: boolean;
    } = {};

    if (body.displayName !== undefined) patch.display_name = body.displayName.trim() || null;
    if (body.replyTo !== undefined) patch.reply_to = body.replyTo.trim().toLowerCase() || null;
    if (body.status !== undefined) {
      const s = body.status.toUpperCase();
      if (s !== "ACTIVE" && s !== "ARCHIVED") throw new BadRequestError("Invalid status");
      patch.status = s;
    }

    let defaults: DefaultFlags | null = null;
    if (body.defaultFor !== undefined) {
      defaults = this.defaultFlags(body.defaultFor);
      Object.assign(patch, defaults);
    }

    const updated = await db.transaction().execute(async (trx) => {
      if (defaults) {
        for (const category of CATEGORIES) {
          if (defaults[flagFor(category)]) {
            await emailIdentitiesRepository.clearDefault(tenantId, category, trx);
          }
        }
      }
      return emailIdentitiesRepository.update(id, tenantId, patch, trx);
    });

    engineService.audit(tenantId, actorId, "email_identity.updated", "email_sender_identity", id, {});
    emailResolverService.invalidate(tenantId);
    return updated;
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const current = await emailIdentitiesRepository.findById(id, tenantId);
    if (!current) throw new NotFoundError("Sender identity not found");
    await emailIdentitiesRepository.remove(id, tenantId);
    engineService.audit(tenantId, actorId, "email_identity.deleted", "email_sender_identity", id, {});
    emailResolverService.invalidate(tenantId);
    return { id };
  }

  private defaultFlags(defaultFor?: string[]): DefaultFlags {
    const set = new Set((defaultFor ?? []).map((c) => String(c).toUpperCase()));
    for (const c of set) {
      if (!CATEGORIES.includes(c as email_category)) {
        throw new BadRequestError(`Invalid category: ${c}`);
      }
    }
    return {
      is_default_transactional: set.has("TRANSACTIONAL"),
      is_default_notification: set.has("NOTIFICATION"),
      is_default_marketing: set.has("MARKETING"),
    };
  }
}

export default new EmailIdentitiesService();
