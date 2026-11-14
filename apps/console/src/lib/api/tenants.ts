import { apiGet, apiPost, apiPut } from "@/lib/api/client";
import type {
  Entitlement,
  OnboardTenantPayload,
  OnboardTenantResponse,
  Tenant,
  TenantBillingProfile,
  TenantDetail,
  TenantStatus,
  TenantWithUsage,
} from "@/types";

export const listTenants = (params?: { q?: string; status?: string }) =>
  apiGet<TenantWithUsage[]>("/tenants", {
    params: {
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.status ? { status: params.status } : {}),
    },
  });

export const getTenant = (id: string) => apiGet<TenantDetail>(`/tenants/${id}`);

export const onboardTenant = (payload: OnboardTenantPayload) =>
  apiPost<OnboardTenantResponse>("/tenants", payload);

export const updateTenant = (
  id: string,
  payload: {
    name?: string;
    brand_color?: string;
    status?: TenantStatus;
    plan_key?: string;
  }
) => apiPut<Tenant>(`/tenants/${id}`, payload);

export const overrideEntitlement = (
  id: string,
  payload: { code: string; enabled?: boolean; limit_value?: number | null }
) => apiPut<Entitlement>(`/tenants/${id}/entitlements`, payload);

export const getTenantBillingProfile = (id: string) =>
  apiGet<TenantBillingProfile | null>(`/tenants/${id}/billing-profile`);

export const saveTenantBillingProfile = (id: string, payload: Partial<TenantBillingProfile>) =>
  apiPut<TenantBillingProfile>(`/tenants/${id}/billing-profile`, payload);
