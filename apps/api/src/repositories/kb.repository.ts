import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, kb_articles } from "../db/types";
import type { kb_status } from "../db/enums";

export type KbArticleRow = Selectable<kb_articles>;

export interface CreateKbArticleData {
  tenant_id: string;
  title: string;
  body: string;
  tags?: string[];
  status?: kb_status;
}

class KbRepository {
  async list(tenantId: string, status?: kb_status): Promise<KbArticleRow[]> {
    let query = db.selectFrom("kb_articles").selectAll().where("tenant_id", "=", tenantId);
    if (status) query = query.where("status", "=", status);
    return query.orderBy("created_at", "desc").execute();
  }

  async findById(id: string, tenantId: string): Promise<KbArticleRow | undefined> {
    return db
      .selectFrom("kb_articles")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  // Single UPDATE ... RETURNING keeps the view count race-free across workers.
  async incrementViews(id: string, tenantId: string): Promise<KbArticleRow | undefined> {
    return db
      .updateTable("kb_articles")
      .set((eb) => ({ views: eb("views", "+", 1) }))
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async create(data: CreateKbArticleData, trx?: Transaction<DB>): Promise<KbArticleRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("kb_articles")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        title: data.title,
        body: data.body,
        tags: JSON.stringify(data.tags ?? []),
        status: data.status ?? "PUBLISHED",
        views: 0,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

export default new KbRepository();
