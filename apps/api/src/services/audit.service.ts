import auditRepository, { AuditListParams } from "../repositories/audit.repository";

class AuditService {
  async list(tenantId: string, params: AuditListParams) {
    const rows = await auditRepository.list(tenantId, params);
    return rows.map(({ user_name, ...row }) => ({ ...row, user: user_name ?? "system" }));
  }

  async compliance(tenantId: string) {
    const auditEvents = await auditRepository.countByTenant(tenantId);
    return {
      gdpr: { enabled: true, dataRetentionDays: 365, rightToErasure: true },
      soc2: { status: "In progress" },
      iso27001: { status: "Planned" },
      security: {
        mfa: true,
        ipRestrictions: false,
        sso: ["Google", "Microsoft", "SAML"],
        deviceControl: true,
      },
      auditEvents,
    };
  }
}

export default new AuditService();
