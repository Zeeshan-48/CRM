import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, roles } from "../db/types";

export type RoleRow = Selectable<roles>;

class RolesRepository {
  async findByTenant(tenantId: string): Promise<RoleRow[]> {
    return db
      .selectFrom("roles")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async findByKey(tenantId: string, key: string): Promise<RoleRow | undefined> {
    return db
      .selectFrom("roles")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .executeTakeFirst();
  }

  async create(
    data: { tenant_id: string; key: string; name: string; permissions: string[]; builtin?: boolean },
    trx?: Transaction<DB>
  ): Promise<RoleRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("roles")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        key: data.key,
        name: data.name,
        permissions: JSON.stringify(data.permissions),
        builtin: data.builtin ?? false,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Edit a custom role's display name and/or module set. The key is immutable
  // (users reference it), so renaming only changes the label.
  async update(
    tenantId: string,
    key: string,
    data: { name?: string; permissions?: string[] }
  ): Promise<RoleRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.permissions !== undefined) patch.permissions = JSON.stringify(data.permissions);
    return db
      .updateTable("roles")
      .set(patch)
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(tenantId: string, key: string): Promise<number> {
    const res = await db
      .deleteFrom("roles")
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }
}

export default new RolesRepository();
