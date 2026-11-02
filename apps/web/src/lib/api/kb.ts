// Knowledge base API. Types are colocated here and mirror
// open-crm-api/src/services/kb.service.ts response shapes.
// Note: POST /kb/search returns { query, results } (not a bare array), and
// article tags are a JSON column normalized to string[] here.

import { apiGet, apiPost } from "./client";

export type KbStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export const KB_STATUSES: KbStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

export interface KbArticle {
  id: string;
  tenant_id: string;
  title: string;
  body: string;
  tags: string[];
  status: KbStatus;
  views: number;
  created_at: string;
  updated_at: string;
}

interface KbArticleRaw extends Omit<KbArticle, "tags"> {
  tags: unknown;
}

export interface KbSearchHit {
  article: { id: string; title: string };
  score: number;
  snippet: string;
}

export interface KbSearchResponse {
  query: string;
  results: KbSearchHit[];
}

export interface CreateKbArticleInput {
  title: string;
  body: string;
  tags?: string[];
  status?: KbStatus;
}

const normalizeTags = (raw: unknown): string[] => {
  const parsed = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((t): t is string => typeof t === "string");
};

const safeParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
};

const normalizeArticle = (row: KbArticleRaw): KbArticle => ({
  ...row,
  tags: normalizeTags(row.tags),
});

export const listKbArticles = async (): Promise<KbArticle[]> => {
  const rows = await apiGet<KbArticleRaw[]>("/kb");
  return rows.map(normalizeArticle);
};

/** Fetches one article; the backend increments its view counter. */
export const getKbArticle = async (id: string): Promise<KbArticle> =>
  normalizeArticle(await apiGet<KbArticleRaw>(`/kb/${id}`));

export const searchKb = (query: string) =>
  apiPost<KbSearchResponse>("/kb/search", { query });

export const createKbArticle = async (
  input: CreateKbArticleInput
): Promise<KbArticle> => normalizeArticle(await apiPost<KbArticleRaw>("/kb", input));
