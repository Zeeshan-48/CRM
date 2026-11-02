import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { activity_events, DB } from "../db/types";

export type ActivityEventRow = Selectable<activity_events>;

export interface InsertEventData {
  tenant_id: string;
  api_key_id: string | null;
  lead_id: string | null;
  event: string;
  title: string | null;
  status: string;
  occurred_at: Date;
  idempotency_key: string | null;
  payload: Record<string, unknown> | null;
  error: string | null;
  // ---- Product-integration columns (all optional, so the legacy call sites in
  // this file keep compiling and behaving identically) ----
  app_id?: string | null;
  product_id?: string | null;
  contact_id?: string | null;
  anonymous_id?: string | null;
  session_id?: string | null;
  page_url?: string | null;
  referrer?: string | null;
  value_minor?: number | null;
  currency?: string | null;
}

export interface RollupEventRow {
  event: string;
  occurred_at: Date;
  session_id: string | null;
  page_url: string | null;
}

class ActivityEventsRepository {
  // Records one inbound platform-activity event. `idempotency_key` (when present)
  // is unique per tenant at the DB level, so a duplicate insert throws, callers
  // treat that as "already processed".
  async insertEvent(data: InsertEventData): Promise<ActivityEventRow> {
    return db
      .insertInto("activity_events")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        api_key_id: data.api_key_id,
        lead_id: data.lead_id,
        event: data.event,
        title: data.title,
        status: data.status,
        occurred_at: data.occurred_at,
        idempotency_key: data.idempotency_key,
        payload: data.payload ? JSON.stringify(data.payload) : null,
        error: data.error,
        app_id: data.app_id ?? null,
        product_id: data.product_id ?? null,
        contact_id: data.contact_id ?? null,
        anonymous_id: data.anonymous_id ?? null,
        session_id: data.session_id ?? null,
        page_url: data.page_url ?? null,
        referrer: data.referrer ?? null,
        value_minor: data.value_minor ?? null,
        currency: data.currency ?? null,
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Prior event for an idempotency key, if any. Short-circuits producer + payment
  // webhook redeliveries before we touch the leads table.
  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<ActivityEventRow | undefined> {
    return db
      .selectFrom("activity_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
  }

  /**
   * Batch idempotency check. One query for a whole batch instead of N: a 500
   * event batch replay would otherwise be 500 round trips before doing any work.
   */
  async findExistingKeys(tenantId: string, keys: string[]): Promise<Set<string>> {
    if (!keys.length) return new Set();
    const rows = await db
      .selectFrom("activity_events")
      .select(["idempotency_key"])
      .where("tenant_id", "=", tenantId)
      .where("idempotency_key", "in", keys)
      .execute();
    return new Set(rows.map((r) => r.idempotency_key).filter((k): k is string => !!k));
  }

  // Secondary lead match (email is primary). Matches on the lead's stamped
  // external_id, newest first.
  async findLeadIdByExternalId(
    tenantId: string,
    externalId: string
  ): Promise<string | undefined> {
    const row = await db
      .selectFrom("leads")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("external_id", "=", externalId)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    return row?.id;
  }

  // Persists the rolled-up platform snapshot + bumps the lead's last activity.
  // Direct write (leads.repository.update owns a fixed field set and has no
  // custom_fields path). Best-effort at the call site.
  async updateLeadSnapshot(
    tenantId: string,
    leadId: string,
    snapshot: Record<string, unknown>,
    lastActivityAt: Date
  ): Promise<void> {
    await db
      .updateTable("leads")
      .set({
        custom_fields: JSON.stringify(snapshot),
        last_activity_at: lastActivityAt,
        updated_at: new Date(),
      })
      .where("id", "=", leadId)
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  /** Moves the lead's last_activity_at forward only. */
  async touchLeadActivity(
    tenantId: string,
    leadId: string,
    occurredAt: Date
  ): Promise<void> {
    await db
      .updateTable("leads")
      .set({ last_activity_at: occurredAt, updated_at: new Date() })
      .where("id", "=", leadId)
      .where("tenant_id", "=", tenantId)
      .where((eb) =>
        eb.or([eb("last_activity_at", "is", null), eb("last_activity_at", "<", occurredAt)])
      )
      .execute();
  }

  // The person's product-activity stream (newest first), for the record UI.
  // Follows the PERSON: a converted lead keeps its history via contact_id.
  async listForPerson(
    tenantId: string,
    person: { leadId?: string | null; contactId?: string | null },
    options: { appId?: string | null; limit?: number } = {}
  ): Promise<ActivityEventRow[]> {
    if (!person.leadId && !person.contactId) return [];
    let query = db
      .selectFrom("activity_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "RECORDED");

    query = person.leadId
      ? query.where((eb) =>
          person.contactId
            ? eb.or([
                eb("lead_id", "=", person.leadId as string),
                eb("contact_id", "=", person.contactId as string),
              ])
            : eb("lead_id", "=", person.leadId as string)
        )
      : query.where("contact_id", "=", person.contactId as string);

    if (options.appId) query = query.where("app_id", "=", options.appId);

    return query
      .orderBy("occurred_at", "desc")
      .limit(Math.min(500, Math.max(1, options.limit ?? 100)))
      .execute();
  }

  /** Back-compat alias for the original lead-only listing. */
  async listForLead(tenantId: string, leadId: string, limit = 100): Promise<ActivityEventRow[]> {
    return this.listForPerson(tenantId, { leadId }, { limit });
  }

  /**
   * Bounded event window for a rollup recompute. Ordered newest first and capped
   * so one very busy visitor cannot make the sweep unbounded; the intent score
   * saturates well before this many events anyway.
   */
  async listForRollup(
    tenantId: string,
    appId: string,
    person: { leadId: string | null; contactId: string | null },
    since: Date,
    limit = 1000
  ): Promise<RollupEventRow[]> {
    if (!person.leadId && !person.contactId) return [];
    let query = db
      .selectFrom("activity_events")
      .select(["event", "occurred_at", "session_id", "page_url"])
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("status", "=", "RECORDED")
      .where("occurred_at", ">=", since);

    query = person.leadId
      ? query.where("lead_id", "=", person.leadId)
      : query.where("contact_id", "=", person.contactId as string);

    return query.orderBy("occurred_at", "desc").limit(limit).execute();
  }

  /** Repoints a converted lead's events at its new contact. */
  async movePerson(
    tenantId: string,
    leadId: string,
    contactId: string,
    trx?: Transaction<DB>
  ): Promise<number> {
    const result = await (trx || db)
      .updateTable("activity_events")
      .set({ contact_id: contactId })
      .where("tenant_id", "=", tenantId)
      .where("lead_id", "=", leadId)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }

  /** Recent events for a connected app, for the integration console's inspector. */
  async listForApp(
    tenantId: string,
    appId: string,
    limit = 50
  ): Promise<ActivityEventRow[]> {
    return db
      .selectFrom("activity_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .orderBy("created_at", "desc")
      .limit(Math.min(200, Math.max(1, limit)))
      .execute();
  }

  /** Counts for the integration health endpoint. */
  async healthCounts(
    tenantId: string,
    appId: string,
    since: Date
  ): Promise<{ total: number; orphaned: number; rejected: number }> {
    const rows = await db
      .selectFrom("activity_events")
      .select(["status"])
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("created_at", ">=", since)
      .groupBy("status")
      .execute();

    // Kysely surfaces PostgreSQL bigint as a string; parse before arithmetic.
    const num = (v: unknown): number =>
      typeof v === "string" ? parseInt(v, 10) : Number(v ?? 0);

    let total = 0;
    let orphaned = 0;
    let rejected = 0;
    for (const row of rows) {
      const n = num(row.count);
      total += n;
      if (row.status === "ORPHAN") orphaned += n;
      if (row.status === "REJECTED") rejected += n;
    }
    return { total, orphaned, rejected };
  }

  /** Drops every product event belonging to a deleted person. */
  async deleteForPerson(
    tenantId: string,
    person: { leadId?: string | null; contactId?: string | null },
    trx?: Transaction<DB>
  ): Promise<void> {
    if (!person.leadId && !person.contactId) return;
    let query = (trx || db).deleteFrom("activity_events").where("tenant_id", "=", tenantId);
    query = person.leadId
      ? query.where("lead_id", "=", person.leadId)
      : query.where("contact_id", "=", person.contactId as string);
    await query.execute();
  }

  async deleteForApp(tenantId: string, appId: string): Promise<void> {
    await db
      .deleteFrom("activity_events")
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .execute();
  }
}

export default new ActivityEventsRepository();
