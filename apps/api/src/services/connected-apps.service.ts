import crypto from "crypto";
import {
  CATALOG_MODES,
  DEFAULT_CAPABILITIES,
  KEY_PREFIX,
  KEY_SCOPES,
  type AppCapabilities,
  type AppHealth,
  type KeyScope,
  deriveAppHealth,
  parseCapabilities,
  parseStringArray,
  slugifyAppKey,
} from "../constants/connected-apps.const";
import { LIMIT_CODES } from "../constants/modules.const";
import { EVENT_CATEGORIES, REVIEW_STATUSES } from "../constants/semantic-events.const";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import activityEventsRepository from "../repositories/activity-events.repository";
import connectedAppsRepository, {
  type ConnectedAppRow,
} from "../repositories/connected-apps.repository";
import engagementRepository from "../repositories/engagement.repository";
import eventDefinitionsRepository from "../repositories/event-definitions.repository";
import identitiesRepository from "../repositories/identities.repository";
import integrationsRepository from "../repositories/integrations.repository";
import productsRepository from "../repositories/products.repository";
import { encryptSecret } from "../utils/crypto";
import logger from "../utils/logger";
import engineService from "./engine.service";
import entitlementsService from "./entitlements.service";

// The client-facing shape. `actions_secret` is deliberately absent: like every
// other credential in this codebase it is write-only, shown once at rotation
// and never read back.
export interface ConnectedAppView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  product_url: string | null;
  status: string;
  environment: string;
  capabilities: AppCapabilities;
  catalog_mode: string;
  catalog_pull_url: string | null;
  last_catalog_sync_at: Date | null;
  actions_url: string | null;
  actions_configured: boolean;
  allowed_origins: string[];
  last_event_at: Date | null;
  health: AppHealth;
  health_detail: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

const toView = (row: ConnectedAppRow): ConnectedAppView => {
  const { health, detail } = deriveAppHealth(row);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    logo_url: row.logo_url,
    product_url: row.product_url,
    status: row.status,
    environment: row.environment,
    capabilities: parseCapabilities(row.capabilities),
    catalog_mode: row.catalog_mode,
    catalog_pull_url: row.catalog_pull_url,
    last_catalog_sync_at: row.last_catalog_sync_at,
    actions_url: row.actions_url,
    actions_configured: !!row.actions_secret,
    allowed_origins: parseStringArray(row.allowed_origins),
    last_event_at: row.last_event_at,
    health,
    health_detail: detail,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

const trimOrNull = (value: unknown): string | null => {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
};

// A product URL is rendered as a link on lead records and is used as the base
// for deep links, so reject anything that is not an absolute http(s) URL rather
// than storing a value that will silently produce broken links later.
//
// `httpsOnly` is used for the two URLs the SERVER calls (catalog feed, actions
// endpoint). guardedFetch refuses plain http, so accepting it here would store a
// value that only fails later inside a background sweep, where nobody sees it.
// Fail at configuration time instead, while an admin is looking at the screen.
const assertHttpUrl = (
  value: string | null,
  label: string,
  httpsOnly = false
): string | null => {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestError(`${label} must be a full URL including https://`);
  }
  if (httpsOnly) {
    if (parsed.protocol !== "https:") {
      throw new BadRequestError(`${label} must use https`);
    }
  } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadRequestError(`${label} must be an http or https URL`);
  }
  return parsed.toString();
};

export interface CreateAppInput {
  name?: string;
  key?: string;
  description?: string;
  logo_url?: string;
  product_url?: string;
  environment?: string;
  capabilities?: Record<string, unknown>;
  catalog_mode?: string;
  catalog_pull_url?: string;
  actions_url?: string;
  allowed_origins?: string[];
}

class ConnectedAppsService {
  async list(tenantId: string): Promise<ConnectedAppView[]> {
    const rows = await connectedAppsRepository.list(tenantId);
    return rows.map(toView);
  }

  async get(tenantId: string, id: string): Promise<ConnectedAppView> {
    const row = await connectedAppsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Connected product not found");
    return toView(row);
  }

  /** The app plus its live (non-revoked) keys, for the integration console. */
  async detail(tenantId: string, id: string) {
    const app = await this.get(tenantId, id);
    const keys = await connectedAppsRepository.listKeysForApp(tenantId, id);
    return { app, keys };
  }

  async create(
    tenantId: string,
    actorId: string,
    body: CreateAppInput
  ): Promise<ConnectedAppView> {
    const name = trimOrNull(body.name);
    if (!name) throw new BadRequestError("A product name is required");

    const key = slugifyAppKey(body.key || name);
    if (!key) {
      throw new BadRequestError("Could not derive a key from that name. Provide a key explicitly.");
    }

    const clash = await connectedAppsRepository.findByKey(tenantId, key);
    if (clash) throw new ConflictError(`A connected product with the key "${key}" already exists`);

    // Plan capacity. Checked here rather than at the route so the count and the
    // insert stay adjacent and the error names the real resource.
    const used = await connectedAppsRepository.countBillable(tenantId);
    await entitlementsService.ensureCapacity(
      tenantId,
      LIMIT_CODES.CONNECTED_APPS,
      used,
      1,
      "connected product"
    );

    const catalogMode = String(body.catalog_mode ?? "PUSH").toUpperCase();
    if (!(CATALOG_MODES as readonly string[]).includes(catalogMode)) {
      throw new BadRequestError(`catalog_mode must be one of ${CATALOG_MODES.join(", ")}`);
    }
    const catalogPullUrl = assertHttpUrl(trimOrNull(body.catalog_pull_url), "Catalog feed URL", true);
    if (catalogMode === "PULL" && !catalogPullUrl) {
      throw new BadRequestError("PULL mode needs a catalog feed URL");
    }

    const productUrl = assertHttpUrl(trimOrNull(body.product_url), "Product URL");
    const capabilities = parseCapabilities(body.capabilities ?? DEFAULT_CAPABILITIES);
    // deeplink is a fact about configuration, not a choice: it is true exactly
    // when we have a URL to link to.
    capabilities.deeplink = !!productUrl;

    const row = await connectedAppsRepository.create({
      tenant_id: tenantId,
      key,
      name,
      description: trimOrNull(body.description),
      logo_url: assertHttpUrl(trimOrNull(body.logo_url), "Logo URL"),
      product_url: productUrl,
      environment: String(body.environment ?? "LIVE").toUpperCase() === "TEST" ? "TEST" : "LIVE",
      capabilities: capabilities as unknown as Record<string, unknown>,
      catalog_mode: catalogMode,
      catalog_pull_url: catalogPullUrl,
      actions_url: assertHttpUrl(trimOrNull(body.actions_url), "Actions URL", true),
      allowed_origins: Array.isArray(body.allowed_origins)
        ? body.allowed_origins.filter((o): o is string => typeof o === "string")
        : [],
    });

    // Seed the reserved semantic vocabulary so the new integration has working
    // intent scoring and a full, labelled event list on day one, with no setup.
    // Best-effort: a seeding hiccup must not fail creating the product, and the
    // ingest path lazily registers any missing definition anyway.
    await eventDefinitionsRepository
      .seedSemanticEvents(tenantId, row.id)
      .catch((err) => logger.warn(`semantic event seed failed: ${String(err)}`));

    engineService.audit(tenantId, actorId, "connected_app.created", "connected_app", row.id, {
      key: row.key,
      environment: row.environment,
    });
    return toView(row);
  }

  // ---- Event definitions (the registry an admin reviews and tunes) ----

  async listEventDefinitions(tenantId: string, appId: string) {
    const app = await connectedAppsRepository.findById(appId, tenantId);
    if (!app) throw new NotFoundError("Connected product not found");
    return eventDefinitionsRepository.listForApp(tenantId, appId);
  }

  /**
   * Updates one event definition. This is where an auto-registered
   * NEEDS_REVIEW event gets a real label and weight and starts counting toward
   * intent, which is the deliberate human gate on the accept-everything ingest.
   */
  async updateEventDefinition(
    tenantId: string,
    actorId: string,
    definitionId: string,
    body: Record<string, unknown>
  ) {
    const existing = await eventDefinitionsRepository.findById(definitionId, tenantId);
    if (!existing) throw new NotFoundError("Event not found");

    const patch: Parameters<typeof eventDefinitionsRepository.update>[2] = {};

    if (body.label !== undefined) {
      const label = trimOrNull(body.label);
      if (!label) throw new BadRequestError("A label is required");
      patch.label = label.slice(0, 200);
    }
    if (body.description !== undefined) patch.description = trimOrNull(body.description);
    if (body.icon !== undefined) patch.icon = trimOrNull(body.icon);

    if (body.category !== undefined) {
      const category = String(body.category).toUpperCase();
      if (!(EVENT_CATEGORIES as readonly string[]).includes(category)) {
        throw new BadRequestError(`category must be one of ${EVENT_CATEGORIES.join(", ")}`);
      }
      patch.category = category;
    }

    if (body.intent_weight !== undefined) {
      const weight = Number(body.intent_weight);
      if (!Number.isFinite(weight) || weight < -100 || weight > 100) {
        throw new BadRequestError("intent_weight must be a number between -100 and 100");
      }
      patch.intent_weight = Math.round(weight);
    }

    if (body.is_high_intent !== undefined) patch.is_high_intent = body.is_high_intent === true;

    if (body.review_status !== undefined) {
      const status = String(body.review_status).toUpperCase();
      if (!(REVIEW_STATUSES as readonly string[]).includes(status)) {
        throw new BadRequestError(`review_status must be one of ${REVIEW_STATUSES.join(", ")}`);
      }
      patch.review_status = status;
    }

    const updated = await eventDefinitionsRepository.update(definitionId, tenantId, patch);
    if (!updated) throw new NotFoundError("Event not found");

    engineService.audit(
      tenantId,
      actorId,
      "event_definition.updated",
      "event_definition",
      definitionId,
      { name: updated.name, fields: Object.keys(patch) }
    );
    return updated;
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    body: CreateAppInput & { status?: string }
  ): Promise<ConnectedAppView> {
    const existing = await connectedAppsRepository.findById(id, tenantId);
    if (!existing) throw new NotFoundError("Connected product not found");

    const patch: Parameters<typeof connectedAppsRepository.update>[2] = {};

    if (body.name !== undefined) {
      const name = trimOrNull(body.name);
      if (!name) throw new BadRequestError("A product name is required");
      patch.name = name;
    }
    if (body.description !== undefined) patch.description = trimOrNull(body.description);
    if (body.logo_url !== undefined) {
      patch.logo_url = assertHttpUrl(trimOrNull(body.logo_url), "Logo URL");
    }
    if (body.product_url !== undefined) {
      patch.product_url = assertHttpUrl(trimOrNull(body.product_url), "Product URL");
    }
    if (body.actions_url !== undefined) {
      patch.actions_url = assertHttpUrl(trimOrNull(body.actions_url), "Actions URL", true);
    }
    if (body.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!["ACTIVE", "PAUSED", "DISABLED"].includes(status)) {
        throw new BadRequestError("status must be ACTIVE, PAUSED or DISABLED");
      }
      patch.status = status;
    }
    if (body.environment !== undefined) {
      patch.environment = String(body.environment).toUpperCase() === "TEST" ? "TEST" : "LIVE";
    }
    if (body.catalog_mode !== undefined) {
      const mode = String(body.catalog_mode).toUpperCase();
      if (!(CATALOG_MODES as readonly string[]).includes(mode)) {
        throw new BadRequestError(`catalog_mode must be one of ${CATALOG_MODES.join(", ")}`);
      }
      patch.catalog_mode = mode;
    }
    if (body.catalog_pull_url !== undefined) {
      patch.catalog_pull_url = assertHttpUrl(trimOrNull(body.catalog_pull_url), "Catalog feed URL", true);
    }
    if (body.allowed_origins !== undefined) {
      patch.allowed_origins = Array.isArray(body.allowed_origins)
        ? body.allowed_origins.filter((o): o is string => typeof o === "string")
        : [];
    }
    if (body.capabilities !== undefined) {
      const caps = parseCapabilities(body.capabilities);
      const url = patch.product_url !== undefined ? patch.product_url : existing.product_url;
      caps.deeplink = !!url;
      patch.capabilities = caps as unknown as Record<string, unknown>;
    }

    // Resolving PULL mode needs the post-patch view of both fields, not just
    // whichever one this request happened to include.
    const nextMode = patch.catalog_mode ?? existing.catalog_mode;
    const nextPullUrl =
      patch.catalog_pull_url !== undefined ? patch.catalog_pull_url : existing.catalog_pull_url;
    if (nextMode === "PULL" && !nextPullUrl) {
      throw new BadRequestError("PULL mode needs a catalog feed URL");
    }

    const updated = await connectedAppsRepository.update(id, tenantId, patch);
    if (!updated) throw new NotFoundError("Connected product not found");

    engineService.audit(tenantId, actorId, "connected_app.updated", "connected_app", id, {
      fields: Object.keys(patch),
    });
    return toView(updated);
  }

  /**
   * Removes a connected product and everything it owns.
   *
   * These tables carry no database-level FK to connected_apps (the same choice
   * the rest of this schema makes for polymorphic-ish links), so the cleanup is
   * explicit here. Missing it would leave orphaned catalog rows and engagement
   * profiles that render as blank cards on lead records forever.
   *
   * The API keys bound to the app are REVOKED rather than deleted, so the audit
   * trail of what that key did survives the product being removed.
   */
  async remove(tenantId: string, actorId: string, id: string) {
    const existing = await connectedAppsRepository.findById(id, tenantId);
    if (!existing) throw new NotFoundError("Connected product not found");

    const keys = await connectedAppsRepository.listKeysForApp(tenantId, id);
    for (const key of keys) {
      await integrationsRepository.revokeApiKey(key.id, tenantId).catch(() => undefined);
    }

    await Promise.all([
      productsRepository.deleteForApp(tenantId, id),
      eventDefinitionsRepository.deleteForApp(tenantId, id),
      identitiesRepository.deleteForApp(tenantId, id),
      engagementRepository.deleteForApp(tenantId, id),
      activityEventsRepository.deleteForApp(tenantId, id),
    ]);

    const deleted = await connectedAppsRepository.delete(id, tenantId);
    if (!deleted) throw new NotFoundError("Connected product not found");

    engineService.audit(tenantId, actorId, "connected_app.deleted", "connected_app", id, {
      key: existing.key,
      revokedKeys: keys.length,
    });
    return { ok: true };
  }

  /**
   * Mints an API key bound to this app. The raw key is returned exactly once;
   * only its sha256 hash is stored, matching the existing workspace-key flow.
   */
  async createKey(
    tenantId: string,
    actorId: string,
    appId: string,
    body: { name?: string; scope?: string }
  ) {
    const app = await connectedAppsRepository.findById(appId, tenantId);
    if (!app) throw new NotFoundError("Connected product not found");

    const scope = String(body.scope ?? "SECRET").toUpperCase() as KeyScope;
    if (!(KEY_SCOPES as readonly string[]).includes(scope)) {
      throw new BadRequestError(`scope must be one of ${KEY_SCOPES.join(", ")}`);
    }

    // A publishable key that no origin may use is a key that cannot work. Fail
    // loudly at mint time rather than at 3am in someone's browser console.
    if (scope === "PUBLISHABLE" && parseStringArray(app.allowed_origins).length === 0) {
      throw new BadRequestError(
        "Add at least one allowed origin to this product before creating a browser key"
      );
    }

    const rawKey = `${KEY_PREFIX[scope]}${crypto.randomBytes(16).toString("hex")}`;
    const row = await integrationsRepository.createApiKey({
      tenant_id: tenantId,
      name: trimOrNull(body.name) ?? `${app.name} ${scope === "PUBLISHABLE" ? "browser" : "server"} key`,
      key_hash: crypto.createHash("sha256").update(rawKey).digest("hex"),
      key_prefix: rawKey.slice(0, KEY_PREFIX[scope].length + 5),
      created_by: actorId,
      app_id: appId,
      scope,
    });

    engineService.audit(tenantId, actorId, "connected_app.key_created", "connected_app", appId, {
      keyId: row.id,
      scope,
    });

    return {
      id: row.id,
      name: row.name,
      scope,
      key: rawKey,
      key_prefix: row.key_prefix,
      created_at: row.created_at,
      note: "Save this key now. It will not be shown again.",
    };
  }

  /**
   * Rotates the shared secret used to sign outbound action calls. Returned in
   * clear exactly once; stored AES-256-GCM encrypted, same as calendar tokens.
   */
  async rotateActionsSecret(tenantId: string, actorId: string, id: string) {
    const app = await connectedAppsRepository.findById(id, tenantId);
    if (!app) throw new NotFoundError("Connected product not found");

    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    await connectedAppsRepository.update(id, tenantId, {
      actions_secret: encryptSecret(secret),
    });

    engineService.audit(
      tenantId,
      actorId,
      "connected_app.actions_secret_rotated",
      "connected_app",
      id
    );
    return { secret, note: "Save this secret now. It will not be shown again." };
  }
}

export default new ConnectedAppsService();
