import { NextFunction, Request, Response, Router } from "express";
import {
  identify,
  ingestEvent,
  ingestEventBatch,
  ingestViaApiKey,
  ingestViaToken,
  integrationHealth,
  syncCatalog,
  syncCatalogOffers,
} from "../controllers/ingest.controller";
import { authenticateApiKey, requireSecretKey } from "../middlewares/api-key.middleware";
import {
  activityEventsLimiter,
  catalogSyncLimiter,
  leadIngestLimiter,
  trackerLimiter,
} from "../middlewares/rate-limit.middleware";
import { INGEST_OPENAPI } from "../services/ingest-openapi";
import { TRACKER_SCRIPT, TRACKER_VERSION } from "../services/tracker-script";
import { asyncHandler } from "../utils/asynchandler";
import { syncCatalogSchema, syncOffersSchema } from "../validators/products.schema";
import { validateBody } from "../middlewares/validate.middleware";

// Public inbound integration endpoints. Mounted OUTSIDE the JWT-guarded API in
// app.ts. Authenticated by a workspace API key (Bearer / X-API-Key) or, for
// no-code form tools that cannot send headers, a signed token in the URL.
//
// authenticateApiKey resolves the key to exactly ONE connected product, so a
// producer never names itself in a payload and can never write to another
// product's catalog or event stream.
const router = Router();

// Browser traffic (publishable keys) gets its own per-key, per-IP bucket on top
// of the shared events bucket, so one busy page cannot drain the workspace.
const browserLimiter = (req: Request, res: Response, next: NextFunction) =>
  req.apiKey?.scope === "PUBLISHABLE" ? trackerLimiter(req, res, next) : next();

// ---- Browser tracker ----
//
// Served from here rather than a CDN so a product only ever has to trust one
// origin, and so the script and the API it talks to can never drift apart.
// Public and unauthenticated by design: the script itself carries no secret,
// the PUBLISHABLE key in the page does, and that key is origin-locked.
router.get("/t.js", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  // Short cache: long enough that a busy site is not refetching constantly,
  // short enough that a fix reaches every page within the hour.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("X-CRM-Tracker-Version", TRACKER_VERSION);
  res.send(TRACKER_SCRIPT);
});

// ---- Machine-readable contract ----
//
// Public and unauthenticated: it describes the shape of the API, not any
// workspace's data, and an integrating engineer needs it BEFORE they have a key.
// Served from the API itself so a client generator pointed at a deployment always
// gets that deployment's contract instead of a docs page that has drifted.
router.get("/openapi.json", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(INGEST_OPENAPI);
});

// ---- Lead capture ----

// Programmatic callers (Zapier, partners, custom forms with a header).
router.post(
  "/leads",
  asyncHandler(authenticateApiKey),
  asyncHandler(requireSecretKey),
  leadIngestLimiter,
  asyncHandler(ingestViaApiKey)
);

// No-code form tools: the secret rides in the path, tenant resolved from it.
router.post("/leads/t/:token", leadIngestLimiter, asyncHandler(ingestViaToken));

// ---- Identity ----

// Binds an identity to a person and back-fills everything they did anonymously
// before this call. Reachable by a browser key: this is what the tracker calls
// the moment a visitor logs in or submits a form.
router.post(
  "/identify",
  asyncHandler(authenticateApiKey),
  browserLimiter,
  activityEventsLimiter,
  asyncHandler(identify)
);

// ---- Product activity ----

// Product activity sync. Attaches events to a person, or stores them against an
// anonymous id to be claimed later. Separate rate-limit bucket so events cannot
// starve lead ingest. Reachable by a PUBLISHABLE (browser) key: this is the
// tracker's endpoint, and the origin allowlist is what guards it.
router.post(
  "/events",
  asyncHandler(authenticateApiKey),
  browserLimiter,
  activityEventsLimiter,
  asyncHandler(ingestEvent)
);

// Batch variant for server-side producers flushing a queue. Per-event fault
// isolation: one bad event never rejects the rest of the batch.
router.post(
  "/events/batch",
  asyncHandler(authenticateApiKey),
  asyncHandler(requireSecretKey),
  activityEventsLimiter,
  asyncHandler(ingestEventBatch)
);

// ---- Catalog ----

// Catalog writes are SECRET-key only. A publishable key ships in page source, so
// allowing it here would let anyone who viewed source rewrite a tenant's prices.
router.put(
  "/catalog",
  asyncHandler(authenticateApiKey),
  asyncHandler(requireSecretKey),
  catalogSyncLimiter,
  validateBody(syncCatalogSchema),
  asyncHandler(syncCatalog)
);

router.put(
  "/catalog/offers",
  asyncHandler(authenticateApiKey),
  asyncHandler(requireSecretKey),
  catalogSyncLimiter,
  validateBody(syncOffersSchema),
  asyncHandler(syncCatalogOffers)
);

// ---- Self-service diagnostics ----

// Lets an integrating team answer "is my integration working?" themselves,
// without opening a ticket or asking anyone to read a log.
router.get(
  "/health",
  asyncHandler(authenticateApiKey),
  asyncHandler(requireSecretKey),
  asyncHandler(integrationHealth)
);

export default router;
