import { kb_status } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import kbRepository from "../repositories/kb.repository";
import { ragSearch } from "./ai/heuristics";
import engineService from "./engine.service";

const isKbStatus = (value: string): value is kb_status =>
  Object.values(kb_status).includes(value as kb_status);

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

class KbService {
  async list(tenantId: string, status?: string) {
    if (status && !isKbStatus(status)) {
      throw new BadRequestError(`status must be one of ${Object.values(kb_status).join(", ")}`);
    }
    return kbRepository.list(tenantId, status as kb_status | undefined);
  }

  async search(tenantId: string, body: { query?: string; q?: string }) {
    const query = (body.query ?? body.q ?? "").trim();
    if (!query) throw new BadRequestError("query required");
    const articles = await kbRepository.list(tenantId, "PUBLISHED");
    return { query, results: ragSearch(articles, query, 5) };
  }

  async detail(tenantId: string, articleId: string) {
    const article = await kbRepository.incrementViews(articleId, tenantId);
    if (!article) throw new NotFoundError("Article not found");
    return article;
  }

  async create(
    tenantId: string,
    actorId: string,
    body: { title?: string; body?: string; tags?: unknown; status?: string }
  ) {
    if (!body.title || !String(body.title).trim()) throw new BadRequestError("title required");
    if (!body.body || !String(body.body).trim()) throw new BadRequestError("body required");
    if (body.status && !isKbStatus(body.status)) {
      throw new BadRequestError(`status must be one of ${Object.values(kb_status).join(", ")}`);
    }

    const article = await kbRepository.create({
      tenant_id: tenantId,
      title: String(body.title).trim(),
      body: String(body.body),
      tags: parseStringArray(body.tags),
      status: (body.status as kb_status | undefined) ?? "PUBLISHED",
    });
    engineService.audit(tenantId, actorId, "kb.created", "kb_article", article.id, {
      status: article.status,
    });
    return article;
  }
}

export default new KbService();
