import { useQuery } from "@tanstack/react-query";
import { Radar, ShoppingCart } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { IntentMeter } from "@/components/products/IntentMeter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listConnectedApps,
  listSignals,
  type IntentBand,
  type LifecycleStage,
  type Signal,
} from "@/lib/api/products";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const BANDS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "HOT", label: "Hot" },
  { value: "WARM", label: "Warm" },
];

const STAGE_LABEL: Record<LifecycleStage, string> = {
  VISITOR: "Visitor",
  SIGNED_UP: "Signed up",
  TRIAL: "On trial",
  ACTIVE: "Active",
  PAYING: "Paying",
  CHURNED: "Churned",
};

const BAND_ACCENT: Record<IntentBand, string> = {
  HOT: "before:bg-red-500",
  WARM: "before:bg-amber-500",
  COLD: "before:bg-slate-400",
};

function SignalRow({ signal }: { signal: Signal }) {
  const href =
    signal.record_type === "contact"
      ? `/contacts/${signal.contact_id}`
      : `/leads/${signal.lead_id}`;

  return (
    <Card
      className={cn(
        // A severity stripe encodes the band in form as well as number, so the
        // list is scannable without reading every score.
        "relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1",
        BAND_ACCENT[signal.intent_band]
      )}
    >
      <CardContent className="flex flex-col gap-3 py-4 pl-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={href} className="truncate font-semibold hover:underline">
              {signal.name}
            </Link>
            <Badge variant="outline" className="text-[10px]">
              {STAGE_LABEL[signal.lifecycle_stage] ?? signal.lifecycle_stage}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {signal.app_name}
            </Badge>
            {signal.plan_name ? (
              <Badge variant="outline" className="text-[10px]">
                {signal.plan_name}
              </Badge>
            ) : null}
            {signal.checkout_abandoned_at ? (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] text-amber-700 dark:text-amber-300"
              >
                <ShoppingCart className="size-2.5" />
                Cart left
              </Badge>
            ) : null}
          </div>

          <p className="truncate text-sm text-muted-foreground">{signal.email ?? "No email"}</p>

          {signal.intent_reasons.length > 0 ? (
            <p className="truncate text-xs text-muted-foreground">
              {signal.intent_reasons
                .slice(0, 3)
                .map((r) => (r.count > 1 ? `${r.label} x${r.count}` : r.label))
                .join(" · ")}
            </p>
          ) : null}
        </div>

        <div className="w-full shrink-0 sm:w-48">
          <IntentMeter
            score={signal.intent_score}
            band={signal.intent_band}
            reasons={[]}
            compact
          />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {signal.last_seen_at ? timeAgo(signal.last_seen_at) : "-"}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to={href}>Open</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The signals feed: everyone showing buying intent inside a connected product,
 * hottest first. This is the list an agent works down at the start of the day,
 * instead of guessing from a lead list sorted by creation date.
 */
export default function SignalsPage() {
  const [band, setBand] = React.useState("");
  const [appId, setAppId] = React.useState("");

  const { data: apps } = useQuery({ queryKey: ["connected-apps"], queryFn: listConnectedApps });

  const { data, isLoading } = useQuery({
    queryKey: ["signals", band, appId],
    queryFn: () => listSignals({ band: band || undefined, app_id: appId || undefined }),
    placeholderData: (previous) => previous,
    // Intent moves while an agent is looking at it, so refresh on focus rather
    // than making them reload to see a lead that just went hot.
    refetchOnWindowFocus: true,
  });

  const signals = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signals"
        description="People acting like buyers inside your connected products right now, ranked by intent. Work down the list."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border p-1">
          {BANDS.map((b) => (
            <Button
              key={b.value || "all"}
              type="button"
              size="sm"
              variant={band === b.value ? "secondary" : "ghost"}
              onClick={() => setBand(b.value)}
            >
              {b.label}
            </Button>
          ))}
        </div>

        {(apps ?? []).length > 1 ? (
          <div className="flex gap-1 rounded-lg border p-1">
            <Button
              type="button"
              size="sm"
              variant={appId === "" ? "secondary" : "ghost"}
              onClick={() => setAppId("")}
            >
              All products
            </Button>
            {(apps ?? []).map((a) => (
              <Button
                key={a.id}
                type="button"
                size="sm"
                variant={appId === a.id ? "secondary" : "ghost"}
                onClick={() => setAppId(a.id)}
              >
                {a.name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading && !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : signals.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No signals yet"
          description="Once a connected product starts streaming what people do inside it, everyone showing buying intent appears here."
        />
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => (
            <SignalRow key={signal.profile_id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}
