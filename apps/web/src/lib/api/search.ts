import type { SearchGroup } from "@/types";
import { apiGet } from "./client";

export const globalSearch = (q: string) =>
  apiGet<SearchGroup[]>("/search", { params: { q } });
