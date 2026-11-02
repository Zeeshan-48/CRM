import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Gauge,
  HeartHandshake,
  IndianRupee,
  LifeBuoy,
  ListTodo,
  Megaphone,
  MessageSquare,
  PhoneCall,
  Rocket,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner, SpinnerOverlay } from "@/components/ui/spinner";
import { listAgents } from "@/lib/api/agents";
import {
  getAnalyticsOverview,
  getPredictiveAnalytics,
  getSalesAnalytics,
} from "@/lib/api/analytics";
import { getReminderCount } from "@/lib/api/reminders";
import { formatINR, formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/layout/AppShell";
import { StatCard } from "@/components/layout/StatCard";
import { useAuthStore, hasModule } from "@/stores/auth-store";

const AGENT_ICONS: Record<string, LucideIcon> = {
  sales: PhoneCall,
  marketing: Megaphone,
  support: LifeBuoy,
  collections: Wallet,
  success: HeartHandshake,
  knowledge: BookOpen,
  coach: Sparkles,
};

const greeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const todayLabel = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** A key/value tile inside My Work. */
function WorkTile({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="border-t py-2.5">
      <div className="flex h-8 items-center">
        {loading ? (
          <Spinner size="sm" className="text-muted-foreground" />
        ) : (
          <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
            {value}
          </p>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** A ranked horizontal-bar row for the "Revenue by rep" leaderboard. */
function LeaderRow({
  rank,
  name,
  valueLabel,
  value,
  max,
  sub,
}: {
  rank: number;
  name: string;
  valueLabel: string;
  value: number;
  max: number;
  sub?: string;
}) {
  const width = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="shrink-0 font-display text-sm font-semibold tabular-nums tracking-tight">
            {valueLabel}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-700 ease-spring"
            style={{ width: `${width}%` }}
          />
        </div>
        {sub ? (
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** SVG donut used for the win-rate ring. `value` is a 0-100 percentage. */
function Donut({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 30;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="relative size-20 shrink-0">
      <svg viewBox="0 0 72 72" className="size-20 -rotate-90">
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          strokeWidth="7"
          className="stroke-muted"
        />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-brand transition-[stroke-dasharray] duration-700 ease-spring"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-lg font-semibold tabular-nums tracking-tight">
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}

/** A labelled progress meter (0-100). */
function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700 ease-spring"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** A single tile inside the AI forecast band. */
function ForecastTile({
  icon: Icon,
  tint,
  label,
  value,
  sub,
  children,
}: {
  icon: LucideIcon;
  tint: string;
  label: string;
  value?: React.ReactNode;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t pt-3.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            tint,
          )}
        >
          <Icon className="size-4" />
        </span>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      {value != null ? (
        <p className="mt-2.5 font-display text-xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
      ) : null}
      {children}
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { openCopilot } = useShell();

  const canSeeAnalytics = hasModule(user, "analytics");
  const canSeeAgents = hasModule(user, "agents");
  const canSeeCopilot = hasModule(user, "copilot");

  const overviewQuery = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: getAnalyticsOverview,
    enabled: canSeeAnalytics,
  });
  const salesQuery = useQuery({
    queryKey: ["analytics-sales"],
    queryFn: getSalesAnalytics,
    enabled: canSeeAnalytics,
  });
  const predictiveQuery = useQuery({
    queryKey: ["analytics-predictive"],
    queryFn: getPredictiveAnalytics,
    enabled: canSeeAnalytics,
  });
  const remindersQuery = useQuery({
    queryKey: ["reminders-count"],
    queryFn: getReminderCount,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
    enabled: canSeeAgents,
  });

  const overview = overviewQuery.data;
  const sales = salesQuery.data;
  const predictive = predictiveQuery.data;
  const reminders = remindersQuery.data;
  const agents = agentsQuery.data ?? [];

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const workspaceName = user?.tenant?.name ?? "your workspace";

  // Show a dash (not a misleading "0") if a fetch actually failed.
  const num = (v: number | undefined) =>
    overviewQuery.isError ? "-" : formatNumber(v);
  const inr = (v: number | undefined) =>
    overviewQuery.isError ? "-" : formatINR(v);
  const pct = (v: number | undefined) =>
    salesQuery.isError || v == null ? "-" : `${Math.round(v)}%`;
  const reminderValue = (v: number | undefined) =>
    remindersQuery.isError ? "-" : formatNumber(v);

  const metrics: {
    label: string;
    value: string;
    icon: LucideIcon;
    loading: boolean;
    hint?: string;
  }[] = [
    {
      label: "Revenue",
      value: inr(overview?.revenue),
      icon: IndianRupee,
      loading: overviewQuery.isLoading,
      hint: sales ? `Avg deal ${formatINR(sales.avgDealSize)}` : undefined,
    },
    {
      label: "Weighted pipeline",
      value: inr(overview?.weightedPipeline),
      icon: TrendingUp,
      loading: overviewQuery.isLoading,
      hint: overview ? `${formatNumber(overview.openDeals)} open deals` : undefined,
    },
    {
      label: "Win rate",
      value: pct(sales?.winRate),
      icon: Trophy,
      loading: salesQuery.isLoading,
      hint: sales ? `${formatNumber(sales.won)} won` : undefined,
    },
    {
      label: "Leads",
      value: num(overview?.leads),
      icon: UserPlus,
      loading: overviewQuery.isLoading,
      hint: sales ? `${Math.round(sales.conversion)}% conversion` : undefined,
    },
    {
      label: "Open tickets",
      value: num(overview?.openTickets),
      icon: LifeBuoy,
      loading: overviewQuery.isLoading,
    },
    {
      label: "Conversations",
      value: num(overview?.conversations),
      icon: MessageSquare,
      loading: overviewQuery.isLoading,
    },
  ];

  const owners = [...(sales?.byOwner ?? [])]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
  const ownerMax = owners.length > 0 ? owners[0].revenue : 0;

  const showLeft = canSeeAnalytics || canSeeAgents;

  return (
    <div className="space-y-6">
      {/* Hero, subtle brand-gradient banner with greeting + primary actions */}
      <header className="reveal relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-brand/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {todayLabel.format(new Date())}
            </p>
            <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight sm:text-[26px]">
              {greeting()}, <span className="text-brand">{firstName}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Here&apos;s what&apos;s happening across {workspaceName} today.
            </p>
          </div>
          {canSeeAnalytics ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                <Link to="/analytics">
                  View analytics
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {/* KPI band */}
      {canSeeAnalytics ? (
        <section className="reveal space-y-2" style={{ animationDelay: "60ms" }}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
            {metrics.map((metric) => (
              <StatCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                icon={metric.icon}
                hint={metric.hint}
                loading={metric.loading}
              />
            ))}
          </div>
          {overviewQuery.isError ? (
            <p className="text-xs text-muted-foreground">
              Couldn&apos;t load metrics.{" "}
              <button
                type="button"
                onClick={() => overviewQuery.refetch()}
                className="font-medium text-brand hover:underline"
              >
                Retry
              </button>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* AI forecast, forward-looking, predictive signals band */}
      {canSeeAnalytics ? (
        <Card
          className="reveal relative overflow-hidden"
          style={{ animationDelay: "90ms" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -left-16 -top-20 size-48 rounded-full bg-brand/[0.06] blur-3xl"
          />
          <CardHeader className="relative flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-brand">
                <Sparkles className="size-4" />
              </span>
              <div>
                <CardTitle>AI forecast</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Predicted for the current period
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative">
            {predictiveQuery.isLoading ? (
              <SpinnerOverlay label="Modelling forecast" className="py-8" />
            ) : predictiveQuery.isError ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Couldn&apos;t load the forecast.{" "}
                <button
                  type="button"
                  onClick={() => predictiveQuery.refetch()}
                  className="font-medium text-brand hover:underline"
                >
                  Retry
                </button>
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ForecastTile
                  icon={IndianRupee}
                  tint="bg-brand/10 text-brand"
                  label="Predicted revenue"
                  value={formatINR(predictive?.predictedRevenue)}
                  sub={`${formatNumber(
                    predictive?.predictedConversions,
                  )} conversions expected`}
                />
                <ForecastTile
                  icon={Gauge}
                  tint="bg-info/10 text-info"
                  label="Forecast confidence"
                >
                  <p className="mt-2.5 font-display text-xl font-semibold tabular-nums tracking-tight">
                    {Math.round(predictive?.forecastConfidence ?? 0)}%
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-info transition-[width] duration-700 ease-spring"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(100, predictive?.forecastConfidence ?? 0),
                        )}%`,
                      }}
                    />
                  </div>
                </ForecastTile>
                <ForecastTile
                  icon={ShieldAlert}
                  tint="bg-danger/10 text-danger"
                  label="At-risk accounts"
                  value={formatNumber(predictive?.churnRisk)}
                  sub={
                    predictive && predictive.churnList.length > 0
                      ? `${predictive.churnList[0].name}${
                          predictive.churnList.length > 1
                            ? ` +${predictive.churnList.length - 1} more`
                            : ""
                        }`
                      : "None flagged"
                  }
                />
                <ForecastTile
                  icon={Rocket}
                  tint="bg-success/10 text-success"
                  label="Upsell opportunities"
                  value={formatNumber(predictive?.upsellCandidates)}
                  sub="Ready for outreach"
                />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column */}
        {showLeft ? (
          <div className="flex flex-col gap-4 lg:col-span-2">
            {canSeeAnalytics ? (
              <Card
                className="reveal flex flex-col"
                style={{ animationDelay: "120ms" }}
              >
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Revenue by rep</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Closed-won this period
                    </p>
                  </div>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="-mr-2 gap-1 text-brand hover:text-brand"
                  >
                    <Link to="/analytics">
                      Details
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="flex-1">
                  {salesQuery.isLoading ? (
                    <SpinnerOverlay label="Loading sales" className="py-10" />
                  ) : salesQuery.isError ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Couldn&apos;t load sales data.{" "}
                      <button
                        type="button"
                        onClick={() => salesQuery.refetch()}
                        className="font-medium text-brand hover:underline"
                      >
                        Retry
                      </button>
                    </p>
                  ) : owners.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No closed revenue to show yet.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {owners.map((owner, index) => (
                        <LeaderRow
                          key={owner.name}
                          rank={index + 1}
                          name={owner.name}
                          value={owner.revenue}
                          valueLabel={formatINR(owner.revenue)}
                          max={ownerMax}
                          sub={`${formatNumber(owner.won)} won${
                            owner.open != null
                              ? ` · ${formatNumber(owner.open)} open`
                              : ""
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {canSeeAgents ? (
              <Card
                className="reveal flex flex-col"
                style={{ animationDelay: "160ms" }}
              >
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>AI agents</CardTitle>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="-mr-2 gap-1 text-brand hover:text-brand"
                  >
                    <Link to="/agents">
                      View all
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="flex-1">
                  {agentsQuery.isLoading ? (
                    <SpinnerOverlay label="Loading agents" className="py-10" />
                  ) : agentsQuery.isError ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Couldn&apos;t load agents.{" "}
                      <button
                        type="button"
                        onClick={() => agentsQuery.refetch()}
                        className="font-medium text-brand hover:underline"
                      >
                        Retry
                      </button>
                    </p>
                  ) : agents.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No AI agents available yet.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {agents.map((agent) => {
                        const Icon = AGENT_ICONS[agent.key] ?? Bot;
                        return (
                          <Link
                            key={agent.key}
                            to="/agents"
                            className="group flex items-center gap-3 border-t px-1 py-2.5 transition-colors duration-120 hover:bg-muted"
                          >
                            <span className="flex size-9 shrink-0 items-center justify-center text-brand">
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-display text-sm font-semibold tracking-tight">
                                {agent.name}
                              </p>
                              <p className="truncate text-xs tabular-nums text-muted-foreground">
                                {formatNumber(agent.runCount)} runs
                                <span className="px-1.5">&middot;</span>
                                last run {timeAgo(agent.lastRunAt)}
                              </p>
                            </div>
                            <ArrowRight className="size-4 shrink-0 text-brand opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        {/* Right column */}
        <div
          className={cn(
            "flex flex-col gap-4",
            !showLeft && "sm:grid sm:grid-cols-2 sm:items-start lg:col-span-3",
          )}
        >
          {canSeeAnalytics ? (
            <Card className="reveal" style={{ animationDelay: "200ms" }}>
              <CardHeader>
                <CardTitle>Sales performance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {salesQuery.isLoading ? (
                  <SpinnerOverlay label="Loading" className="py-8" />
                ) : salesQuery.isError ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Couldn&apos;t load performance.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-4">
                      <Donut value={sales?.winRate ?? 0} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Win rate
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatNumber(sales?.won)}
                          </span>{" "}
                          won
                          <span className="px-1.5">·</span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatNumber(sales?.lost)}
                          </span>{" "}
                          lost
                        </p>
                      </div>
                    </div>
                    <Meter
                      label="Lead → deal conversion"
                      value={sales?.conversion ?? 0}
                    />
                    <div className="flex items-center justify-between border-t py-2.5">
                      <span className="text-xs text-muted-foreground">
                        Avg deal size
                      </span>
                      <span className="font-display text-sm font-semibold tabular-nums tracking-tight">
                        {formatINR(sales?.avgDealSize)}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card className="reveal" style={{ animationDelay: "240ms" }}>
            <CardHeader>
              <CardTitle>My work</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <WorkTile
                  label="Due today"
                  value={reminderValue(reminders?.dueToday)}
                  loading={remindersQuery.isLoading}
                />
                <WorkTile
                  label="Open reminders"
                  value={reminderValue(reminders?.open)}
                  loading={remindersQuery.isLoading}
                />
              </div>
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link to="/reminders">Open my work</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="reveal" style={{ animationDelay: "280ms" }}>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0.5">
              {hasModule(user, "leads") && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="-mx-2 justify-start gap-2.5"
                >
                  <Link to="/leads">
                    <UserPlus className="size-4 text-brand" />
                    Add a lead
                  </Link>
                </Button>
              )}
              {hasModule(user, "activities") && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="-mx-2 justify-start gap-2.5"
                >
                  <Link to="/activities">
                    <ListTodo className="size-4 text-brand" />
                    Log an activity
                  </Link>
                </Button>
              )}
              {hasModule(user, "campaigns") && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="-mx-2 justify-start gap-2.5"
                >
                  <Link to="/campaigns">
                    <Megaphone className="size-4 text-brand" />
                    New campaign
                  </Link>
                </Button>
              )}
              {canSeeCopilot && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mx-2 justify-start gap-2.5"
                  onClick={openCopilot}
                >
                  <Sparkles className="size-4 text-brand" />
                  Ask Copilot
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
