import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api/client";
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

export interface AllocatedNumber {
  id: string;
  tenant_id: string;
  phone: string;
  label: string | null;
  kind: "MAIN" | "AGENT";
  assigned_user_id: string | null;
  active: boolean;
  created_at: string;
}

export interface TenantTelephonySummary {
  configured: boolean;
  status: string;
  from_number: string | null;
  provider: string;
  platformPlivoLive: boolean;
  numbers: AllocatedNumber[];
}

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

export const getTenantTelephony = (tenantId: string) =>
  apiGet<TenantTelephonySummary>(`/tenants/${tenantId}/telephony`);

export const allocateTenantNumber = (
  tenantId: string,
  payload: { phone: string; label?: string; kind?: "MAIN" | "AGENT" }
) => apiPost<AllocatedNumber>(`/tenants/${tenantId}/telephony/numbers`, payload);

export const updateTenantNumber = (
  tenantId: string,
  numberId: string,
  payload: { active?: boolean; label?: string; kind?: "MAIN" | "AGENT" }
) => apiPatch<AllocatedNumber>(`/tenants/${tenantId}/telephony/numbers/${numberId}`, payload);

export const removeTenantNumber = (tenantId: string, numberId: string) =>
  apiDelete<{ ok: boolean }>(`/tenants/${tenantId}/telephony/numbers/${numberId}`);

export interface TenantCall {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  contact_id: string | null;
  user_id: string | null;
  agent_name?: string | null;
  agent_email?: string | null;
  lead_name?: string | null;
  lead_company?: string | null;
  contact_name?: string | null;
  contact_company?: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: "INBOUND" | "OUTBOUND";
  call_status: string | null;
  outcome: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  provider: string;
  simulated: boolean;
  call_error: string | null;
  created_at: string;
}

export const getTenantCalls = (tenantId: string) =>
  apiGet<TenantCall[]>(`/tenants/${tenantId}/telephony/calls`);

export const getTenantCallRecording = (tenantId: string, callId: string) =>
  apiGet<{ url: string | null; pending: boolean }>(
    `/tenants/${tenantId}/telephony/calls/${callId}/recording`
  );
