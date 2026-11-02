import { Selectable, Transaction, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, engagement_profiles } from "../db/types";

export type EngagementProfileRow = Selectable<engagement_profiles>;

export interface PersonRef {
  leadId: string | null;
  contactId: string | null;
}

export interface ProfilePatch {
  lifecycle_stage?: string;
  plan_name?: string | null;
  plan_status?: string | null;
  mrr_minor?: number | null;
  currency?: string | null;
  first_seen_at?: Date | null;
  last_seen_at?: Date | null;
  signup_at?: Date | null;
  trial_ends_at?: Date | null;
  sessions_30d?: number;
  events_30d?: number;
  page_views_30d?: number;
  active_days_30d?: number;
  intent_score?: number;
  intent_band?: string;
  intent_reasons?: unknown;
  checkout_abandoned_at?: Date | null;
  abandoned_cart?: unknown;
  top_products?: unknown;
  usage?: unknown;
}

const asJson = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);

class EngagementRepository {
  async find(
    tenantId: string,
    appId: string,
    person: PersonRef,
    trx?: Transaction<DB>
  ): Promise<EngagementProfileRow | undefined> {
    if (!person.leadId && !person.contactId) return undefined;
    let query = (trx || db)
      .selectFrom("engagement_profiles")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId);
    query = person.leadId
      ? query.where("lead_id", "=", person.leadId)
      : query.where("contact_id", "=", person.contactId as string);
    return query.executeTakeFirst();
  }

  /** Every connected product's profile for one person, for the record panel. */
  async listForPerson(tenantId: string, person: PersonRef): Promise<EngagementProfileRow[]> {
    if (!person.leadId && !person.contactId) return [];
    let query = db
      .selectFrom("engagement_profiles")
      .selectAll()
      .where("tenant_id", "=", tenantId);
    query = person.leadId
      ? query.where("lead_id", "=", person.leadId)
      : query.where("contact_id", "=", person.contactId as string);
    return query.orderBy("last_seen_at", "desc").execute();
  }

  /**
   * Reads-or-creates the profile for a person on an app.
   *
   * Races safely on the (tenant, app, lead) / (tenant, app, contact) uniques:
   * two workers processing a burst of events for the same new visitor both try
   * to insert, and the loser reads the winner's row.
   */
  async ensure(
    tenantId: string,
    appId: string,
    person: PersonRef,
    trx?: Transaction<DB>
  ): Promise<EngagementProfileRow> {
    const existing = await this.find(tenantId, appId, person, trx);
    if (existing) return existing;

    const now = new Date();
    const executor = trx || db;
    const inserted = await executor
      .insertInto("engagement_profiles")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        app_id: appId,
        lead_id: person.leadId,
        contact_id: person.contactId,
        lifecycle_stage: "VISITOR",
        plan_name: null,
        plan_status: null,
        mrr_minor: null,
        currency: null,
        first_seen_at: now,
        last_seen_at: now,
        signup_at: null,
        trial_ends_at: null,
        sessions_30d: 0,
        events_30d: 0,
        page_views_30d: 0,
        active_days_30d: 0,
        intent_score: 0,
        intent_band: "COLD",
        intent_reasons: null,
        checkout_abandoned_at: null,
        abandoned_cart: null,
        top_products: null,
        usage: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) return inserted;

    const winner = await this.find(tenantId, appId, person, trx);
    if (!winner) throw new Error("failed to create engagement profile");
    return winner;
  }

  async update(
    id: string,
    tenantId: string,
    patch: ProfilePatch,
    trx?: Transaction<DB>
  ): Promise<EngagementProfileRow | undefined> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    const direct: Array<keyof ProfilePatch> = [
      "lifecycle_stage",
      "plan_name",
      "plan_status",
      "mrr_minor",
      "currency",
      "first_seen_at",
      "last_seen_at",
      "signup_at",
      "trial_ends_at",
      "sessions_30d",
      "events_30d",
      "page_views_30d",
      "active_days_30d",
      "intent_score",
      "intent_band",
      "checkout_abandoned_at",
    ];
    for (const key of direct) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    for (const key of ["intent_reasons", "abandoned_cart", "top_products", "usage"] as const) {
      if (patch[key] !== undefined) set[key] = asJson(patch[key]);
    }

    return (trx || db)
      .updateTable("engagement_profiles")
      .set(set)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Moves `last_seen_at` FORWARD only, and never regresses it.
   *
   * Events arrive out of order (a batch replay, a retried webhook, a producer
   * flushing a queue), and a naive assignment would make a lead look dormant
   * because an old event landed last.
   */
  async touchSeen(id: string, occurredAt: Date): Promise<void> {
    await db
      .updateTable("engagement_profiles")
      .set({
        last_seen_at: sql`GREATEST(COALESCE("last_seen_at", ${occurredAt}), ${occurredAt})`,
        first_seen_at: sql`LEAST(COALESCE("first_seen_at", ${occurredAt}), ${occurredAt})`,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
  }

  /** Profiles whose rollup is stale, oldest first. Drives the rollup sweep. */
  async listStale(olderThan: Date, limit: number): Promise<EngagementProfileRow[]> {
    return db
      .selectFrom("engagement_profiles")
      .selectAll()
      .where("updated_at", "<", olderThan)
      .orderBy("updated_at", "asc")
      .limit(limit)
      .execute();
  }

  /** The signals feed: hottest, most recently active people across the workspace. */
  async listSignals(
    tenantId: string,
    filters: { appId?: string | null; band?: string | null; limit?: number } = {}
  ): Promise<EngagementProfileRow[]> {
    let query = db
      .selectFrom("engagement_profiles")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("intent_score", ">", 0);
    if (filters.appId) query = query.where("app_id", "=", filters.appId);
    if (filters.band) query = query.where("intent_band", "=", filters.band);
    return query
      .orderBy("intent_score", "desc")
      .orderBy("last_seen_at", "desc")
      .limit(Math.min(filters.limit ?? 50, 200))
      .execute();
  }

  /**
   * Carries a lead's profiles onto the contact it converted into, so product
   * history survives conversion instead of being stranded on the old record.
   */
  async movePerson(
    tenantId: string,
    leadId: string,
    contactId: string,
    trx?: Transaction<DB>
  ): Promise<number> {
    const result = await (trx || db)
      .updateTable("engagement_profiles")
      .set({ contact_id: contactId, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("lead_id", "=", leadId)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }

  /** Drops every rollup for a deleted person. */
  async deleteForPerson(
    tenantId: string,
    person: { leadId?: string | null; contactId?: string | null },
    trx?: Transaction<DB>
  ): Promise<void> {
    if (!person.leadId && !person.contactId) return;
    let query = (trx || db).deleteFrom("engagement_profiles").where("tenant_id", "=", tenantId);
    query = person.leadId
      ? query.where("lead_id", "=", person.leadId)
      : query.where("contact_id", "=", person.contactId as string);
    await query.execute();
  }

  async deleteForApp(tenantId: string, appId: string): Promise<void> {
    await db
      .deleteFrom("engagement_profiles")
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .execute();
  }
}

export default new EngagementRepository();
