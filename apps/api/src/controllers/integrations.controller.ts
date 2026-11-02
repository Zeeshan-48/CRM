import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import ingestService from "../services/ingest.service";
import integrationsService from "../services/integrations.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const INGEST_BASE = "/api/v1/ingest/leads";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const listIntegrations = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await integrationsService.catalogue(tenantId) });
};

export const listConnections = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({ res, data: await integrationsService.connections(tenantId, actorId) });
};

export const connectIntegration = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.connect(tenantId, actorId, String(req.params.key), req.body ?? {}),
    message: "Integration connected",
  });
};

export const disconnectIntegration = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.disconnect(tenantId, actorId, String(req.params.key)),
    message: "Integration disconnected",
  });
};

export const listWebhooks = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await integrationsService.listWebhooks(tenantId) });
};

export const createWebhook = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.createWebhook(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Webhook created. Save the secret now, it will not be shown again.",
  });
};

export const testWebhook = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.testWebhook(
      tenantId,
      req.tenant?.slug ?? "",
      String(req.params.id)
    ),
  });
};

export const deleteWebhook = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.deleteWebhook(tenantId, String(req.params.id)),
    message: "Webhook deleted",
  });
};

export const listApiKeys = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await integrationsService.listApiKeys(tenantId) });
};

export const createApiKey = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.createApiKey(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "API key created. Save it now, it will not be shown again.",
  });
};

export const revokeApiKey = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.revokeApiKey(tenantId, actorId, String(req.params.id)),
    message: "API key revoked",
  });
};

// ---- Inbound lead capture (ingest) ----

export const getIngestSettings = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const token = await ingestService.getOrCreateToken(tenantId);
  sendSuccessResponse({
    res,
    data: {
      token,
      apiKeyPath: INGEST_BASE,
      tokenPath: `${INGEST_BASE}/t/${token}`,
    },
  });
};

export const rotateIngestToken = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const token = await ingestService.rotateToken(tenantId, actorId);
  sendSuccessResponse({
    res,
    data: { token, apiKeyPath: INGEST_BASE, tokenPath: `${INGEST_BASE}/t/${token}` },
    message: "Ingest token rotated",
  });
};

export const listIngestEvents = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const limit = Number(req.query.limit) || 50;
  sendSuccessResponse({ res, data: await ingestService.listEvents(tenantId, limit) });
};

export const getSecurity = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await integrationsService.security(tenantId) });
};

export const updateSecurity = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.updateSecurity(tenantId, actorId, req.body ?? {}),
    message: "Security settings updated",
  });
};

// ---- Outbound delivery log ----

export const listWebhookDeliveries = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const limitRaw = Number(req.query.limit);
  sendSuccessResponse({
    res,
    data: await integrationsService.listDeliveries(tenantId, {
      webhookId: typeof req.query.webhook_id === "string" ? req.query.webhook_id : undefined,
      status: typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
    }),
  });
};

export const replayWebhookDelivery = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await integrationsService.replayDelivery(tenantId, actorId, String(req.params.id)),
    message: "Delivery queued for another attempt",
  });
};
