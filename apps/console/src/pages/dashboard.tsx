import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Layers, ScrollText, UserPlus, Users } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listAudit } from "@/lib/api/audit";
import { getMetricsOverview } from "@/lib/api/metrics";
import { formatNumber, timeAgo } from "@/lib/format";
import { BRAND } from "@/lib/brand";

export default function DashboardPage() {
  const metricsQuery = useQuery({
    queryKey: ["metrics-overview"],
    queryFn: getMetricsOverview,
  });
  const auditQuery = useQuery({
    queryKey: ["audit", "", ""],
    queryFn: () => listAudit(),
  });

  const metrics = metricsQuery.data;
  const byStatus = metrics?.tenants.byStatus ?? {};
  const active = byStatus.ACTIVE ?? 0;
  const suspended = byStatus.SUSPENDED ?? 0;
  const closed = byStatus.CLOSED ?? 0;

  const planDistribution = metrics?.planDistribution ?? [];
  const planTotal = planDistribution.reduce((sum, row) => sum + row.count, 0);

  const recentAudit = auditQuery.data ?? [];

  const cards = [
    {
      label: "Total tenants",
      value: formatNumber(metrics?.tenants.total) as React.ReactNode,
      icon: Building2,
      hint: "All workspaces on the platform" as React.ReactNode,
    },
    {
      label: "Tenant health",
      value: (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-emerald-500">{formatNumber(active)}</span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm text-amber-500">{formatNumber(suspended)}</span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm text-red-500">{formatNumber(closed)}</span>
        </span>
      ),
      icon: Layers,
      hint: (
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-success" /> active
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-warning" /> suspended
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-destructive" /> closed
          </span>
        </span>
      ),
    },
    {
      label: "Total users",
      value: formatNumber(metrics?.totals.users),
      icon: Users,
      hint: "Across all tenant workspaces",
    },
    {
      label: "Total leads",
      value: formatNumber(metrics?.totals.leads),
      icon: UserPlus,
      hint: "Across all tenant workspaces",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description={`Fleet-wide health of every ${BRAND.name} tenant, plan and operator action.`}
      />

      {/* Stat cards */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card, index) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            hint={card.hint}
            loading={metricsQuery.isLoading}
            className="reveal"
            style={{ animationDelay: `${60 + index * 45}ms` }}
          />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Plan distribution */}
        <section className="reveal lg:col-span-2" style={{ animationDelay: "240ms" }}>
          <Card className="flex h-[26rem] flex-col">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Plan distribution</CardTitle>
              <Button asChild variant="ghost" size="sm" className="gap-1 text-brand hover:text-brand">
                <Link to="/plans">
                  Plans
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center gap-5">
              {metricsQuery.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)
              ) : planDistribution.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  No tenants are assigned to a plan yet.
                </p>
              ) : (
                planDistribution.map((row) => {
                  const pct = planTotal > 0 ? (row.count / planTotal) * 100 : 0;
                  return (
                    <div key={row.plan_key} className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold tracking-tight">{row.plan_key}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatNumber(row.count)} {row.count === 1 ? "tenant" : "tenants"}
                          <span className="ml-1.5 text-muted-foreground">
                            {Math.round(pct)}%
                          </span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-brand transition-all duration-500"
                          style={{ width: `${Math.max(pct, 6)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>

        {/* Recent operator activity */}
        <section className="reveal lg:col-span-3" style={{ animationDelay: "300ms" }}>
          <Card className="flex h-[26rem] flex-col">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Recent operator activity</CardTitle>
              <Button asChild variant="ghost" size="sm" className="gap-1 text-brand hover:text-brand">
                <Link to="/audit">
                  Full audit
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto" tabIndex={0} aria-label="Recent operator activity">
              {auditQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : recentAudit.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No operator activity recorded yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {recentAudit.map((row) => (
                    <li key={row.id} className="flex items-start gap-3 py-2.5 first:pt-0">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                        <ScrollText className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{row.summary}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="font-mono text-[11px]">{row.action}</span>
                          <span>&middot;</span>
                          <span>{timeAgo(row.created_at)}</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
