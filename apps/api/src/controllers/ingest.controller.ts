import { Request, Response } from "express";
import { DEFAULT_APP_KEY } from "../constants/connected-apps.const";
import { UnauthorizedError } from "../errors";
import activityEventsService from "../services/activity-events.service";
import catalogSyncService, { type CatalogSyncContext } from "../services/catalog-sync.service";
import identityService, { type IdentityContext } from "../services/identity.service";
import ingestService, { IngestContext } from "../services/ingest.service";
import integrationHealthService from "../services/integration-health.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

/**
 * The lead `source` a key stamps on what it captures.
 *
 * The product name is the useful answer for a real connected product ("Acme
 * Learning" beats "Acme Learning server key"). But keys that pre-date connected
 * products are bound to the auto-created "Default product" shim, whose name says
 * nothing, and their key name is the source the workspace has always seen
 * ("Zapier", "Partner import"). So: real product wins, shim defers to the key.
 */
export const sourceForKey = (key: NonNullable<Request["apiKey"]>): string => {
  if (key.appKey && key.appKey !== DEFAULT_APP_KEY) return key.appName || key.name || "Product";
  return key.name || "API";
};

// Every API-key route resolves its connected product from the key, so a producer
// never names itself in a payload and can never write to another product.
const keyCtx = (req: Request): IngestContext => {
  const key = req.apiKey;
  if (!key) throw new UnauthorizedError("API key required");
  return {
    tenantId: key.tenantId,
    apiKeyId: key.id,
    apiKeyCreatedBy: key.createdBy,
    defaultSource: sourceForKey(key),
    appId: key.appId,
    appName: key.appName,
    environment: key.environment,
  };
};

const catalogCtx = (req: Request): CatalogSyncContext => {
  const key = req.apiKey;
  if (!key) throw new UnauthorizedError("API key required");
  return { tenantId: key.tenantId, appId: key.appId, actorId: key.createdBy };
};

const identityCtx = (req: Request): IdentityContext => {
  const key = req.apiKey;
  if (!key) throw new UnauthorizedError("API key required");
  return {
    tenantId: key.tenantId,
    appId: key.appId,
    apiKeyCreatedBy: key.createdBy,
    defaultSource: sourceForKey(key),
  };
};

// ---- Lead capture ----

// POST /api/v1/ingest/leads  (authenticated by API key via authenticateApiKey)
export const ingestViaApiKey = async (req: Request, res: Response) => {
  const result = await ingestService.ingestLead(keyCtx(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: result.spam ? "Received" : result.deduped ? "Lead updated" : "Lead created",
  });
};

// POST /api/v1/ingest/leads/t/:token  (no-code form tools; token in the URL)
export const ingestViaToken = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  const tenantId = await ingestService.tenantForToken(token);
  const ctx: IngestContext = {
    tenantId,
    apiKeyId: null,
    apiKeyCreatedBy: null,
    defaultSource: "Web form",
  };
  const result = await ingestService.ingestLead(ctx, req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: result.spam ? "Received" : result.deduped ? "Lead updated" : "Lead created",
  });
};

// ---- Identity ----

// POST /api/v1/ingest/identify
export const identify = async (req: Request, res: Response) => {
  const result = await identityService.identify(identityCtx(req), (req.body ?? {}) as Record<string, unknown>);
  sendSuccessResponse({
    res,
    data: result,
    message: result.backfilled
      ? `Identified. ${result.backfilled} earlier event(s) claimed.`
      : "Identified",
  });
};

// ---- Product events ----

// POST /api/v1/ingest/events
export const ingestEvent = async (req: Request, res: Response) => {
  const result = await activityEventsService.ingestEvent(keyCtx(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: result.deduped ? "Event already recorded" : "Event recorded",
  });
};

// POST /api/v1/ingest/events/batch
export const ingestEventBatch = async (req: Request, res: Response) => {
  const result = await activityEventsService.ingestBatch(keyCtx(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: `${result.recorded} recorded, ${result.deduped} duplicate, ${result.orphaned} awaiting identity, ${result.rejected} rejected`,
  });
};

// ---- Catalog ----

// PUT /api/v1/ingest/catalog  (secret key only)
export const syncCatalog = async (req: Request, res: Response) => {
  const result = await catalogSyncService.syncProducts(catalogCtx(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    message: `Catalog synced: ${result.created} created, ${result.updated} updated${
      result.archived ? `, ${result.archived} archived` : ""
    }`,
  });
};

// PUT /api/v1/ingest/catalog/offers  (secret key only)
export const syncCatalogOffers = async (req: Request, res: Response) => {
  const result = await catalogSyncService.syncOffers(catalogCtx(req), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    message: `Offers synced: ${result.created} created, ${result.updated} updated`,
  });
};

// ---- Self-service diagnostics ----

// GET /api/v1/ingest/health  (secret key only)
export const integrationHealth = async (req: Request, res: Response) => {
  const key = req.apiKey;
  if (!key) throw new UnauthorizedError("API key required");
  sendSuccessResponse({
    res,
    data: await integrationHealthService.report(key.tenantId, key.appId),
  });
};
