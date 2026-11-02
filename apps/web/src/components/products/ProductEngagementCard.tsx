import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ExternalLink,
  Eye,
  Globe,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";

import { IntentMeter } from "@/components/products/IntentMeter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductActionsBar } from "@/components/products/ProductActionsBar";
import {
  getContactEngagement,
  getLeadEngagement,
  type EngagementProfile,
  type LifecycleStage,
} from "@/lib/api/products";
import { timeAgo } from "@/lib/format";

const STAGE_LABEL: Record<LifecycleStage, string> = {
  VISITOR: "Visitor",
  SIGNED_UP: "Signed up",
  TRIAL: "On trial",
  ACTIVE: "Active user",
  PAYING: "Paying",
  CHURNED: "Churned",
};

const STAGE_TONE: Record<LifecycleStage, string> = {
  VISITOR: "text-slate-600 dark:text-slate-300",
  SIGNED_UP: "text-sky-700 dark:text-sky-300",
  TRIAL: "text-violet-700 dark:text-violet-300",
  ACTIVE: "text-teal-700 dark:text-teal-300",
  PAYING: "text-emerald-700 dark:text-emerald-300",
  CHURNED: "text-red-700 dark:text-red-300",
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Turns "content.published" into "Content published" for a usage counter row. */
const prettyKey = (key: string): string => {
  const cleaned = key.replace(/[._]/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

function AppPanel({ profile }: { profile: EngagementProfile }) {
  const usageCounts = profile.usage?.counts ?? {};
  const usageReported = profile.usage?.reported ?? {};
  // Product-defined counters, rendered generically. The CRM does not know what
  // any of these mean, which is exactly what lets a new product integrate
  // without a CRM change.
  const usageRows = [
    ...Object.entries(usageReported).map(([k, v]) => ({ key: k, value: v, reported: true })),
    ...Object.entries(usageCounts).map(([k, v]) => ({ key: k, value: v, reported: false })),
  ].slice(0, 6);

  const deepLink = profile.product_url;

  return (
    <div className="space-y-4 border-t pt-4">
      {/* ---- Header: which product, what stage, how to open it ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Globe className="size-3" />
          {profile.app_name}
        </Badge>
        <Badge variant="outline" className={STAGE_TONE[profile.lifecycle_stage]}>
          {STAGE_LABEL[profile.lifecycle_stage] ?? profile.lifecycle_stage}
        </Badge>
        {profile.plan_name ? (
          <Badge variant="outline">
            {profile.plan_name}
            {profile.plan_status ? ` · ${profile.plan_status.replace(/_/g, " ")}` : ""}
          </Badge>
        ) : null}
        {profile.mrr_display ? (
          <Badge variant="outline" className="gap-1">
            <TrendingUp className="size-3" />
            {profile.mrr_display} MRR
          </Badge>
        ) : null}

        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {profile.last_seen_at ? <span>Last seen {timeAgo(profile.last_seen_at)}</span> : null}
          {deepLink ? (
            <a
              href={deepLink}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Open <ExternalLink className="size-3" />
            </a>
          ) : null}
        </span>
      </div>

      {/* ---- Intent, front and centre ---- */}
      <IntentMeter
        score={profile.intent_score}
        band={profile.intent_band}
        reasons={profile.intent_reasons}
      />

      {/* ---- Abandoned cart: the single highest-value callback ---- */}
      {profile.checkout_abandoned_at ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <ShoppingCart className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="font-medium text-amber-700 dark:text-amber-300">
            Started checkout, did not finish
          </span>
          {profile.abandoned_cart?.name ? (
            <span className="text-muted-foreground">on {profile.abandoned_cart.name}</span>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            {timeAgo(profile.checkout_abandoned_at)}
          </span>
        </div>
      ) : null}

      {/* ---- Trial clock: the window where a call converts ---- */}
      {profile.trial_ends_at && profile.lifecycle_stage === "TRIAL" ? (
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm">
          <CalendarClock className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <span className="text-violet-700 dark:text-violet-300">
            Trial ends {timeAgo(profile.trial_ends_at)}
          </span>
        </div>
      ) : null}

      {/* ---- 30-day activity ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sessions (30d)" value={profile.sessions_30d} />
        <Stat label="Events (30d)" value={profile.events_30d} />
        <Stat label="Page views (30d)" value={profile.page_views_30d} />
        <Stat label="Active days (30d)" value={profile.active_days_30d} />
      </div>

      {/* ---- What they keep looking at: the pitch opener ---- */}
      {profile.top_products.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Most viewed</p>
          <ul className="space-y-1">
            {profile.top_products.slice(0, 4).map((p) => (
              <li
                key={p.product_id ?? p.external_id ?? p.name ?? "unknown"}
                className="flex items-center gap-2 text-sm"
              >
                <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{p.name ?? p.external_id ?? "Untitled"}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {p.views} view{p.views === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---- Product-defined counters ---- */}
      {usageRows.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">In-product usage</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {usageRows.map((row) => (
              <div
                key={`${row.reported ? "r" : "c"}:${row.key}`}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="truncate text-muted-foreground">{prettyKey(row.key)}</span>
                <span className="shrink-0 font-medium tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A person's engagement across every connected product.
 *
 * Deliberately one panel PER product rather than a merged view: a person can be
 * a paying customer of one product and a cold visitor on another, and averaging
 * those together would tell an agent nothing useful.
 *
 * Works for a lead or a contact, because product history follows the PERSON
 * through conversion rather than being stranded on the retired lead record.
 */
export function ProductEngagementCard({
  leadId,
  contactId,
}: {
  leadId?: string;
  contactId?: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["person-engagement", leadId ?? null, contactId ?? null],
    queryFn: () =>
      contactId ? getContactEngagement(contactId) : getLeadEngagement(leadId as string),
    enabled: !!(leadId || contactId),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-5">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const profiles = data ?? [];

  if (profiles.length === 0) {
    return (
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Globe className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No product activity yet. Once a connected product recognises this person,
              their plan, usage and buying intent appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const needsAttention = profiles.some(
    (p) => p.intent_band === "HOT" || p.checkout_abandoned_at
  );

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        {needsAttention ? (
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4" />
            Worth a call today
          </div>
        ) : null}

        {profiles.map((profile) => (
          <AppPanel key={profile.app_id} profile={profile} />
        ))}

        {/* Acting on the product without leaving the record. Renders nothing
            when no connected product has declared an action. */}
        <ProductActionsBar leadId={leadId} contactId={contactId} />

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="size-3" />
          Synced from {profiles.length} connected product{profiles.length === 1 ? "" : "s"}
        </p>
      </CardContent>
    </Card>
  );
}
