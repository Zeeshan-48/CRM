import { useQuery } from "@tanstack/react-query";
import {
  AudioLines,
  CalendarDays,
  CreditCard,
  ArrowUpRight,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  Plug,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { BrandLogo, hasBrandLogo } from "@/components/brand/BrandLogo";
import { ConnectedProductsCard } from "@/components/integrations/ConnectedProductsCard";
import { LeadCaptureCard } from "@/components/integrations/LeadCaptureCard";
import { WebhookDeliveriesCard } from "@/components/integrations/WebhookDeliveriesCard";
import { WebhooksCard } from "@/components/integrations/WebhooksCard";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listConnections, type ConnectionState, type ConnectionStatus } from "@/lib/api/integrations";

// Fixed display order for the category groups.
const CATEGORY_ORDER = [
  "Messaging",
  "Email",
  "Payments",
  "Voice & calls",
  "Calendar",
  "Artificial intelligence",
];

const ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageSquare,
  email: Mail,
  razorpay: CreditCard,
  stripe: CreditCard,
  google_calendar: CalendarDays,
  telephony: Phone,
  ai_calling: PhoneCall,
  voice_ai_engine: AudioLines,
  platform_llm: Sparkles,
};

const STATE_META: Record<
  ConnectionState,
  { label: string; className: string; dot: string }
> = {
  connected: {
    label: "Connected",
    className: "text-success",
    dot: "bg-success",
  },
  default: {
    label: "Platform",
    className: "text-brand",
    dot: "bg-brand",
  },
  pending: {
    label: "Pending",
    className: "text-warning",
    dot: "bg-warning",
  },
  simulated: {
    label: "Simulated",
    className: "text-warning",
    dot: "bg-warning",
  },
  not_connected: {
    label: "Not connected",
    className: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
  unavailable: {
    label: "Unavailable",
    className: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

const SCOPE_HINT: Record<ConnectionStatus["scope"], string | null> = {
  tenant: null,
  user: "Your account",
  platform: "Platform-wide",
};

function StateBadge({ state }: { state: ConnectionState }) {
  const meta = STATE_META[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${meta.className}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function ConnectionRow({ item }: { item: ConnectionStatus }) {
  const Icon = ICONS[item.key] ?? Plug;
  const scopeHint = SCOPE_HINT[item.scope];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3.5 transition-colors duration-120 hover:border-brand/40">
      <div className="flex min-w-0 items-center gap-3">
        {hasBrandLogo(item.key) ? (
          <BrandLogo brand={item.key} size={36} />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center text-brand">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{item.name}</p>
            {scopeHint ? (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {scopeHint}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {item.detail ?? "Not configured yet"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StateBadge state={item.state} />
        {item.managePath ? (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link to={item.managePath}>
              Manage
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5">
      <span className={`flex size-2.5 rounded-full ${className}`} />
      <span className="text-lg font-semibold tabular-nums">{count}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

export default function IntegrationsPage() {
  const connectionsQuery = useQuery({
    queryKey: ["integration-connections"],
    queryFn: listConnections,
  });

  const items = React.useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);

  const summary = React.useMemo(() => {
    let connected = 0;
    let shared = 0;
    let missing = 0;
    for (const item of items) {
      if (item.state === "connected") connected += 1;
      else if (item.state === "default") shared += 1;
      else missing += 1;
    }
    return { connected, shared, missing };
  }, [items]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, ConnectionStatus[]>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    const ordered: Array<{ category: string; items: ConnectionStatus[] }> = [];
    for (const category of CATEGORY_ORDER) {
      const list = map.get(category);
      if (list && list.length) ordered.push({ category, items: list });
    }
    // Any category not in the fixed order (future-proofing) goes last.
    for (const [category, list] of map) {
      if (!CATEGORY_ORDER.includes(category)) ordered.push({ category, items: list });
    }
    return ordered;
  }, [items]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="External services connected to this workspace. Configure each on its own page."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={connectionsQuery.isFetching}
            onClick={() => connectionsQuery.refetch()}
          >
            <RefreshCw className={connectionsQuery.isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        }
      />

      <ConnectedProductsCard />

      <LeadCaptureCard />

      <WebhooksCard />

      <WebhookDeliveriesCard />

      {connectionsQuery.isLoading ? (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-40" />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : connectionsQuery.isError ? (
        <EmptyState
          icon={Plug}
          title="Couldn't load connections"
          description="Something went wrong fetching integration statuses. Try refreshing."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No integrations"
          description="No external services are available for this workspace."
        />
      ) : (
        <>
          {/* Summary */}
          <div className="reveal flex flex-wrap gap-3" style={{ animationDelay: "40ms" }}>
            <SummaryStat label="Connected" count={summary.connected} className="bg-success" />
            <SummaryStat label="On platform account" count={summary.shared} className="bg-brand" />
            <SummaryStat
              label="Not connected"
              count={summary.missing}
              className="bg-muted-foreground/40"
            />
          </div>

          {/* Grouped connection cards */}
          {grouped.map((group, index) => (
            <section
              key={group.category}
              className="reveal"
              style={{ animationDelay: `${120 + index * 60}ms` }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.category}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {group.items.map((item) => (
                    <ConnectionRow key={item.key} item={item} />
                  ))}
                </CardContent>
              </Card>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
