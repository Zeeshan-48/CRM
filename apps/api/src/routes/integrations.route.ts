import { Router } from "express";
import {
  connectIntegration,
  createApiKey,
  createWebhook,
  deleteWebhook,
  disconnectIntegration,
  getIngestSettings,
  getSecurity,
  listApiKeys,
  listConnections,
  listIngestEvents,
  listIntegrations,
  listWebhookDeliveries,
  listWebhooks,
  revokeApiKey,
  rotateIngestToken,
  replayWebhookDelivery,
  testWebhook,
  updateSecurity,
} from "../controllers/integrations.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:key (avoids shadowing).
router.get("/", asyncHandler(listIntegrations));

// Read-only connection dashboard: aggregates the real per-service statuses.
router.get("/connections", asyncHandler(listConnections));

router.get("/webhooks", asyncHandler(listWebhooks));
router.post("/webhooks", asyncHandler(createWebhook));
router.post("/webhooks/:id/test", asyncHandler(testWebhook));
router.delete("/webhooks/:id", asyncHandler(deleteWebhook));

// Outbound delivery log: every attempt with its payload, response and error,
// plus replay. Without this, debugging a webhook is guesswork.
router.get("/webhook-deliveries", asyncHandler(listWebhookDeliveries));
router.post("/webhook-deliveries/:id/replay", asyncHandler(replayWebhookDelivery));

router.get("/api-keys", asyncHandler(listApiKeys));
router.post("/api-keys", asyncHandler(createApiKey));
router.delete("/api-keys/:id", asyncHandler(revokeApiKey));

// Inbound lead capture: the per-tenant ingest token + recent deliveries log.
router.get("/ingest", asyncHandler(getIngestSettings));
router.post("/ingest/rotate-token", asyncHandler(requireCapability("settings")), asyncHandler(rotateIngestToken));
router.get("/ingest/events", asyncHandler(listIngestEvents));

router.get("/security", asyncHandler(getSecurity));
router.put("/security", asyncHandler(requireCapability("settings")), asyncHandler(updateSecurity));

router.post("/:key/connect", asyncHandler(connectIntegration));
router.post("/:key/disconnect", asyncHandler(disconnectIntegration));

export default router;
