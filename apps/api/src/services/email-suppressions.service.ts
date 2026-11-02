import type { email_category } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import engineService from "./engine.service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES: email_category[] = ["TRANSACTIONAL", "NOTIFICATION", "MARKETING"];

class EmailSuppressionsService {
  async list(tenantId: string) {
    return emailSuppressionsRepository.listByTenant(tenantId);
  }

  // Admin adds a manual suppression (block). Scope null = every category.
  async add(
    tenantId: string,
    actorId: string,
    body: { email?: string; category?: string }
  ) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestError("A valid email is required");

    let scope: email_category | null = null;
    if (body.category) {
      const c = String(body.category).toUpperCase();
      if (!CATEGORIES.includes(c as email_category)) throw new BadRequestError("Invalid category");
      scope = c as email_category;
    }

    await emailSuppressionsRepository.add(tenantId, email, "ADMIN_BLOCK", scope);
    engineService.audit(tenantId, actorId, "email_suppression.added", "email_suppression", email, {
      category: scope,
    });
    return { email, category_scope: scope };
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const row = await emailSuppressionsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Suppression not found");
    await emailSuppressionsRepository.remove(id, tenantId);
    engineService.audit(tenantId, actorId, "email_suppression.removed", "email_suppression", id, {});
    return { id };
  }
}

export default new EmailSuppressionsService();
