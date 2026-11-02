import { moduleEntitlementCode } from "../constants/modules.const";
import { db } from "../db/connection";
import { ForbiddenError } from "../errors";

interface EntitlementRow {
  code: string;
  enabled: boolean;
  limit_value: number | null;
}

interface CacheEntry {
  at: number;
  rows: EntitlementRow[];
}

const CACHE_TTL_MS = 60_000;

// Entitlements are the runtime source of truth for what a tenant can use.
// The operator backend writes them (plan snapshot or admin override); the CRM
// runtime only ever reads them. Cached per tenant for 60s.
class EntitlementsService {
  private cache = new Map<string, CacheEntry>();

  async getAll(tenantId: string): Promise<EntitlementRow[]> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

    const rows = await db
      .selectFrom("tenant_entitlements")
      .select(["code", "enabled", "limit_value"])
      .where("tenant_id", "=", tenantId)
      .execute();

    this.cache.set(tenantId, { at: Date.now(), rows });
    return rows;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  async isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
    const rows = await this.getAll(tenantId);
    const row = rows.find((r) => r.code === moduleEntitlementCode(moduleKey));
    return row?.enabled === true;
  }

  async ensureModuleEnabled(tenantId: string, moduleKey: string): Promise<void> {
    const enabled = await this.isModuleEnabled(tenantId, moduleKey);
    if (!enabled) {
      throw new ForbiddenError(
        `The ${moduleKey} module is not included in this workspace's plan`
      );
    }
  }

  // Returns the granted limit for a code: null means the code is not granted
  // at all; Infinity means granted with no cap (limit_value null).
  async getLimit(tenantId: string, code: string): Promise<number | null> {
    const rows = await this.getAll(tenantId);
    const row = rows.find((r) => r.code === code);
    if (!row || !row.enabled) return null;
    return row.limit_value === null ? Infinity : row.limit_value;
  }

  async ensureCapacity(
    tenantId: string,
    code: string,
    currentUsage: number,
    requested = 1,
    label = "resource"
  ): Promise<void> {
    const limit = await this.getLimit(tenantId, code);
    if (limit === null) return; // no limit granted/configured: do not block
    if (currentUsage + requested > limit) {
      throw new ForbiddenError(
        `Workspace ${label} limit reached (${limit}). Upgrade the plan to add more.`
      );
    }
  }
}

export default new EntitlementsService();
