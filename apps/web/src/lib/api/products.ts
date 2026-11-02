import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./client";

// ---------------------------------------------------------------------------
// Connected products (the external systems wired into this workspace)
// ---------------------------------------------------------------------------

export type AppStatus = "ACTIVE" | "PAUSED" | "DISABLED";
export type AppHealth = "PENDING" | "OK" | "STALE" | "ERROR";
export type KeyScope = "SECRET" | "PUBLISHABLE";

export interface AppCapabilities {
  catalog: boolean;
  events: boolean;
  identity: boolean;
  deeplink: boolean;
  outbound: boolean;
  actions: boolean;
}

export interface ConnectedApp {
  id: string;
  key: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  product_url: string | null;
  status: AppStatus;
  environment: "LIVE" | "TEST";
  capabilities: AppCapabilities;
  catalog_mode: "PUSH" | "PULL" | "MANUAL";
  catalog_pull_url: string | null;
  last_catalog_sync_at: string | null;
  actions_url: string | null;
  actions_configured: boolean;
  allowed_origins: string[];
  last_event_at: string | null;
  health: AppHealth;
  health_detail: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppKey {
  id: string;
  name: string;
  key_prefix: string;
  scope: KeyScope;
  last_used_at: string | null;
  created_at: string;
}

export interface CreatedKey extends AppKey {
  /** The raw key. Returned exactly once, at creation. */
  key: string;
  note: string;
}

export interface EventDefinition {
  id: string;
  app_id: string;
  name: string;
  label: string;
  description: string | null;
  category: "PAGE" | "ACTION" | "LIFECYCLE" | "COMMERCE" | "SUPPORT";
  icon: string | null;
  intent_weight: number;
  is_high_intent: boolean;
  review_status: "ACTIVE" | "NEEDS_REVIEW" | "IGNORED";
  auto_registered: boolean;
  event_count: number;
  last_seen_at: string | null;
}

export interface ProductAction {
  key: string;
  label: string;
  description?: string;
  params_schema?: Record<string, unknown>;
  confirm?: boolean;
}

export const listConnectedApps = () => apiGet<ConnectedApp[]>("/connected-apps");

export const getConnectedApp = (id: string) =>
  apiGet<{ app: ConnectedApp; keys: AppKey[] }>(`/connected-apps/${id}`);

export const createConnectedApp = (body: Record<string, unknown>) =>
  apiPost<ConnectedApp>("/connected-apps", body);

export const updateConnectedApp = (id: string, body: Record<string, unknown>) =>
  apiPatch<ConnectedApp>(`/connected-apps/${id}`, body);

export const deleteConnectedApp = (id: string) =>
  apiDelete<{ ok: boolean }>(`/connected-apps/${id}`);

export const createAppKey = (id: string, body: { name?: string; scope?: KeyScope }) =>
  apiPost<CreatedKey>(`/connected-apps/${id}/keys`, body);

export const rotateActionsSecret = (id: string) =>
  apiPost<{ secret: string; note: string }>(`/connected-apps/${id}/rotate-actions-secret`, {});

export const listEventDefinitions = (id: string) =>
  apiGet<EventDefinition[]>(`/connected-apps/${id}/events`);

export const updateEventDefinition = (
  appId: string,
  definitionId: string,
  body: Record<string, unknown>
) => apiPatch<EventDefinition>(`/connected-apps/${appId}/events/${definitionId}`, body);

export const listProductActions = () =>
  apiGet<Array<{ app_id: string; app_name: string; actions: ProductAction[] }>>(
    "/connected-apps/actions"
  );

export const invokeProductAction = (
  appId: string,
  actionKey: string,
  body: { params?: Record<string, unknown>; lead_id?: string; contact_id?: string }
) =>
  apiPost<{ ok: boolean; message: string; data?: unknown }>(
    `/connected-apps/${appId}/actions/${actionKey}`,
    body
  );

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface ProductPrice {
  currency: string;
  amount_minor: number;
  amount_display: string;
  compare_at_minor: number | null;
  compare_at_display: string | null;
  savings_percent: number;
  billing_period: "ONE_TIME" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  is_default: boolean;
}

export interface ProductOffer {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  terms: string | null;
  discount_type: "PERCENT" | "FLAT";
  discount_value: number;
  discount_minor: number;
  discount_display: string;
  final_minor: number;
  final_display: string;
  days_left: number | null;
  ends_at: string | null;
  redemptions_left: number | null;
}

export interface Product {
  id: string;
  app_id: string | null;
  app_name: string | null;
  external_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  family: string | null;
  url: string | null;
  media: { thumbnail?: string | null; images?: string[] } | null;
  attributes: Record<string, unknown> | null;
  highlights: string[];
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  source: "SYNCED" | "MANUAL";
  /** SYNCED products are owned by the external system and read-only here. */
  editable: boolean;
  total_sales: number;
  synced_at: string | null;
  price: ProductPrice | null;
  prices: ProductPrice[];
  offers: ProductOffer[];
  best_offer: ProductOffer | null;
  created_at: string;
  updated_at: string;
}

export interface ProductListResult {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProductFilters {
  q?: string;
  app_id?: string;
  category?: string;
  status?: string;
  source?: string;
  currency?: string;
  limit?: number;
  offset?: number;
}

export const listProducts = (filters: ProductFilters = {}) =>
  apiGet<ProductListResult>("/products", { params: filters });

export const listProductCategories = () => apiGet<string[]>("/products/categories");

export const getProduct = (id: string, currency?: string) =>
  apiGet<Product>(`/products/${id}`, { params: currency ? { currency } : undefined });

export const createProduct = (body: Record<string, unknown>) =>
  apiPost<Product>("/products", body);

export const updateProduct = (id: string, body: Record<string, unknown>) =>
  apiPatch<Product>(`/products/${id}`, body);

export const setProductPrices = (id: string, prices: unknown[]) =>
  apiPut<Product>(`/products/${id}/prices`, { prices });

export const deleteProduct = (id: string) => apiDelete<{ ok: boolean }>(`/products/${id}`);

export interface OfferRow {
  id: string;
  app_id: string | null;
  product_id: string | null;
  code: string | null;
  name: string;
  description: string | null;
  terms: string | null;
  discount_type: "PERCENT" | "FLAT";
  discount_value: number;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions_used: number;
  redemptions_left: number | null;
  status: string;
  /** Server-formatted ("20% off" / "₹5,000 off"). A FLAT `discount_value` is in
   *  minor units, so never format it in the page. */
  discount_display?: string;
}

export const listOffers = (params: { app_id?: string; product_id?: string } = {}) =>
  apiGet<OfferRow[]>("/products/offers", { params });

export const createOffer = (body: Record<string, unknown>) =>
  apiPost<OfferRow>("/products/offers", body);

export const updateOffer = (id: string, body: Record<string, unknown>) =>
  apiPatch<OfferRow>(`/products/offers/${id}`, body);

export const deleteOffer = (id: string) =>
  apiDelete<{ ok: boolean }>(`/products/offers/${id}`);

export type CouponCheck =
  | { valid: true; offer: ProductOffer; product_id: string }
  | { valid: false; reason: string };

export const validateCoupon = (productId: string, code: string, currency?: string) =>
  apiPost<CouponCheck>("/products/validate-coupon", {
    product_id: productId,
    code,
    currency,
  });

// ---------------------------------------------------------------------------
// Engagement + signals
// ---------------------------------------------------------------------------

export type IntentBand = "HOT" | "WARM" | "COLD";
export type LifecycleStage =
  | "VISITOR"
  | "SIGNED_UP"
  | "TRIAL"
  | "ACTIVE"
  | "PAYING"
  | "CHURNED";

export interface IntentReason {
  label: string;
  weight: number;
  count: number;
}

export interface TopProduct {
  product_id: string | null;
  external_id: string | null;
  name: string | null;
  views: number;
  last_at: string;
}

export interface EngagementProfile {
  app_id: string;
  app_name: string;
  app_key: string;
  product_url: string | null;
  lifecycle_stage: LifecycleStage;
  plan_name: string | null;
  plan_status: string | null;
  mrr_minor: number | null;
  mrr_display: string | null;
  currency: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  signup_at: string | null;
  trial_ends_at: string | null;
  sessions_30d: number;
  events_30d: number;
  page_views_30d: number;
  active_days_30d: number;
  intent_score: number;
  intent_band: IntentBand;
  intent_reasons: IntentReason[];
  checkout_abandoned_at: string | null;
  abandoned_cart: {
    product_id?: string | null;
    name?: string | null;
    value_minor?: number | null;
    currency?: string | null;
    coupon?: string | null;
  } | null;
  top_products: TopProduct[];
  usage: { counts?: Record<string, number>; reported?: Record<string, number> };
}

export const getLeadEngagement = (leadId: string) =>
  apiGet<EngagementProfile[]>(`/leads/${leadId}/engagement`);

export const getContactEngagement = (contactId: string) =>
  apiGet<EngagementProfile[]>(`/contacts/${contactId}/engagement`);

export interface Signal {
  profile_id: string;
  app_id: string;
  app_name: string;
  lead_id: string | null;
  contact_id: string | null;
  name: string;
  email: string | null;
  owner_id: string | null;
  record_type: "lead" | "contact";
  lifecycle_stage: LifecycleStage;
  plan_name: string | null;
  plan_status: string | null;
  intent_score: number;
  intent_band: IntentBand;
  intent_reasons: IntentReason[];
  checkout_abandoned_at: string | null;
  last_seen_at: string | null;
  events_30d: number;
}

export const listSignals = (params: { app_id?: string; band?: string; limit?: number } = {}) =>
  apiGet<Signal[]>("/signals", { params });

// ---------------------------------------------------------------------------
// Deal line items
// ---------------------------------------------------------------------------

export interface DealLineItem {
  id: string;
  deal_id: string;
  product_id: string | null;
  offer_id: string | null;
  name: string;
  quantity: number;
  unit_price_minor: number;
  unit_price_display: string;
  discount_minor: number;
  discount_display: string;
  total_minor: number;
  total_display: string;
  currency: string;
  sort_order: number;
}

export interface DealLineItems {
  items: DealLineItem[];
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  total_display: string;
  currency: string;
}

export const listDealLineItems = (dealId: string) =>
  apiGet<DealLineItems>(`/deals/${dealId}/line-items`);

export const addDealLineItem = (dealId: string, body: Record<string, unknown>) =>
  apiPost<DealLineItems>(`/deals/${dealId}/line-items`, body);

export const updateDealLineItem = (
  dealId: string,
  itemId: string,
  body: Record<string, unknown>
) => apiPatch<DealLineItems>(`/deals/${dealId}/line-items/${itemId}`, body);

export const removeDealLineItem = (dealId: string, itemId: string) =>
  apiDelete<DealLineItems>(`/deals/${dealId}/line-items/${itemId}`);
