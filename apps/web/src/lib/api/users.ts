import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./client";

/** Public user shape returned by GET /users (password hash stripped). */
export interface CrmUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "DISABLED" | "PENDING";
  /** Module keys this user can access; contains "*" for full access. */
  permissions: string[];
  territory: string[];
  skills: string[];
  avatar_color: string | null;
  last_login_at: string | null;
  created_at: string;
  /** Agent callback number; inbound call routing rings this. */
  phone: string | null;
  /** Agent presence: inbound call routing skips unavailable agents. */
  available_for_calls: boolean;
}

export interface CustomRole {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}

/** Metadata for one access key (feature module or governance capability). */
export interface ModuleMeta {
  key: string;
  label: string;
  description: string;
  group: string;
  /** True for RBAC-only governance capabilities (channels, team, billing, settings). */
  governance: boolean;
}

/** GET /users/roles: built-in roles, module registry and tenant custom roles. */
export interface RolesCatalogue {
  builtin: string[];
  modules: string[];
  /** RBAC-only governance capability keys. */
  capabilities: string[];
  /** Full metadata for every grantable key, drives the picker + labels. */
  catalogue: ModuleMeta[];
  /** Effective module set per role key (built-in defaults overlaid with overrides). */
  roleModules: Record<string, string[]>;
  /** Built-in role keys that currently have a per-tenant override (customized). */
  customized: string[];
  permissionLevels: string[];
  custom: CustomRole[];
  /** Member count per role key (built-in and custom). */
  counts: Record<string, number>;
}

/** DELETE /users/:id report, what was reassigned before the user was removed. */
export interface UserDeletionReport {
  deleted: { id: string; name: string; email: string; role: string };
  reassignedAmong: { id: string; name: string }[];
  totalReassigned: number;
  reassigned: Record<
    string,
    { total: number; unassigned: number; distribution: { id: string; name: string; count: number }[] }
  >;
  cleaned: { notifications: number; reminders: number; savedViews: number };
}

export interface CreateUserPayload {
  name: string;
  email: string;
  role: string;
  /** Optional; when omitted the backend generates a secure password and emails it. */
  password?: string;
  permissions?: string[];
  territory?: string[];
  skills?: string[];
}

/** Create response: the new user plus whether the invitation email went out. */
export interface CreatedUser extends CrmUser {
  /** True when a sign-in-details email was dispatched (SES configured). */
  emailed?: boolean;
}

export interface UpdateUserPayload {
  name?: string;
  role?: string;
  status?: CrmUser["status"];
  permissions?: string[];
  territory?: string[];
  skills?: string[];
  /** E.164 (a bare national number picks up the default country code); empty clears. */
  phone?: string;
}

export const listUsers = () => apiGet<CrmUser[]>("/users");

export const getRolesCatalogue = () => apiGet<RolesCatalogue>("/users/roles");

export const createUser = (payload: CreateUserPayload) =>
  apiPost<CreatedUser>("/users", payload);

export const updateUser = (id: string, payload: UpdateUserPayload) =>
  apiPut<CrmUser>(`/users/${id}`, payload);

/** Remove a user; the backend reassigns their owned work and returns a report. */
export const deleteUser = (id: string) => apiDelete<UserDeletionReport>(`/users/${id}`);

/** ADMIN only: reset a member's password. A new random password is generated,
 * stored, and emailed to the member (never returned here). */
export const resetUserPassword = (id: string) =>
  apiPost<{ ok: true; email: string; emailed: boolean }>(`/users/${id}/reset-password`);

/** Self-service: set the current user's callback (mobile) number. */
export const updateMyPhone = (phone: string) =>
  apiPatch<{ phone: string | null }>("/users/me", { phone });

/** Self-service: change the current user's password (verifies the current one). */
export const changeMyPassword = (payload: { currentPassword: string; newPassword: string }) =>
  apiPatch<{ ok: true }>("/users/me/password", payload);

export const createCustomRole = (payload: { name: string; permissions: string[] }) =>
  apiPost<CustomRole>("/users/roles", payload);

/** Edit a custom role's name and/or module set (built-in roles are immutable). */
export const updateCustomRole = (
  key: string,
  payload: { name?: string; permissions?: string[] }
) => apiPut<CustomRole>(`/users/roles/${key}`, payload);

/** Delete a custom role (blocked by the API while users still hold it). */
export const deleteCustomRole = (key: string) =>
  apiDelete<{ ok: true }>(`/users/roles/${key}`);
