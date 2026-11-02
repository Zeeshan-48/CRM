import { isBuiltinRole, ROLE_MODULES } from "../constants/modules.const";
import rolesRepository from "../repositories/roles.repository";

interface RbacUser {
  tenantId: string;
  role: string;
  permissions: string[] | null;
}

const CACHE_TTL_MS = 60_000;

class RbacService {
  // Per-tenant map of role key -> module set, built from the `roles` table.
  // This covers BOTH custom roles and per-tenant *overrides* of built-in roles
  // (rows with builtin=true). Cached 60s so module resolution, which runs on
  // every gated request, is a map lookup, not a DB hit. Invalidated on any
  // role write so edits take effect immediately for the editing tenant.
  private cache = new Map<string, { at: number; map: Map<string, string[]> }>();

  private async roleMap(tenantId: string): Promise<Map<string, string[]>> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.map;

    const rows = await rolesRepository.findByTenant(tenantId);
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const perms = Array.isArray(row.permissions)
        ? row.permissions.filter((p): p is string => typeof p === "string")
        : [];
      map.set(row.key, perms);
    }
    this.cache.set(tenantId, { at: Date.now(), map });
    return map;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  // Resolution order: an explicit per-user permission override wins; then a
  // stored role definition (a custom role, or a tenant override of a built-in
  // role); then the hardcoded built-in default; else no access.
  async getModulesForUser(user: RbacUser): Promise<string[]> {
    if (user.permissions && user.permissions.length > 0) return user.permissions;

    const stored = await this.roleMap(user.tenantId);
    const override = stored.get(user.role);
    if (override) return override;

    if (isBuiltinRole(user.role)) return ROLE_MODULES[user.role];
    return [];
  }

  async canAccessModule(user: RbacUser, moduleKey: string): Promise<boolean> {
    const modules = await this.getModulesForUser(user);
    return modules.includes("*") || modules.includes(moduleKey);
  }
}

export default new RbacService();
