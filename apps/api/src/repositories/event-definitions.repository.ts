import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { SEMANTIC_EVENTS } from "../constants/semantic-events.const";
import { db } from "../db/connection";
import type { app_event_definitions, DB } from "../db/types";

export type EventDefinitionRow = Selectable<app_event_definitions>;

export interface UpsertDefinitionData {
  tenant_id: string;
  app_id: string;
  name: string;
  label: string;
  description?: string | null;
  category?: string;
  icon?: string | null;
  intent_weight?: number;
  is_high_intent?: boolean;
  property_schema?: unknown;
  review_status?: string;
  auto_registered?: boolean;
}

class EventDefinitionsRepository {
  async listForApp(
    tenantId: string,
    appId: string,
    trx?: Transaction<DB>
  ): Promise<EventDefinitionRow[]> {
    return (trx || db)
      .selectFrom("app_event_definitions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .orderBy("category", "asc")
      .orderBy("name", "asc")
      .execute();
  }

  async listForTenant(tenantId: string): Promise<EventDefinitionRow[]> {
    return db
      .selectFrom("app_event_definitions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  async countNeedingReview(tenantId: string, appId?: string | null): Promise<number> {
    let query = db
      .selectFrom("app_event_definitions")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("review_status", "=", "NEEDS_REVIEW");
    if (appId) query = query.where("app_id", "=", appId);
    const row = await query.executeTakeFirst();
    // Kysely surfaces PostgreSQL bigint as a string; parse before arithmetic.
    const raw = row?.count;
    return typeof raw === "string" ? parseInt(raw, 10) : Number(raw ?? 0);
  }

  async findByName(
    tenantId: string,
    appId: string,
    name: string,
    trx?: Transaction<DB>
  ): Promise<EventDefinitionRow | undefined> {
    return (trx || db)
      .selectFrom("app_event_definitions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("name", "=", name)
      .executeTakeFirst();
  }

  async findById(
    id: string,
    tenantId: string
  ): Promise<EventDefinitionRow | undefined> {
    return db
      .selectFrom("app_event_definitions")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async create(data: UpsertDefinitionData, trx?: Transaction<DB>): Promise<EventDefinitionRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("app_event_definitions")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        app_id: data.app_id,
        name: data.name,
        label: data.label,
        description: data.description ?? null,
        category: data.category ?? "ACTION",
        icon: data.icon ?? null,
        intent_weight: data.intent_weight ?? 0,
        is_high_intent: data.is_high_intent ?? false,
        property_schema: data.property_schema ? JSON.stringify(data.property_schema) : null,
        review_status: data.review_status ?? "ACTIVE",
        auto_registered: data.auto_registered ?? false,
        event_count: 0,
        last_seen_at: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Registers a never-before-seen event name.
   *
   * Races safely: two cluster workers receiving the same new event at the same
   * moment both try to insert, one wins on the unique index, and the loser reads
   * the winner's row instead of 500-ing an otherwise valid ingest.
   */
  async autoRegister(
    tenantId: string,
    appId: string,
    name: string,
    label: string
  ): Promise<EventDefinitionRow> {
    const now = new Date();
    const inserted = await db
      .insertInto("app_event_definitions")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        app_id: appId,
        name,
        label,
        description: "Registered automatically on first receipt. Review and set its weight.",
        category: "ACTION",
        icon: null,
        // Deliberately zero: an unreviewed event must not move anyone's score
        // until a human decides what it means.
        intent_weight: 0,
        is_high_intent: false,
        property_schema: null,
        review_status: "NEEDS_REVIEW",
        auto_registered: true,
        event_count: 0,
        last_seen_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.columns(["tenant_id", "app_id", "name"]).doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) return inserted;

    const winner = await this.findByName(tenantId, appId, name);
    if (!winner) throw new Error(`failed to register event definition "${name}"`);
    return winner;
  }

  async update(
    id: string,
    tenantId: string,
    patch: {
      label?: string;
      description?: string | null;
      category?: string;
      icon?: string | null;
      intent_weight?: number;
      is_high_intent?: boolean;
      review_status?: string;
      property_schema?: unknown;
    }
  ): Promise<EventDefinitionRow | undefined> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.intent_weight !== undefined) set.intent_weight = patch.intent_weight;
    if (patch.is_high_intent !== undefined) set.is_high_intent = patch.is_high_intent;
    if (patch.review_status !== undefined) set.review_status = patch.review_status;
    if (patch.property_schema !== undefined) {
      set.property_schema = patch.property_schema ? JSON.stringify(patch.property_schema) : null;
    }

    return db
      .updateTable("app_event_definitions")
      .set(set)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Usage counters. Fire-and-forget from the ingest path: an instrumentation
   * write must never be able to fail an event that was already stored.
   */
  async touchSeen(id: string): Promise<void> {
    const now = new Date();
    await db
      .updateTable("app_event_definitions")
      .set((eb) => ({
        event_count: eb("event_count", "+", 1),
        last_seen_at: now,
        updated_at: now,
      }))
      .where("id", "=", id)
      .execute();
  }

  /**
   * Seeds the reserved semantic vocabulary for a newly connected product, so an
   * integration has working intent scoring on day one with no configuration.
   * Existing rows are left alone: once seeded, the DB is the source of truth and
   * an admin's retuning must survive a redeploy.
   */
  async seedSemanticEvents(tenantId: string, appId: string): Promise<number> {
    const now = new Date();
    const result = await db
      .insertInto("app_event_definitions")
      .values(
        SEMANTIC_EVENTS.map((e) => ({
          id: ulid(),
          tenant_id: tenantId,
          app_id: appId,
          name: e.name,
          label: e.label,
          description: e.description,
          category: e.category,
          icon: e.icon,
          intent_weight: e.intent_weight,
          is_high_intent: e.is_high_intent,
          property_schema: null,
          review_status: "ACTIVE",
          auto_registered: false,
          event_count: 0,
          last_seen_at: null,
          created_at: now,
          updated_at: now,
        }))
      )
      .onConflict((oc) => oc.columns(["tenant_id", "app_id", "name"]).doNothing())
      .execute();
    return Number(result?.[0]?.numInsertedOrUpdatedRows ?? 0);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("app_event_definitions")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  async deleteForApp(tenantId: string, appId: string): Promise<void> {
    await db
      .deleteFrom("app_event_definitions")
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .execute();
  }
}

export default new EventDefinitionsRepository();
