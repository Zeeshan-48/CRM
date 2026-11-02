import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, users } from "../db/types";
import type { user_status } from "../db/enums";

export type UserRow = Selectable<users>;

class UsersRepository {
  async findById(id: string, tenantId?: string): Promise<UserRow | undefined> {
    let query = db.selectFrom("users").selectAll().where("id", "=", id);
    if (tenantId) query = query.where("tenant_id", "=", tenantId);
    return query.executeTakeFirst();
  }

  // Login lookup: same email can exist in multiple tenants; return all with
  // their tenant so the auth service can pick the active match.
  async findByEmailWithTenants(email: string) {
    return db
      .selectFrom("users")
      .innerJoin("tenants", "tenants.id", "users.tenant_id")
      .select([
        "users.id as id",
        "users.tenant_id as tenant_id",
        "users.name as name",
        "users.email as email",
        "users.password_hash as password_hash",
        "users.role as role",
        "users.status as status",
        "users.permissions as permissions",
        "users.phone as phone",
        "users.available_for_calls as available_for_calls",
        "tenants.slug as tenant_slug",
        "tenants.name as tenant_name",
        "tenants.status as tenant_status",
        "tenants.brand_color as tenant_brand_color",
        "tenants.domain as tenant_domain",
        "tenants.plan_key as tenant_plan_key",
      ])
      .where(({ eb, fn }) => eb(fn("lower", ["users.email"]), "=", email.toLowerCase()))
      .execute();
  }

  async findByTenant(tenantId: string): Promise<UserRow[]> {
    return db
      .selectFrom("users")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async emailExistsInTenant(tenantId: string, email: string): Promise<boolean> {
    const row = await db
      .selectFrom("users")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where(({ eb, fn }) => eb(fn("lower", ["email"]), "=", email.toLowerCase()))
      .executeTakeFirst();
    return !!row;
  }

  async countByTenant(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("users")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // How many users currently hold a given role key (used to block deleting a
  // role that is still in use).
  async countByRole(tenantId: string, role: string): Promise<number> {
    const row = await db
      .selectFrom("users")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .where("role", "=", role)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // Member counts keyed by role, for the roles catalogue.
  async countsByRole(tenantId: string): Promise<Record<string, number>> {
    const rows = await db
      .selectFrom("users")
      .select(["role", db.fn.count<number>("id").as("n")])
      .where("tenant_id", "=", tenantId)
      .groupBy("role")
      .execute();
    const out: Record<string, number> = {};
    for (const r of rows) out[r.role] = Number(r.n);
    return out;
  }

  async create(
    data: {
      tenant_id: string;
      name: string;
      email: string;
      password_hash: string;
      role: string;
      status?: user_status;
      permissions?: string[] | null;
      territory?: string[] | null;
      skills?: string[] | null;
      avatar_color?: string | null;
    },
    trx?: Transaction<DB>
  ): Promise<UserRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("users")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        email: data.email,
        password_hash: data.password_hash,
        role: data.role,
        status: data.status ?? "ACTIVE",
        permissions: data.permissions ? JSON.stringify(data.permissions) : null,
        territory: data.territory ? JSON.stringify(data.territory) : null,
        skills: data.skills ? JSON.stringify(data.skills) : null,
        avatar_color: data.avatar_color ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<{
      name: string;
      role: string;
      status: user_status;
      permissions: string[] | null;
      territory: string[] | null;
      skills: string[] | null;
      avatar_color: string | null;
      password_hash: string;
      phone: string | null;
    }>,
    trx?: Transaction<DB>
  ): Promise<UserRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.role !== undefined) patch.role = data.role;
    if (data.status !== undefined) patch.status = data.status;
    if (data.permissions !== undefined) {
      patch.permissions = data.permissions ? JSON.stringify(data.permissions) : null;
    }
    if (data.territory !== undefined) {
      patch.territory = data.territory ? JSON.stringify(data.territory) : null;
    }
    if (data.skills !== undefined) patch.skills = data.skills ? JSON.stringify(data.skills) : null;
    if (data.avatar_color !== undefined) patch.avatar_color = data.avatar_color;
    if (data.password_hash !== undefined) patch.password_hash = data.password_hash;

    return (trx || db)
      .updateTable("users")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<number> {
    const res = await db
      .deleteFrom("users")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  // Round-robin every record owned by `fromUserId` onto the pool of remaining
  // users, one owner-column at a time, so nothing is orphaned when the user is
  // deleted. With an empty pool the records are set unassigned (null). Kysely's
  // per-table typing doesn't allow a dynamic table/column, so this one helper
  // is intentionally loosely typed; the table/column list is fixed below.
  private async reassignColumn(
    tenantId: string,
    table: string,
    column: string,
    fromUserId: string,
    poolIds: string[]
  ): Promise<{ total: number; unassigned: number; perUser: Record<string, number> }> {
    const anydb = db as any;
    // A disqualified lead is never handed to another agent, unassign it instead
    // of round-robining it onto the pool. Nulling it here also drops it from the
    // reassignment set below (it no longer matches owner = fromUserId).
    if (table === "leads") {
      await anydb
        .updateTable("leads")
        .set({ owner_id: null })
        .where("tenant_id", "=", tenantId)
        .where(column, "=", fromUserId)
        .where("status", "=", "DISQUALIFIED")
        .execute();
    }
    const rows: Array<{ id: string }> = await anydb
      .selectFrom(table)
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where(column, "=", fromUserId)
      .execute();
    const total = rows.length;
    const perUser: Record<string, number> = {};
    if (total === 0) return { total: 0, unassigned: 0, perUser };

    if (poolIds.length === 0) {
      await anydb
        .updateTable(table)
        .set({ [column]: null })
        .where("tenant_id", "=", tenantId)
        .where(column, "=", fromUserId)
        .execute();
      return { total, unassigned: total, perUser };
    }

    const buckets = new Map<string, string[]>();
    rows.forEach((row, i) => {
      const uid = poolIds[i % poolIds.length];
      const arr = buckets.get(uid) ?? [];
      arr.push(row.id);
      buckets.set(uid, arr);
    });
    for (const [uid, ids] of buckets) {
      await anydb
        .updateTable(table)
        .set({ [column]: uid })
        .where("tenant_id", "=", tenantId)
        .where("id", "in", ids)
        .execute();
      perUser[uid] = ids.length;
    }
    return { total, unassigned: 0, perUser };
  }

  // Hand off all work owned by a user before deleting them.
  async reassignOwnership(
    tenantId: string,
    fromUserId: string,
    poolIds: string[]
  ): Promise<Record<string, { total: number; unassigned: number; perUser: Record<string, number> }>> {
    const targets: Array<{ entity: string; table: string; column: string }> = [
      { entity: "leads", table: "leads", column: "owner_id" },
      { entity: "deals", table: "deals", column: "owner_id" },
      { entity: "tasks", table: "tasks", column: "owner_id" },
      { entity: "activities", table: "activities", column: "owner_id" },
      { entity: "contacts", table: "contacts", column: "owner_id" },
      { entity: "accounts", table: "accounts", column: "owner_id" },
      { entity: "meetings", table: "meetings", column: "owner_id" },
      { entity: "bookingLinks", table: "booking_links", column: "owner_id" },
      { entity: "tickets", table: "tickets", column: "assignee_id" },
    ];
    const report: Record<
      string,
      { total: number; unassigned: number; perUser: Record<string, number> }
    > = {};
    for (const t of targets) {
      report[t.entity] = await this.reassignColumn(
        tenantId,
        t.table,
        t.column,
        fromUserId,
        poolIds
      );
    }
    return report;
  }

  // Remove the user's own personal records that are meaningless once they are
  // gone (their notifications, reminders and saved views).
  async purgePersonal(
    tenantId: string,
    userId: string
  ): Promise<{ notifications: number; reminders: number; savedViews: number }> {
    const del = async (table: string): Promise<number> => {
      const res = await (db as any)
        .deleteFrom(table)
        .where("tenant_id", "=", tenantId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return Number(res?.numDeletedRows ?? 0);
    };
    return {
      notifications: await del("notifications"),
      reminders: await del("reminders"),
      savedViews: await del("saved_views"),
    };
  }

  touchLastLogin(id: string): void {
    void db
      .updateTable("users")
      .set({ last_login_at: new Date() })
      .where("id", "=", id)
      .execute()
      .catch(() => undefined);
  }
}

export default new UsersRepository();
