import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { operator_audit_logs } from "../../db/types";

export type OperatorAuditRow = Selectable<operator_audit_logs>;

class AuditRepository {
  async insert(data: {
    actorOperatorId: string | null;
    actorEmail: string | null;
    action: string;
    category: string;
    tenantId: string | null;
    resourceId: string | null;
    summary: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await db
      .insertInto("operator_audit_logs")
      .values({
        id: ulid(),
        actor_operator_id: data.actorOperatorId,
        actor_email: data.actorEmail,
        action: data.action,
        category: data.category,
        tenant_id: data.tenantId,
        resource_id: data.resourceId,
        summary: data.summary,
        metadata: JSON.stringify(data.metadata),
        created_at: new Date(),
      })
      .execute();
  }

  async list(filters: { action?: string; tenantId?: string }): Promise<OperatorAuditRow[]> {
    let query = db.selectFrom("operator_audit_logs").selectAll();
    if (filters.action) query = query.where("action", "=", filters.action);
    if (filters.tenantId) query = query.where("tenant_id", "=", filters.tenantId);
    return query.orderBy("created_at", "desc").limit(200).execute();
  }
}

export default new AuditRepository();
