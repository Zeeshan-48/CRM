import type { Tenant, TenantMe } from "@/types";
import { apiGet, apiPut } from "./client";

/** Full tenant row as returned by GET /tenant/me and PUT /tenant/me. */
export type TenantWorkspace = Tenant & {
  industry: string | null;
  email_domain: string | null;
  white_label: boolean;
  status: string;
  config: Record<string, unknown> | null;
};

export interface UpdateTenantPayload {
  name?: string;
  brand_color?: string;
  domain?: string | null;
  email_domain?: string | null;
  white_label?: boolean;
  config?: Record<string, unknown> | null;
}

export interface TenantPlan {
  key: string;
  name: string;
  description: string | null;
  price_monthly: number;
  currency: string;
  /** Module keys included in the plan; may contain "*" for everything. */
  modules: string[];
  limits: Record<string, number | null>;
}

export const getTenantMe = () => apiGet<TenantMe>("/tenant/me");

/** ADMIN only. */
export const updateTenantMe = (payload: UpdateTenantPayload) =>
  apiPut<TenantWorkspace>("/tenant/me", payload);

export const listTenantPlans = () => apiGet<TenantPlan[]>("/tenant/plans");
