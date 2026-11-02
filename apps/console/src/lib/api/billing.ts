import { apiGet, apiPost } from "@/lib/api/client";
import type {
  BillingGateway,
  BillingMetrics,
  CreateSubscriptionResponse,
  PlatformTransaction,
  Subscription,
  TenantSubscriptionResponse,
} from "@/types";

export const getSubscription = (tenantId: string) =>
  apiGet<TenantSubscriptionResponse>(`/tenants/${tenantId}/subscription`);

export const listTransactions = (tenantId: string) =>
  apiGet<PlatformTransaction[]>(`/tenants/${tenantId}/transactions`);

export const createSubscription = (
  tenantId: string,
  payload: { gateway: BillingGateway; planKey?: string; billingMode?: "AUTO" | "MANUAL" }
) => apiPost<CreateSubscriptionResponse>(`/tenants/${tenantId}/subscription`, payload);

export const cancelSubscription = (tenantId: string, payload: { atPeriodEnd?: boolean } = {}) =>
  apiPost<Subscription>(`/tenants/${tenantId}/subscription/cancel`, payload);

export const getBillingMetrics = () => apiGet<BillingMetrics>("/billing/metrics");
