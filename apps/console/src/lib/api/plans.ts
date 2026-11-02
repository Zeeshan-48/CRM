import { apiGet, apiPost, apiPut } from "@/lib/api/client";
import type { Plan, PlanLimits } from "@/types";

export const listPlans = () => apiGet<Plan[]>("/plans");

export const createPlan = (payload: {
  key: string;
  name: string;
  description?: string;
  price_monthly: number;
  modules: string[];
  limits: PlanLimits;
}) => apiPost<Plan>("/plans", payload);

export const updatePlan = (
  id: string,
  payload: {
    name?: string;
    description?: string | null;
    price_monthly?: number;
    modules?: string[];
    limits?: PlanLimits;
    is_active?: boolean;
    sort_order?: number;
  }
) => apiPut<Plan>(`/plans/${id}`, payload);
