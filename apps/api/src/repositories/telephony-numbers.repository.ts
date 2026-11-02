import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { telephony_numbers } from "../db/types";

export type TelephonyNumberRow = Selectable<telephony_numbers>;

// The tenant's ExoPhone pool: the main marketing number plus per-agent
// dedicated numbers. Kysely-only, tenant-scoped throughout.
class TelephonyNumbersRepository {
  async list(tenantId: string): Promise<TelephonyNumberRow[]> {
    return db
      .selectFrom("telephony_numbers")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async create(data: {
    tenant_id: string;
    phone: string;
    label: string | null;
    kind: string;
    assigned_user_id: string | null;
  }): Promise<TelephonyNumberRow> {
    const now = new Date();
    return db
      .insertInto("telephony_numbers")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        phone: data.phone,
        label: data.label,
        kind: data.kind,
        assigned_user_id: data.assigned_user_id,
        active: true,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    tenantId: string,
    id: string,
    patch: {
      label?: string | null;
      kind?: string;
      assigned_user_id?: string | null;
      active?: boolean;
    }
  ): Promise<TelephonyNumberRow | undefined> {
    return db
      .updateTable("telephony_numbers")
      .set({ ...patch, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const result = await db
      .deleteFrom("telephony_numbers")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  /** Which pool entry a dialed ExoPhone is, the inbound routing entry point. */
  async findByPhone(tenantId: string, phone: string): Promise<TelephonyNumberRow | undefined> {
    return db
      .selectFrom("telephony_numbers")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("phone", "=", phone)
      .where("active", "=", true)
      .executeTakeFirst();
  }

  /** The agent's dedicated ExoPhone, used as their outbound CallerId. */
  async agentNumber(tenantId: string, userId: string): Promise<TelephonyNumberRow | undefined> {
    return db
      .selectFrom("telephony_numbers")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("kind", "=", "AGENT")
      .where("assigned_user_id", "=", userId)
      .where("active", "=", true)
      .orderBy("created_at", "asc")
      .executeTakeFirst();
  }
}

export default new TelephonyNumbersRepository();
