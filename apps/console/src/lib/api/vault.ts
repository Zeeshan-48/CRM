import { apiGet, apiPost } from "@/lib/api/client";

export interface VaultSummary {
  leads: { total: number; active: number; deleted: number };
  contacts: { total: number; active: number; deleted: number };
  deals: { total: number; active: number; deleted: number };
  accounts: { total: number; active: number; deleted: number };
  contracts: { total: number; active: number; deleted: number };
  invoices: { total: number; active: number; deleted: number };
  roles: { total: number; active: number; deleted: number };
  users: number;
  recordings?: { total: number; withAudio: number; totalDurationSec: number };
}

export interface VaultDataResult<T = any> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export const getVaultSummary = (tenantId?: string) =>
  apiGet<VaultSummary>("/vault/summary", {
    params: tenantId ? { tenantId } : {},
  });

export const getVaultData = (params: {
  tenantId?: string;
  entity: string;
  filter?: "all" | "active" | "deleted";
  q?: string;
  page?: number;
  limit?: number;
}) =>
  apiGet<VaultDataResult>("/vault/data", {
    params: {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      entity: params.entity,
      filter: params.filter || "all",
      ...(params.q ? { q: params.q } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });

export const restoreVaultItem = (payload: {
  tenantId: string;
  entity: string;
  id: string;
}) => apiPost<{ ok: boolean; message: string }>("/vault/restore", payload);

export const purgeVaultItem = (payload: {
  tenantId: string;
  entity: string;
  id: string;
}) => apiPost<{ ok: boolean; message: string }>("/vault/purge", payload);

