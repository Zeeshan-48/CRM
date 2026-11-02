import { apiGet } from "./client";

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: unknown;
  created_at: string;
  /** Actor display name; "system" when no user is attached. */
  user: string;
}

export interface ComplianceReport {
  gdpr: { enabled: boolean; dataRetentionDays: number; rightToErasure: boolean };
  soc2: { status: string };
  iso27001: { status: string };
  security: {
    mfa: boolean;
    ipRestrictions: boolean;
    sso: string[];
    deviceControl: boolean;
  };
  auditEvents: number;
}

/** Last 200 events, newest first. Both filters are exact matches. */
export const listAuditLogs = (params: { action?: string; entityType?: string } = {}) =>
  apiGet<AuditLog[]>("/audit", { params });

export const getCompliance = () => apiGet<ComplianceReport>("/audit/compliance");
