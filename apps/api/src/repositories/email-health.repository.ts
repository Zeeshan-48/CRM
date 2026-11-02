import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_domain_health_checks } from "../db/types";

export type EmailHealthCheckRow = Selectable<email_domain_health_checks>;

class EmailHealthRepository {
  async record(data: {
    tenantId: string;
    sendingDomainId: string;
    dkimStatus: string | null;
    mailFromStatus: string | null;
    spfPresent: boolean;
    dmarcPresent: boolean;
    failures: unknown;
  }): Promise<void> {
    await db
      .insertInto("email_domain_health_checks")
      .values({
        id: ulid(),
        tenant_id: data.tenantId,
        sending_domain_id: data.sendingDomainId,
        dkim_status: data.dkimStatus,
        mail_from_status: data.mailFromStatus,
        spf_present: data.spfPresent,
        dmarc_present: data.dmarcPresent,
        failures: JSON.stringify(data.failures ?? []),
        created_at: new Date(),
      })
      .execute();
  }

  async latest(
    tenantId: string,
    sendingDomainId: string
  ): Promise<EmailHealthCheckRow | undefined> {
    return db
      .selectFrom("email_domain_health_checks")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("sending_domain_id", "=", sendingDomainId)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }
}

export default new EmailHealthRepository();
