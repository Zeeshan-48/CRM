import { NotFoundError } from "../errors";
import tenantsRepository from "../repositories/tenants.repository";
import engineService from "./engine.service";
import entitlementsService from "./entitlements.service";

class TenantsService {
  async me(tenantId: string) {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Workspace not found");
    const [usage, entitlements] = await Promise.all([
      tenantsRepository.usage(tenantId),
      entitlementsService.getAll(tenantId),
    ]);
    const modules = entitlements
      .filter((e) => e.enabled && e.code.startsWith("module."))
      .map((e) => e.code.slice("module.".length));
    const limits = Object.fromEntries(
      entitlements
        .filter((e) => e.enabled && e.code.startsWith("limit."))
        .map((e) => [e.code.slice("limit.".length), e.limit_value])
    );
    return { tenant, usage, modules, limits };
  }

  async update(
    tenantId: string,
    actorId: string,
    body: Partial<{
      name: string;
      brand_color: string;
      domain: string | null;
      email_domain: string | null;
      white_label: boolean;
      config: Record<string, unknown> | null;
    }>
  ) {
    // `config` is a shared JSON blob (branding-adjacent prefs, scheduling hours,
    // lead-assignment defaults, …). Shallow-merge so writing one section never
    // wipes another. The repository replaces the column wholesale, so merge here.
    let patch = body;
    if (body.config) {
      const existing = await tenantsRepository.findById(tenantId);
      const current =
        existing?.config && typeof existing.config === "object"
          ? (existing.config as Record<string, unknown>)
          : {};
      patch = { ...body, config: { ...current, ...body.config } };
    }

    const updated = await tenantsRepository.update(tenantId, patch);
    if (!updated) throw new NotFoundError("Workspace not found");
    entitlementsService.invalidate(tenantId);
    engineService.audit(tenantId, actorId, "tenant.updated", "tenant", tenantId, body);
    return updated;
  }

  async plans() {
    return tenantsRepository.listActivePlans();
  }
}

export default new TenantsService();
