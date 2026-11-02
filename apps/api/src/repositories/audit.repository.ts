import { db } from "../db/connection";

export interface AuditListParams {
  action?: string;
  entityType?: string;
}

class AuditRepository {
  async list(tenantId: string, params: AuditListParams = {}) {
    let qb = db
      .selectFrom("audit_logs")
      .leftJoin("users", "users.id", "audit_logs.user_id")
      .select([
        "audit_logs.id",
        "audit_logs.tenant_id",
        "audit_logs.user_id",
        "audit_logs.action",
        "audit_logs.entity_type",
        "audit_logs.entity_id",
        "audit_logs.meta",
        "audit_logs.created_at",
        "users.name as user_name",
      ])
      .where("audit_logs.tenant_id", "=", tenantId);
    if (params.action) qb = qb.where("audit_logs.action", "=", params.action);
    if (params.entityType) qb = qb.where("audit_logs.entity_type", "=", params.entityType);
    return qb.orderBy("audit_logs.created_at", "desc").limit(200).execute();
  }

  async countByTenant(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("audit_logs")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}

export default new AuditRepository();
