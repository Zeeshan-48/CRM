import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_category, email_suppression_reason } from "../db/enums";
import type { email_suppressions } from "../db/types";

export type EmailSuppressionRow = Selectable<email_suppressions>;

class EmailSuppressionsRepository {
  // True when the recipient is suppressed for this category (a global
  // suppression, category_scope = null, blocks every category).
  async isSuppressed(
    tenantId: string,
    email: string,
    category: email_category
  ): Promise<boolean> {
    const row = await db
      .selectFrom("email_suppressions")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("email", "=", email.toLowerCase())
      .where((eb) =>
        eb.or([eb("category_scope", "is", null), eb("category_scope", "=", category)])
      )
      .executeTakeFirst();
    return !!row;
  }

  async add(
    tenantId: string,
    email: string,
    reason: email_suppression_reason,
    categoryScope: email_category | null
  ): Promise<void> {
    const now = new Date();
    await db
      .insertInto("email_suppressions")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        email: email.toLowerCase(),
        reason,
        category_scope: categoryScope,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(["tenant_id", "email", "category_scope"]).doUpdateSet({ reason, updated_at: now })
      )
      .execute();
  }

  async listByTenant(tenantId: string, limit = 200): Promise<EmailSuppressionRow[]> {
    return db
      .selectFrom("email_suppressions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  async findById(id: string, tenantId: string): Promise<EmailSuppressionRow | undefined> {
    return db
      .selectFrom("email_suppressions")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await db
      .deleteFrom("email_suppressions")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }
}

export default new EmailSuppressionsRepository();
