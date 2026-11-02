import { apiGet } from "@/lib/api/client";
import type { MetricsOverview } from "@/types";

export const getMetricsOverview = () => apiGet<MetricsOverview>("/metrics/overview");
