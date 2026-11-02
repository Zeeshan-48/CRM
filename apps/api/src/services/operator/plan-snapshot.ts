import { LIMIT_CODES, moduleEntitlementCode } from "../../constants/modules.const";
import type { EntitlementSpec } from "../../repositories/operator/entitlements.repository";
import type { PlanRow } from "../../repositories/operator/plans.repository";

export const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export const parseLimits = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
};

// Snapshot of a plan into entitlement rows: one boolean gate per module plus
// the numeric limits (connected apps only when the plan includes products; a
// plan without that limit grants them uncapped). The snapshot is taken at onboarding, at plan-change
// time, and when a lapsed subscription is reinstated; later edits to the plan
// itself never touch these rows.
//
// Shared by tenants.service (onboard / plan change) and entitlements-sync
// (revoke on lapse, reinstate on payment) so both write identical rows.
export const planSnapshotSpecs = (plan: PlanRow): EntitlementSpec[] => {
  const modules = parseStringArray(plan.modules);
  const limits = parseLimits(plan.limits);
  return [
    ...modules.map((moduleKey) => ({
      code: moduleEntitlementCode(moduleKey),
      enabled: true,
      limit_value: null,
    })),
    { code: LIMIT_CODES.SEATS, enabled: true, limit_value: limits.seats ?? 0 },
    { code: LIMIT_CODES.LEADS, enabled: true, limit_value: limits.leads ?? 0 },
    {
      code: LIMIT_CODES.AI_CREDITS_MONTHLY,
      enabled: true,
      limit_value: limits.ai_credits_monthly ?? 0,
    },
    ...(modules.includes("products")
      ? [
          {
            code: LIMIT_CODES.CONNECTED_APPS,
            enabled: true,
            limit_value: limits.connected_apps ?? null,
          },
        ]
      : []),
  ];
};
