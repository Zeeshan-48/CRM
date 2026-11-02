import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import {
  DEFAULT_APP_KEY,
  DEFAULT_APP_NAME,
  DEFAULT_CAPABILITIES,
} from "../constants/connected-apps.const";
import { db } from "../db/connection";
import type { connected_apps, DB } from "../db/types";

export type ConnectedAppRow = Selectable<connected_apps>;

export interface CreateConnectedAppData {
  tenant_id: string;
  key: string;
  name: string;
  description?: string | null;
  logo_url?: string | null;
  product_url?: string | null;
  environment?: string;
  capabilities?: Record<string, unknown> | null;
  catalog_mode?: string;
  catalog_pull_url?: string | null;
  actions_url?: string | null;
  actions_secret?: string | null;
  allowed_origins?: string[] | null;
}

export interface UpdateConnectedAppData {
  name?: string;
  description?: string | null;
  logo_url?: string | null;
  product_url?: string | null;
  status?: string;
  environment?: string;
  capabilities?: Record<string, unknown> | null;
  catalog_mode?: string;
  catalog_pull_url?: string | null;
  actions_url?: string | null;
  actions_secret?: string | null;
  actions_catalog?: unknown;
  allowed_origins?: string[] | null;
}

class ConnectedAppsRepository {
  async list(tenantId: string, trx?: Transaction<DB>): Promise<ConnectedAppRow[]> {
    return (trx || db)
      .selectFrom("connected_apps")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async findById(
    id: string,
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<ConnectedAppRow | undefined> {
    return (trx || db)
      .selectFrom("connected_apps")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findByKey(
    tenantId: string,
    key: string,
    trx?: Transaction<DB>
  ): Promise<ConnectedAppRow | undefined> {
    return (trx || db)
      .selectFrom("connected_apps")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .executeTakeFirst();
  }

  // Used by the ingest path, which has an app id but no tenant scope yet (the
  // key already resolved the tenant, so this is a plain primary-key lookup).
  async findByIdUnscoped(id: string): Promise<ConnectedAppRow | undefined> {
    return db.selectFrom("connected_apps").selectAll().where("id", "=", id).executeTakeFirst();
  }

  // Counts everything that is not DISABLED: a PAUSED app still occupies a slot,
  // because pausing is a temporary operational state, not a way to dodge the
  // plan limit.
  async countBillable(tenantId: string, trx?: Transaction<DB>): Promise<number> {
    const row = await (trx || db)
      .selectFrom("connected_apps")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("status", "!=", "DISABLED")
      .executeTakeFirst();
    // Kysely returns PostgreSQL bigint as a string; parse before arithmetic.
    const raw = row?.count;
    return typeof raw === "string" ? parseInt(raw, 10) : Number(raw ?? 0);
  }

  async create(
    data: CreateConnectedAppData,
    trx?: Transaction<DB>
  ): Promise<ConnectedAppRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("connected_apps")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        key: data.key,
        name: data.name,
        description: data.description ?? null,
        logo_url: data.logo_url ?? null,
        product_url: data.product_url ?? null,
        status: "ACTIVE",
        environment: data.environment ?? "LIVE",
        capabilities: JSON.stringify(data.capabilities ?? DEFAULT_CAPABILITIES),
        catalog_mode: data.catalog_mode ?? "PUSH",
        catalog_pull_url: data.catalog_pull_url ?? null,
        last_catalog_sync_at: null,
        actions_url: data.actions_url ?? null,
        actions_secret: data.actions_secret ?? null,
        actions_catalog: null,
        allowed_origins: JSON.stringify(data.allowed_origins ?? []),
        last_event_at: null,
        health: "PENDING",
        last_error: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    patch: UpdateConnectedAppData,
    trx?: Transaction<DB>
  ): Promise<ConnectedAppRow | undefined> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.logo_url !== undefined) set.logo_url = patch.logo_url;
    if (patch.product_url !== undefined) set.product_url = patch.product_url;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.environment !== undefined) set.environment = patch.environment;
    if (patch.capabilities !== undefined) {
      set.capabilities = patch.capabilities ? JSON.stringify(patch.capabilities) : null;
    }
    if (patch.catalog_mode !== undefined) set.catalog_mode = patch.catalog_mode;
    if (patch.catalog_pull_url !== undefined) set.catalog_pull_url = patch.catalog_pull_url;
    if (patch.actions_url !== undefined) set.actions_url = patch.actions_url;
    if (patch.actions_secret !== undefined) set.actions_secret = patch.actions_secret;
    if (patch.actions_catalog !== undefined) {
      set.actions_catalog = patch.actions_catalog ? JSON.stringify(patch.actions_catalog) : null;
    }
    if (patch.allowed_origins !== undefined) {
      set.allowed_origins = JSON.stringify(patch.allowed_origins ?? []);
    }

    return (trx || db)
      .updateTable("connected_apps")
      .set(set)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("connected_apps")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  /**
   * Returns the tenant's auto-created "Default product", creating it if absent.
   * Multi-worker safe: the insert races against a unique (tenant_id, key), and
   * the loser falls through to the select instead of throwing.
   */
  async ensureDefaultApp(tenantId: string): Promise<ConnectedAppRow> {
    const existing = await this.findByKey(tenantId, DEFAULT_APP_KEY);
    if (existing) return existing;

    const now = new Date();
    const inserted = await db
      .insertInto("connected_apps")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        key: DEFAULT_APP_KEY,
        name: DEFAULT_APP_NAME,
        description:
          "Created automatically for API keys that pre-date connected products. Rename it to match your product.",
        logo_url: null,
        product_url: null,
        status: "ACTIVE",
        environment: "LIVE",
        capabilities: JSON.stringify(DEFAULT_CAPABILITIES),
        catalog_mode: "PUSH",
        catalog_pull_url: null,
        last_catalog_sync_at: null,
        actions_url: null,
        actions_secret: null,
        actions_catalog: null,
        allowed_origins: JSON.stringify([]),
        last_event_at: null,
        health: "PENDING",
        last_error: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.columns(["tenant_id", "key"]).doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) return inserted;

    // Lost the race: the winner's row is now readable.
    const winner = await this.findByKey(tenantId, DEFAULT_APP_KEY);
    if (!winner) throw new Error("failed to resolve the default connected app");
    return winner;
  }

  /** Binds a legacy (app_id = NULL) API key to an app. Idempotent. */
  async bindApiKeyToApp(keyId: string, appId: string): Promise<void> {
    await db
      .updateTable("api_keys")
      .set({ app_id: appId, updated_at: new Date() })
      .where("id", "=", keyId)
      .where("app_id", "is", null)
      .execute();
  }

  /**
   * Fire-and-forget health stamp written on every accepted inbound event.
   * Never awaited in a request path: an instrumentation write must not be able
   * to fail an ingest that already succeeded.
   */
  async touchEvent(appId: string): Promise<void> {
    const now = new Date();
    await db
      .updateTable("connected_apps")
      .set({ last_event_at: now, health: "OK", last_error: null, updated_at: now })
      .where("id", "=", appId)
      .execute();
  }

  async setHealth(appId: string, health: string, error: string | null): Promise<void> {
    await db
      .updateTable("connected_apps")
      .set({ health, last_error: error, updated_at: new Date() })
      .where("id", "=", appId)
      .execute();
  }

  async touchCatalogSync(appId: string): Promise<void> {
    const now = new Date();
    await db
      .updateTable("connected_apps")
      .set({ last_catalog_sync_at: now, updated_at: now })
      .where("id", "=", appId)
      .execute();
  }

  /** Apps due for a scheduled catalog pull. Used by the catalog-pull sweep. */
  async listPullable(limit = 50): Promise<ConnectedAppRow[]> {
    return db
      .selectFrom("connected_apps")
      .selectAll()
      .where("status", "=", "ACTIVE")
      .where("catalog_mode", "=", "PULL")
      .where("catalog_pull_url", "is not", null)
      .orderBy("last_catalog_sync_at", "asc")
      .limit(limit)
      .execute();
  }

  /** API keys belonging to one app, for the console's per-app key list. */
  async listKeysForApp(tenantId: string, appId: string) {
    return db
      .selectFrom("api_keys")
      .select(["id", "name", "key_prefix", "scope", "last_used_at", "created_at"])
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("revoked_at", "is", null)
      .orderBy("created_at", "desc")
      .execute();
  }
}

export default new ConnectedAppsRepository();
