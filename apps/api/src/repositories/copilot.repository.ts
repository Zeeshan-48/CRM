import { db } from "../db/connection";
import type { CopilotData } from "../services/ai/heuristics";

// Copilot answers from an in-memory snapshot of the tenant's CRM data.
// Each dataset is capped so one tenant cannot pull unbounded rows. The cap is a
// window, so each query is ORDERED to keep the *most relevant* rows when a tenant
// has more than ROW_CAP records, recency for leads/contacts/activities/messages/
// tickets (drives "hot right now" + scoring), value for deals (drives pipeline &
// forecast). Without an ORDER BY, Postgres returns an arbitrary slice and the
// copilot goes half-blind at scale.
const ROW_CAP = 1000;

class CopilotRepository {
  async snapshot(tenantId: string): Promise<CopilotData> {
    const [leads, deals, stages, contacts, tickets, users, activities, messages] =
      await Promise.all([
        db
          .selectFrom("leads")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("created_at", "desc")
          .limit(ROW_CAP)
          .execute(),
        db
          .selectFrom("deals")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("value", "desc")
          .limit(ROW_CAP)
          .execute(),
        db
          .selectFrom("stages")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .limit(ROW_CAP)
          .execute(),
        db
          .selectFrom("contacts")
          .select(["id", "name", "company", "email", "created_at"])
          .where("tenant_id", "=", tenantId)
          .orderBy("created_at", "desc")
          .limit(ROW_CAP)
          .execute(),
        db
          .selectFrom("tickets")
          .select(["subject", "priority", "status", "sla_due_at", "created_at"])
          .where("tenant_id", "=", tenantId)
          .orderBy("created_at", "desc")
          .limit(ROW_CAP)
          .execute(),
        db
          .selectFrom("users")
          .select(["id", "name", "role"])
          .where("tenant_id", "=", tenantId)
          .limit(ROW_CAP)
          .execute(),
        db
          .selectFrom("activities")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("created_at", "desc")
          .limit(ROW_CAP)
          .execute(),
        db
          .selectFrom("messages")
          .select(["lead_id", "body"])
          .where("tenant_id", "=", tenantId)
          .orderBy("created_at", "desc")
          .limit(ROW_CAP)
          .execute(),
      ]);

    return { leads, deals, stages, contacts, tickets, users, activities, messages };
  }
}

export default new CopilotRepository();
