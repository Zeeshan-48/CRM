import { Selectable, Transaction, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { wa_template_category, wa_template_status } from "../db/enums";
import type { DB, campaigns, kb_articles, whatsapp_templates } from "../db/types";

export type WhatsappTemplateRow = Selectable<whatsapp_templates>;
export type CampaignRow = Selectable<campaigns>;
export type KbArticleRow = Selectable<kb_articles>;

class WhatsappRepository {
  async listTemplates(tenantId: string): Promise<WhatsappTemplateRow[]> {
    return db
      .selectFrom("whatsapp_templates")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("key", "asc")
      .execute();
  }

  async findTemplateByKey(
    tenantId: string,
    key: string
  ): Promise<WhatsappTemplateRow | undefined> {
    return db
      .selectFrom("whatsapp_templates")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .executeTakeFirst();
  }

  async createTemplate(
    data: {
      tenant_id: string;
      key: string;
      body: string;
      category?: wa_template_category;
      status?: wa_template_status;
    },
    trx?: Transaction<DB>
  ): Promise<WhatsappTemplateRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("whatsapp_templates")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        key: data.key,
        body: data.body,
        category: data.category ?? "MARKETING",
        // Locally-drafted templates are NOT approved by Meta, only Meta can
        // approve. They stay PENDING until a "Sync from Meta" matches them.
        status: data.status ?? "PENDING",
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Deletes one template (tenant-scoped). Returns true if a row was removed.
  async deleteTemplate(tenantId: string, id: string): Promise<boolean> {
    const res = await db
      .deleteFrom("whatsapp_templates")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0) > 0;
  }

  // Removes previously-synced Meta templates whose meta_id is no longer present
  // in Meta, so the Meta-backed set mirrors reality after a sync. Local drafts
  // (meta_id IS NULL) are never touched.
  async pruneMetaTemplates(tenantId: string, keepMetaIds: string[]): Promise<number> {
    let q = db
      .deleteFrom("whatsapp_templates")
      .where("tenant_id", "=", tenantId)
      .where("meta_id", "is not", null);
    if (keepMetaIds.length > 0) {
      q = q.where("meta_id", "not in", keepMetaIds);
    }
    const res = await q.executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  // The language + body-variable count for a template key, used by the send
  // path to build a correct Meta template message. Undefined when not synced.
  async templateMeta(
    tenantId: string,
    key: string
  ): Promise<{ language: string; variables: number; synced: boolean } | undefined> {
    const row = await db
      .selectFrom("whatsapp_templates")
      .select(["language", "variables", "meta_id"])
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .executeTakeFirst();
    return row
      ? { language: row.language, variables: Number(row.variables), synced: !!row.meta_id }
      : undefined;
  }

  // Upsert a template synced from Meta (keyed by tenant + template name).
  async upsertMetaTemplate(data: {
    tenant_id: string;
    key: string;
    body: string;
    category: wa_template_category;
    status: wa_template_status;
    language: string;
    variables: number;
    meta_id: string | null;
  }): Promise<void> {
    const existing = await this.findTemplateByKey(data.tenant_id, data.key);
    const now = new Date();
    if (existing) {
      await db
        .updateTable("whatsapp_templates")
        .set({
          body: data.body,
          category: data.category,
          status: data.status,
          language: data.language,
          variables: data.variables,
          meta_id: data.meta_id,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .execute();
      return;
    }
    await db
      .insertInto("whatsapp_templates")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        key: data.key,
        body: data.body,
        category: data.category,
        status: data.status,
        language: data.language,
        variables: data.variables,
        meta_id: data.meta_id,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  // tags is a jsonb array of strings; containment finds leads carrying the tag.
  async findLeadsByTag(
    tenantId: string,
    tag: string
  ): Promise<Array<{ id: string; name: string }>> {
    return db
      .selectFrom("leads")
      .select(["id", "name"])
      .where("tenant_id", "=", tenantId)
      .where(sql<boolean>`tags @> ${JSON.stringify([tag])}::jsonb`)
      .execute();
  }

  async createCampaign(
    data: { tenant_id: string; name: string },
    trx?: Transaction<DB>
  ): Promise<CampaignRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("campaigns")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        channel: "WhatsApp",
        cost: 0,
        revenue: 0,
        leads_generated: 0,
        status: "COMPLETED",
        start_at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async publishedKbArticles(tenantId: string): Promise<KbArticleRow[]> {
    return db
      .selectFrom("kb_articles")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "PUBLISHED")
      .execute();
  }
}

export default new WhatsappRepository();
