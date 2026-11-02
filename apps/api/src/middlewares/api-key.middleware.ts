import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { isOriginAllowed, parseStringArray } from "../constants/connected-apps.const";
import { ForbiddenError, UnauthorizedError } from "../errors";
import connectedAppsRepository from "../repositories/connected-apps.repository";
import integrationsRepository from "../repositories/integrations.repository";
import logger from "../utils/logger";

// Extracts the raw key from `Authorization: Bearer <key>`, `X-API-Key`, or the
// `?k=` query parameter.
//
// The query parameter exists for exactly one caller: navigator.sendBeacon, which
// the browser tracker uses so the last page view survives a page unload and
// which cannot set request headers. It is restricted below to PUBLISHABLE keys,
// because a query string lands in access logs, proxy logs and Referer headers,
// and a secret key must never end up there.
const readRawKey = (req: Request): { key: string; fromQuery: boolean } | null => {
  const header = req.headers.authorization;
  if (header) {
    const parts = header.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer" && parts[1]) {
      return { key: parts[1].trim(), fromQuery: false };
    }
  }
  const alt = req.headers["x-api-key"];
  if (typeof alt === "string" && alt.trim()) return { key: alt.trim(), fromQuery: false };

  const query = req.query?.k;
  if (typeof query === "string" && query.trim()) return { key: query.trim(), fromQuery: true };

  return null;
};

// Authenticates a request with a workspace API key (crm_sk_... / crm_pk_...).
// Resolves the tenant AND the connected app, sets req.apiKey + req.tenantId, and
// stamps last_used_at (best-effort). Public ingest routes use this instead of the
// tenant JWT. Never leaks whether a key merely exists vs is revoked: both yield
// the same 401.
export const authenticateApiKey = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const raw = readRawKey(req);
  if (!raw) throw new UnauthorizedError("API key required");

  const keyHash = crypto.createHash("sha256").update(raw.key).digest("hex");
  const row = await integrationsRepository.findActiveApiKeyByHash(keyHash);
  if (!row) throw new UnauthorizedError("Invalid or revoked API key");

  // A secret key in a query string has already leaked into logs by the time we
  // see it. Refuse it and say why, so the mistake is fixed rather than repeated.
  if (raw.fromQuery && row.scope !== "PUBLISHABLE") {
    throw new UnauthorizedError(
      "A secret key must be sent as a header, never in the URL. Use Authorization: Bearer or X-API-Key."
    );
  }

  // Legacy keys pre-date connected products and carry app_id = NULL. Rather than
  // break every producer that already holds one, bind it to the tenant's auto
  // created "Default product" on first use. This runs once per key: afterwards
  // the column is set and the fast path applies.
  let appId = row.app_id;
  if (!appId) {
    const fallback = await connectedAppsRepository.ensureDefaultApp(row.tenant_id);
    appId = fallback.id;
    await connectedAppsRepository
      .bindApiKeyToApp(row.id, fallback.id)
      .catch((err) => logger.warn(`api key app-bind failed: ${String(err)}`));
  }

  const app = await connectedAppsRepository.findByIdUnscoped(appId);
  if (!app) throw new UnauthorizedError("Invalid or revoked API key");
  if (app.status === "DISABLED") {
    throw new ForbiddenError("This connected product is disabled");
  }
  if (app.status === "PAUSED") {
    throw new ForbiddenError("This connected product is paused. Resume it to send data.");
  }

  const scope = row.scope === "PUBLISHABLE" ? "PUBLISHABLE" : "SECRET";

  // A publishable key ships in page source, so the only thing standing between
  // it and anyone on the internet is the origin allowlist. Enforce it here, once,
  // rather than per-route where it could be forgotten.
  if (scope === "PUBLISHABLE") {
    const allowed = parseStringArray(app.allowed_origins);
    const origin =
      (typeof req.headers.origin === "string" && req.headers.origin) ||
      (typeof req.headers.referer === "string" && req.headers.referer) ||
      "";
    if (!origin || !isOriginAllowed(origin, allowed)) {
      throw new ForbiddenError("This origin is not allowed to use this key");
    }
  }

  req.apiKey = {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by,
    name: row.name,
    appId: app.id,
    appKey: app.key,
    appName: app.name,
    scope,
    environment: app.environment === "TEST" ? "TEST" : "LIVE",
  };
  req.tenantId = row.tenant_id;

  // Fire-and-forget: a usage-stamp failure must never block ingestion.
  integrationsRepository
    .touchApiKeyUsed(row.id)
    .catch((err) => logger.warn(`api key touch failed: ${String(err)}`));

  next();
};

/**
 * Guards routes a browser key must never reach: catalog writes, health reads,
 * anything that is not track / page / identify. Mount AFTER authenticateApiKey.
 *
 * The split matters because a publishable key is public by construction. Without
 * this, anyone who viewed source could rewrite a tenant's product catalog.
 */
export const requireSecretKey = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const key = req.apiKey;
  if (!key) throw new UnauthorizedError("API key required");
  if (key.scope !== "SECRET") {
    throw new ForbiddenError(
      "This endpoint requires a secret key (crm_sk_). Browser keys can only send events."
    );
  }
  next();
};
