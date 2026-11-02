import { apiGet } from "@/lib/api/client";
import type { AuditRow } from "@/types";

export const listAudit = (params?: { action?: string; tenantId?: string }) =>
  apiGet<AuditRow[]>("/audit", {
    params: {
      ...(params?.action ? { action: params.action } : {}),
      ...(params?.tenantId ? { tenantId: params.tenantId } : {}),
    },
  });
