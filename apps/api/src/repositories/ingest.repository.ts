import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { lead_ingest_status } from "../db/enums";
import type { lead_ingest_events } from "../db/types";

export type IngestEventRow = Selectable<lead_ingest_events>;

class IngestRepository {
  // Records one inbound-capture attempt. `external_id` (when present) is unique
  // per tenant at the DB level, so a duplicate insert throws, callers treat
  // that as "already processed" (idempotency).
  async createEvent(data: {
    tenant_id: string;
    api_key_id: string | null;
    source: string;
    external_id: string | null;
    status: lead_ingest_status;
    lead_id: string | null;
    error: string | null;
    payload: Record<string, unknown> | null;
  }): Promise<IngestEventRow> {
    return db
      .insertInto("lead_ingest_events")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        api_key_id: data.api_key_id,
        source: data.source,
        external_id: data.external_id,
        status: data.status,
        lead_id: data.lead_id,
        error: data.error,
        payload: data.payload ? JSON.stringify(data.payload) : null,
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Prior event for an idempotency key, if any. Used to short-circuit provider
  // redeliveries before we touch the leads table.
  async findByExternalId(
    tenantId: string,
    externalId: string
  ): Promise<IngestEventRow | undefined> {
    return db
      .selectFrom("lead_ingest_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("external_id", "=", externalId)
      .executeTakeFirst();
  }

  // Recent deliveries for the workspace's "Lead capture" activity log.
  async list(tenantId: string, limit = 50): Promise<IngestEventRow[]> {
    return db
      .selectFrom("lead_ingest_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(Math.min(200, Math.max(1, limit)))
      .execute();
  }
}

export default new IngestRepository();
