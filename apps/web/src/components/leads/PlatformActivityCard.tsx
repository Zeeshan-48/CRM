import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CreditCard,
  Globe,
  LifeBuoy,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import * as React from "react";

import { TimelineTypeFilter } from "@/components/activities/TimelineTypeFilter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getLeadPlatformEvents,
  type PlatformEvent,
  type PlatformSnapshot,
} from "@/lib/api/leads";
import { timeAgo } from "@/lib/format";

// Friendly names for the event-definition categories a generic connected product
// reports. Without these the filter chips read "Checkout.abandoned": a machine
// event name, and one that just repeats the row title underneath it.
const EVENT_CATEGORY_LABELS: Record<string, string> = {
  PAGE: "Pages",
  ACTION: "Actions",
  LIFECYCLE: "Lifecycle",
  COMMERCE: "Commerce",
  SUPPORT: "Support",
};

// Human label for a filter category (content_type / PLAN / ORGANIZATION /
// event-definition category).
function prettyCategory(cat: string): string {
  if (EVENT_CATEGORY_LABELS[cat]) return EVENT_CATEGORY_LABELS[cat];
  const label = cat.replace(/_/g, " ").toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Fallback label from an event name ("content.published" becomes "Content published").
function prettyEvent(event: string): string {
  const [entity, action] = event.split(".");
  const label = `${entity.replace(/_/g, " ")} ${(action || "").replace(/_/g, " ")}`.trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// The filter/group dimension, most specific first: content_type for content.*
// events, a synthetic bucket for plan/organization, then the event definition's
// own category, which is what a generic connected product supplies.
// Falling straight through to the raw event name (as this used to) produced one
// chip per event name, each duplicating the row it filtered to.
function categoryOf(e: PlatformEvent): string {
  if (e.content_type) return e.content_type;
  if (e.event.startsWith("plan.")) return "PLAN";
  if (e.event === "organization.updated") return "ORGANIZATION";
  if (e.category) return e.category;
  return e.event;
}

function iconFor(category: string) {
  if (category === "PLAN") return CreditCard;
  if (category === "ORGANIZATION") return Building2;
  if (category === "COMMERCE") return CreditCard;
  if (category === "SUPPORT") return LifeBuoy;
  if (category === "ACTION") return MousePointerClick;
  if (category === "LIFECYCLE") return RefreshCw;
  return Globe;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-t pt-2">
      <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const planTone: Record<string, string> = {
  active: "text-emerald-700 dark:text-emerald-300",
  payment_failed: "text-red-700 dark:text-red-300",
  cancel_scheduled: "text-amber-700 dark:text-amber-300",
  cancelled: "text-slate-600 dark:text-slate-300",
};

/**
 * The lead's "Platform activity": a glance summary panel (from the rolled-up
 * snapshot) plus the badged, filterable stream of what the lead actually did on
 * the external platform. Kept visually separate from the CRM timeline so agents
 * never confuse "what we did" with "what they did". Filters on content_type.
 */
export function PlatformActivityCard({
  leadId,
  snapshot,
}: {
  leadId: string;
  snapshot: PlatformSnapshot | null;
}) {
  const [filter, setFilter] = React.useState<string>("ALL");

  const { data: events, isLoading } = useQuery({
    queryKey: ["lead-platform-events", leadId],
    queryFn: () => getLeadPlatformEvents(leadId),
  });

  const snap = snapshot ?? {};
  const hasSnapshot = Object.keys(snap).length > 0;
  const list = events ?? [];
  const publishedByType = snap.published_by_type ?? {};

  const counts = list.reduce<Record<string, number>>((acc, e) => {
    const c = categoryOf(e);
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  const categories = Array.from(new Set(list.map(categoryOf)));
  const filtered = filter === "ALL" ? list : list.filter((e) => categoryOf(e) === filter);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!hasSnapshot && list.length === 0) {
    return (
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Globe className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No platform activity yet. Events sync here when this lead builds or buys
              on the platform.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        {/* ---- Glance summary panel ---- */}
        {hasSnapshot ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {snap.plan_status ? (
                <Badge variant="outline" className={planTone[snap.plan_status] ?? ""}>
                  Plan: {snap.plan_name ? `${snap.plan_name} · ` : ""}
                  {snap.plan_status.replace(/_/g, " ")}
                </Badge>
              ) : null}
              {snap.checkout_abandoned ? (
                <Badge
                  variant="outline"
                  className="gap-1 text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="size-3" />
                  Started checkout, didn't finish
                </Badge>
              ) : null}
              {snap.last_platform_active_at ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  Last active {timeAgo(snap.last_platform_active_at)}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {typeof snap.content_published === "number" ? (
                <Stat label="Published (all)" value={snap.content_published} />
              ) : null}
              {typeof snap.content_created === "number" ? (
                <Stat label="Created (all)" value={snap.content_created} />
              ) : null}
              {/* Per-type published breakdown, driven by content_type. */}
              {Object.entries(publishedByType).map(([type, n]) => (
                <Stat key={type} label={`${prettyCategory(type)} live`} value={n} />
              ))}
            </div>
          </div>
        ) : null}

        {/* ---- Event stream ---- */}
        {list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No platform events recorded yet.
          </p>
        ) : (
          <div>
            <TimelineTypeFilter
              total={list.length}
              value={filter}
              onChange={setFilter}
              options={categories.map((cat) => ({
                value: cat,
                label: prettyCategory(cat),
                count: counts[cat],
              }))}
            />

            <ul className="relative max-h-[26rem] overflow-y-auto pr-1">
              {filtered.map((e, idx) => {
                const category = categoryOf(e);
                const Icon = iconFor(category);
                const last = idx === filtered.length - 1;
                return (
                  <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {!last ? (
                      <span
                        aria-hidden
                        className="absolute left-4 top-9 bottom-0 w-px -translate-x-1/2 bg-border"
                      />
                    ) : null}
                    <span className="relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 ring-4 ring-card dark:text-indigo-300">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold">
                          {e.title || prettyEvent(e.event)}
                        </span>
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {timeAgo(e.occurred_at)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className="gap-1 text-[10px] text-indigo-600 dark:text-indigo-300"
                        >
                          <Globe className="size-2.5" />
                          Platform
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {prettyCategory(category)}
                        </Badge>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
