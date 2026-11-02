import { apiDelete, apiGet, apiPost } from "./client";

/** Saved filter views (per user, per resource). */
export interface SavedView {
  id: string;
  tenant_id: string;
  user_id: string;
  resource: string;
  name: string;
  filters: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export const listViews = (resource: string) =>
  apiGet<SavedView[]>("/views", { params: { resource } });

export const createView = (body: {
  resource: string;
  name: string;
  filters: Record<string, string>;
}) => apiPost<SavedView>("/views", body);

export const deleteView = (id: string) => apiDelete<{ ok: boolean }>(`/views/${id}`);
