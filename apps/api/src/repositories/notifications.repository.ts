import { Selectable } from "kysely";
import { db } from "../db/connection";
import type { notifications } from "../db/types";

export type NotificationRow = Selectable<notifications>;

class NotificationsRepository {
  async listForUser(tenantId: string, userId: string): Promise<NotificationRow[]> {
    return db
      .selectFrom("notifications")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .orderBy("read", "asc")
      .orderBy("created_at", "desc")
      .limit(50)
      .execute();
  }

  async unreadCount(tenantId: string, userId: string): Promise<number> {
    const row = await db
      .selectFrom("notifications")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .where("read", "=", false)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async markRead(
    id: string,
    tenantId: string,
    userId: string
  ): Promise<NotificationRow | undefined> {
    return db
      .updateTable("notifications")
      .set({ read: true })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirst();
  }

  async markAllRead(tenantId: string, userId: string): Promise<number> {
    const result = await db
      .updateTable("notifications")
      .set({ read: true })
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .where("read", "=", false)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }
}

export default new NotificationsRepository();
