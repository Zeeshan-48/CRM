import { apiDelete, apiGet, apiPost } from "./client";

// Read-only "Connected services" dashboard. Every real integration is configured
// on its own page (WhatsApp, Email, Finance, Telephony, etc.); this endpoint
// aggregates each one's live status so an admin sees everything in one place.

export type ConnectionState =
  | "connected"
  | "pending"
  | "default"
  | "simulated"
  | "not_connected"
  | "unavailable";

export interface ConnectionStatus {
  key: string;
  name: string;
  category: string;
  scope: "tenant" | "user" | "platform";
  state: ConnectionState;
  detail: string | null;
  managePath: string | null;
}

export const listConnections = () => apiGet<ConnectionStatus[]>("/integrations/connections");

// ---- Inbound lead capture (webhooks / API) ----

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}

// The raw key is returned exactly once, on creation.
export interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  created_at: string;
  note: string;
}

export interface IngestSettings {
  token: string;
  apiKeyPath: string;
  tokenPath: string;
}

export type IngestEventStatus = "CREATED" | "DEDUPED" | "REJECTED" | "SPAM";

export interface IngestEvent {
  id: string;
  source: string;
  external_id: string | null;
  status: IngestEventStatus;
  lead_id: string | null;
  error: string | null;
  created_at: string;
}

export const listApiKeys = () => apiGet<ApiKey[]>("/integrations/api-keys");

export const createApiKey = (name: string) =>
  apiPost<CreatedApiKey>("/integrations/api-keys", { name });

export const revokeApiKey = (id: string) =>
  apiDelete<{ ok: boolean }>(`/integrations/api-keys/${id}`);

export const getIngestSettings = () => apiGet<IngestSettings>("/integrations/ingest");

export const rotateIngestToken = () =>
  apiPost<IngestSettings>("/integrations/ingest/rotate-token", {});

export const listIngestEvents = () => apiGet<IngestEvent[]>("/integrations/ingest/events");

// Absolute origin of the API (without the /api/v1 suffix), for showing the full
// public ingest URL a tenant pastes into their form / Zapier.
export const apiOrigin = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5066/api/v1"
).replace(/\/api\/v1\/?$/, "");

// ---------------------------------------------------------------------------
// Outbound delivery log
// ---------------------------------------------------------------------------

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: unknown;
  status: "PENDING" | "SENDING" | "SUCCEEDED" | "FAILED" | "EXHAUSTED";
  attempt: number;
  response_code: number | null;
  response_body: string | null;
  error: string | null;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

// ---- Webhook subscriptions (CRM -> your product) ----

export interface Webhook {
  id: string;
  url: string;
  event: string;
  active: boolean;
  deliveries: number;
  last_delivery_at: string | null;
  created_at: string;
}

export interface WebhookList {
  events: string[];
  webhooks: Webhook[];
}

export const listWebhooks = () => apiGet<WebhookList>("/integrations/webhooks");

export const createWebhook = (body: { url: string; event: string }) =>
  apiPost<Webhook & { secret: string }>("/integrations/webhooks", body);

export const testWebhook = (id: string) =>
  apiPost<{
    ok: boolean;
    delivery: {
      id: string;
      event: string;
      url: string;
      status: string;
      response_code: number | null;
      error: string | null;
    };
  }>(`/integrations/webhooks/${id}/test`, {});

export const deleteWebhook = (id: string) =>
  apiDelete<{ ok: boolean }>(`/integrations/webhooks/${id}`);

export const listWebhookDeliveries = (params: { status?: string; limit?: number } = {}) =>
  apiGet<WebhookDelivery[]>("/integrations/webhook-deliveries", { params });

export const replayWebhookDelivery = (id: string) =>
  apiPost<{ ok: boolean }>(`/integrations/webhook-deliveries/${id}/replay`, {});
