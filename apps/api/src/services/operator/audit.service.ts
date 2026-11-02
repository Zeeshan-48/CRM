import auditRepository, { OperatorAuditRow } from "../../repositories/operator/audit.repository";
import logger from "../../utils/logger";

export interface AuditActor {
  id: string;
  email: string;
}

class AuditService {
  // Fire-and-forget, never awaited: instrumentation must not block or fail
  // the request path.
  log(
    actor: AuditActor | null,
    action: string,
    category: string,
    details: {
      tenantId?: string | null;
      resourceId?: string | null;
      summary: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    auditRepository
      .insert({
        actorOperatorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action,
        category,
        tenantId: details.tenantId ?? null,
        resourceId: details.resourceId ?? null,
        summary: details.summary,
        metadata: details.metadata ?? {},
      })
      .catch((err) => logger.warn(`operator audit write failed: ${err.message}`));
  }

  async list(filters: { action?: string; tenantId?: string }): Promise<OperatorAuditRow[]> {
    return auditRepository.list(filters);
  }
}

export default new AuditService();
