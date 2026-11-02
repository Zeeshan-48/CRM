import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, api_keys, integrations, webhooks } from "../db/types";

export type IntegrationRow = Selectable<integrations>;
export type WebhookRow = Selectable<webhooks>;
export type ApiKeyRow = Selectable<api_keys>;

class IntegrationsRepository {
  // ---- Connectors ----

  async listByTenant(tenantId: string, trx?: Transaction<DB>): Promise<IntegrationRow[]> {
    return (trx || db)
      .selectFrom("integrations")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  async findByKey(
    tenantId: string,
    key: string,
    trx?: Transaction<DB>
  ): Promise<IntegrationRow | undefined> {
    return (trx || db)
      .selectFrom("integrations")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .executeTakeFirst();
  }

  async upsertConnected(
    data: {
      tenant_id: string;
      key: string;
      name: string;
      category: string;
      credentials: Record<string, unknown> | null;
    },
    trx?: Transaction<DB>
  ): Promise<IntegrationRow> {
    const now = new Date();
    const existing = await this.findByKey(data.tenant_id, data.key, trx);
    if (existing) {
      return (trx || db)
        .updateTable("integrations")
        .set({
          connected: true,
          connected_at: now,
          credentials: data.credentials ? JSON.stringify(data.credentials) : existing.credentials,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .where("tenant_id", "=", data.tenant_id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return (trx || db)
      .insertInto("integrations")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        key: data.key,
        name: data.name,
        category: data.category,
        connected: true,
        connected_at: now,
        credentials: data.credentials ? JSON.stringify(data.credentials) : null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async setDisconnected(
    tenantId: string,
    key: string,
    trx?: Transaction<DB>
  ): Promise<IntegrationRow | undefined> {
    return (trx || db)
      .updateTable("integrations")
      .set({ connected: false, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("key", "=", key)
      .returningAll()
      .executeTakeFirst();
  }

  // ---- Webhooks ----

  async listWebhooks(tenantId: string, trx?: Transaction<DB>): Promise<WebhookRow[]> {
    return (trx || db)
      .selectFrom("webhooks")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async findWebhookById(
    id: string,
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<WebhookRow | undefined> {
    return (trx || db)
      .selectFrom("webhooks")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async createWebhook(
    data: { tenant_id: string; url: string; event: string; secret: string },
    trx?: Transaction<DB>
  ): Promise<WebhookRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("webhooks")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        url: data.url,
        event: data.event,
        active: true,
        deliveries: 0,
        secret: data.secret,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async recordWebhookDelivery(
    id: string,
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<WebhookRow | undefined> {
    const now = new Date();
    return (trx || db)
      .updateTable("webhooks")
      .set((eb) => ({
        deliveries: eb("deliveries", "+", 1),
        last_delivery_at: now,
        updated_at: now,
      }))
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteWebhook(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("webhooks")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  // ---- API keys ----

  async listActiveApiKeys(tenantId: string) {
    return db
      .selectFrom("api_keys")
      .leftJoin("connected_apps", "connected_apps.id", "api_keys.app_id")
      .select([
        "api_keys.id as id",
        "api_keys.name as name",
        "api_keys.key_prefix as key_prefix",
        "api_keys.scope as scope",
        "api_keys.app_id as app_id",
        "connected_apps.name as app_name",
        "api_keys.last_used_at as last_used_at",
        "api_keys.created_at as created_at",
      ])
      .where("api_keys.tenant_id", "=", tenantId)
      .where("api_keys.revoked_at", "is", null)
      .orderBy("api_keys.created_at", "desc")
      .execute();
  }

  async createApiKey(
    data: {
      tenant_id: string;
      name: string;
      key_hash: string;
      key_prefix: string;
      created_by: string | null;
      // Both optional so the legacy workspace-key flow keeps compiling and
      // behaving identically: no app, SECRET scope.
      app_id?: string | null;
      scope?: string;
    },
    trx?: Transaction<DB>
  ): Promise<ApiKeyRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("api_keys")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        key_hash: data.key_hash,
        key_prefix: data.key_prefix,
        created_by: data.created_by,
        app_id: data.app_id ?? null,
        scope: data.scope ?? "SECRET",
        last_used_at: null,
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Authenticate an inbound API key: look up the (unique) sha256 hash. Returns
  // the row only when it exists AND is not revoked. Used by authenticateApiKey.
  async findActiveApiKeyByHash(keyHash: string): Promise<ApiKeyRow | undefined> {
    // Keys of a suspended or cancelled workspace stop working with it.
    return db
      .selectFrom("api_keys")
      .innerJoin("tenants", "tenants.id", "api_keys.tenant_id")
      .selectAll("api_keys")
      .where("api_keys.key_hash", "=", keyHash)
      .where("api_keys.revoked_at", "is", null)
      .where("tenants.status", "=", "ACTIVE")
      .executeTakeFirst();
  }

  // Fire-and-forget usage stamp so tenants can see when a key last authenticated.
  async touchApiKeyUsed(id: string): Promise<void> {
    const now = new Date();
    await db
      .updateTable("api_keys")
      .set({ last_used_at: now, updated_at: now })
      .where("id", "=", id)
      .execute();
  }

  async revokeApiKey(id: string, tenantId: string): Promise<boolean> {
    const now = new Date();
    const result = await db
      .updateTable("api_keys")
      .set({ revoked_at: now, updated_at: now })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0) > 0;
  }
}

export default new IntegrationsRepository();
