import { Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { DB } from "../../db/types";

export interface TenantUserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

const SUMMARY_COLUMNS = ["id", "name", "email", "role", "status"] as const;

class UsersRepository {
  async listAdminsByTenant(tenantId: string): Promise<TenantUserSummary[]> {
    return db
      .selectFrom("users")
      .select(SUMMARY_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("role", "=", "ADMIN")
      .orderBy("created_at", "asc")
      .execute();
  }

  async createAdmin(
    data: { tenantId: string; name: string; email: string; passwordHash: string },
    trx?: Transaction<DB>
  ): Promise<TenantUserSummary> {
    const t = new Date();
    return (trx || db)
      .insertInto("users")
      .values({
        id: ulid(),
        tenant_id: data.tenantId,
        name: data.name,
        email: data.email,
        password_hash: data.passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
        created_at: t,
        updated_at: t,
      })
      .returning(SUMMARY_COLUMNS)
      .executeTakeFirstOrThrow();
  }
}

export default new UsersRepository();
