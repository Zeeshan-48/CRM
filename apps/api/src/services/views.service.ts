import { BadRequestError, NotFoundError } from "../errors";
import viewsRepository from "../repositories/views.repository";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

class ViewsService {
  async list(tenantId: string, userId: string, resource?: string) {
    return viewsRepository.listForUser(tenantId, userId, resource);
  }

  async create(
    tenantId: string,
    userId: string,
    body: { resource?: unknown; name?: unknown; filters?: unknown }
  ) {
    if (!body.resource || !String(body.resource).trim()) {
      throw new BadRequestError("resource is required");
    }
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequestError("name is required");

    return viewsRepository.create({
      tenant_id: tenantId,
      user_id: userId,
      resource: String(body.resource).trim(),
      name: name.slice(0, 60),
      filters: isPlainObject(body.filters) ? body.filters : {},
    });
  }

  async remove(tenantId: string, userId: string, viewId: string) {
    const deleted = await viewsRepository.delete(viewId, tenantId, userId);
    if (!deleted) throw new NotFoundError("View not found");
    return { ok: true };
  }
}

export default new ViewsService();
