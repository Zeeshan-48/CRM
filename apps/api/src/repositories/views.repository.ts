import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, saved_views } from "../db/types";

export type SavedViewRow = Selectable<saved_views>;

class ViewsRepository {
  async listForUser(
    tenantId: string,
    userId: string,
    resource?: string
  ): Promise<SavedViewRow[]> {
    let qb = db
      .selectFrom("saved_views")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId);
    if (resource) qb = qb.where("resource", "=", resource);
    return qb.orderBy("created_at", "asc").execute();
  }

  async create(
    data: {
      tenant_id: string;
      user_id: string;
      resource: string;
      name: string;
      filters: Record<string, unknown>;
    },
    trx?: Transaction<DB>
  ): Promise<SavedViewRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("saved_views")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        user_id: data.user_id,
        resource: data.resource,
        name: data.name,
        filters: JSON.stringify(data.filters),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async delete(id: string, tenantId: string, userId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("saved_views")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }
}

export default new ViewsRepository();
