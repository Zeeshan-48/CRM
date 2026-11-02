import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  IndianRupee,
  Kanban,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  PhoneCall,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import {
  getAnalyticsOverview,
  getConversationIntelligence,
  getMarketingAnalytics,
  getPredictiveAnalytics,
  getSalesAnalytics,
  getSupportAnalytics,
} from "@/lib/api/analytics";
import { formatINR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ---- Shared chart primitives (hand-built, no chart deps) ----

interface BarDatum {
  label: string;
  value: number;
  display: string;
}

function HBarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs text-muted-foreground" title={d.label}>
            {d.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">
            {d.display}
          </span>
        </div>
      ))}
    </div>
  );
}

function DonutRing({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 100 100" className="size-36" role="img" aria-label={`${label}: ${clamped}%`}>
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="10"
          className="stroke-muted"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className="stroke-brand"
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
          transform="rotate(-90 50 50)"
        />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-display text-[18px] font-semibold tabular-nums"
        >
          {clamped}%
        </text>
      </svg>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function MeterBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-brand transition-[width] duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function StatGridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

// ---- Overview tab ----

function OverviewTab() {
  const query = useQuery({ queryKey: ["analytics-overview"], queryFn: getAnalyticsOverview });
  const d = query.data;

  const cards = [
    { label: "Leads", value: formatNumber(d?.leads), icon: UserPlus },
    { label: "Contacts", value: formatNumber(d?.contacts), icon: Users },
    { label: "Open deals", value: formatNumber(d?.openDeals), icon: Kanban },
    { label: "Revenue", value: formatINR(d?.revenue), icon: IndianRupee },
    { label: "Weighted pipeline", value: formatINR(d?.weightedPipeline), icon: TrendingUp },
    { label: "Open tickets", value: formatNumber(d?.openTickets), icon: LifeBuoy },
    { label: "Conversations", value: formatNumber(d?.conversations), icon: MessageSquare },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {cards.map((card, index) => (
        <StatCard
          key={card.label}
          label={card.label}
          value={card.value}
          icon={card.icon}
          loading={query.isLoading}
          className="reveal"
          style={{ animationDelay: `${index * 40}ms` }}
        />
      ))}
    </div>
  );
}

// ---- Sales tab ----

function SalesTab() {
  const query = useQuery({ queryKey: ["analytics-sales"], queryFn: getSalesAnalytics });
  const d = query.data;

  if (query.isLoading) return <StatGridSkeleton count={8} />;

  const kpis = [
    { label: "Revenue", value: formatINR(d?.revenue), icon: IndianRupee },
    { label: "Deals", value: formatNumber(d?.deals), icon: Kanban },
    { label: "Won", value: formatNumber(d?.won), icon: Trophy },
    { label: "Lost", value: formatNumber(d?.lost), icon: TrendingDown },
    { label: "Win rate", value: `${d?.winRate ?? 0}%`, icon: Target },
    { label: "Lead conversion", value: `${d?.conversion ?? 0}%`, icon: TrendingUp },
    { label: "Avg deal size", value: formatINR(d?.avgDealSize), icon: Wallet },
  ];

  const byOwner = d?.byOwner ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {kpis.map((kpi, index) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            className="reveal"
            style={{ animationDelay: `${index * 40}ms` }}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="reveal" style={{ animationDelay: "160ms" }}>
          <CardHeader>
            <CardTitle>Revenue by owner</CardTitle>
          </CardHeader>
          <CardContent>
            {byOwner.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No owner data yet.</p>
            ) : (
              <HBarChart
                data={byOwner.map((row) => ({
                  label: row.name,
                  value: row.revenue,
                  display: formatINR(row.revenue),
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card className="reveal" style={{ animationDelay: "200ms" }}>
          <CardHeader>
            <CardTitle>Owner leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            {byOwner.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No owner data yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byOwner.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.won)}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.open ?? row.activities ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatINR(row.revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Marketing tab ----

function MarketingTab() {
  const query = useQuery({ queryKey: ["analytics-marketing"], queryFn: getMarketingAnalytics });
  const d = query.data;

  if (query.isLoading) return <StatGridSkeleton count={6} />;

  const kpis = [
    { label: "Spend", value: formatINR(d?.spend), icon: Wallet },
    { label: "Revenue", value: formatINR(d?.revenue), icon: IndianRupee },
    { label: "ROAS", value: `${d?.roas ?? 0}x`, icon: TrendingUp },
    { label: "ROI", value: `${d?.roi ?? 0}%`, icon: Target },
    { label: "CAC", value: formatINR(d?.cac), icon: UserPlus },
  ];

  const sources = d?.leadsBySource ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi, index) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            className="reveal"
            style={{ animationDelay: `${index * 40}ms` }}
          />
        ))}
      </div>

      <Card className="reveal" style={{ animationDelay: "160ms" }}>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Leads by source</CardTitle>
          <Megaphone className="size-4 text-brand" />
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No lead sources yet.</p>
          ) : (
            <HBarChart
              data={sources.map((row) => ({
                label: row.source,
                value: row.count,
                display: formatNumber(row.count),
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Support tab ----

function SupportTab() {
  const query = useQuery({ queryKey: ["analytics-support"], queryFn: getSupportAnalytics });
  const d = query.data;

  if (query.isLoading) return <StatGridSkeleton count={6} />;

  const kpis = [
    { label: "Total tickets", value: formatNumber(d?.total), icon: LifeBuoy },
    { label: "Open", value: formatNumber(d?.open), icon: MessageSquare },
    { label: "Resolved", value: formatNumber(d?.resolved), icon: Trophy },
    { label: "SLA breached", value: formatNumber(d?.breached), icon: AlertTriangle },
    { label: "Resolution rate", value: `${d?.resolutionRate ?? 0}%`, icon: Sparkles },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi, index) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            className="reveal"
            style={{ animationDelay: `${index * 40}ms` }}
          />
        ))}
      </div>

      <Card className="reveal" style={{ animationDelay: "160ms" }}>
        <CardHeader>
          <CardTitle>SLA compliance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-6 sm:flex-row sm:justify-center sm:gap-12">
          <DonutRing percent={d?.slaCompliance ?? 0} label="Within SLA" />
          <div className="max-w-xs text-center sm:text-left">
            <p className="text-sm text-muted-foreground">
              {formatNumber(d?.breached)} of {formatNumber(d?.open)} open tickets have breached
              their SLA window. Resolve breached tickets first to protect compliance.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Predictive tab ----

function PredictiveTab() {
  const query = useQuery({ queryKey: ["analytics-predictive"], queryFn: getPredictiveAnalytics });
  const d = query.data;

  if (query.isLoading) return <StatGridSkeleton count={4} />;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="reveal lg:row-span-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Churn risk</CardTitle>
          <AlertTriangle className="size-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight">
            {formatNumber(d?.churnRisk)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            customers with no activity in 30+ days
          </p>
          {d && d.churnList.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {d.churnList.map((row, i) => (
                <li
                  key={`${row.name}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="truncate text-sm font-medium">{row.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.company ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              No customers at risk right now.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
        <StatCard
          label="Predicted revenue"
          value={formatINR(d?.predictedRevenue)}
          icon={IndianRupee}
          hint="Weighted open pipeline"
          className="reveal"
        />
        <StatCard
          label="Predicted conversions"
          value={formatNumber(d?.predictedConversions)}
          icon={TrendingUp}
          hint="From current hot leads"
          className="reveal"
          style={{ animationDelay: "40ms" }}
        />
        <StatCard
          label="Upsell candidates"
          value={formatNumber(d?.upsellCandidates)}
          icon={Sparkles}
          hint="Existing customers to expand"
          className="reveal"
          style={{ animationDelay: "80ms" }}
        />
      </div>

      <Card className="reveal lg:col-span-2" style={{ animationDelay: "120ms" }}>
        <CardHeader>
          <CardTitle>Forecast confidence</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <MeterBar percent={d?.forecastConfidence ?? 0} className="flex-1" />
            <span className="font-display text-xl font-semibold tabular-nums tracking-tight">
              {d?.forecastConfidence ?? 0}%
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Confidence in the predicted revenue figure based on pipeline coverage and lead quality.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Conversations tab ----

const sentimentBadgeClass = (sentiment: string): string => {
  const s = sentiment.toLowerCase();
  if (s === "positive") return "border-transparent bg-success/15 text-success";
  if (s === "negative") return "border-transparent bg-danger/15 text-danger";
  return "border-transparent bg-neutral/15 text-neutral";
};

function ConversationsTab() {
  const query = useQuery({
    queryKey: ["analytics-conversation-intelligence"],
    queryFn: getConversationIntelligence,
  });
  const d = query.data;

  if (query.isLoading) return <StatGridSkeleton count={6} />;

  const channels = Object.entries(d?.byChannel ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="reveal rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sentiment
          </p>
          <div className="mt-2.5">
            <Badge className={cn("text-sm", sentimentBadgeClass(d?.overallSentiment ?? "Neutral"))}>
              {d?.overallSentiment ?? "Neutral"}
            </Badge>
          </div>
        </div>
        <StatCard
          label="Messages"
          value={formatNumber(d?.messages)}
          icon={MessageSquare}
          className="reveal"
          style={{ animationDelay: "40ms" }}
        />
        <StatCard
          label="Calls"
          value={formatNumber(d?.calls)}
          icon={PhoneCall}
          className="reveal"
          style={{ animationDelay: "80ms" }}
        />
        <StatCard
          label="Positive signals"
          value={formatNumber(d?.positiveSignals)}
          icon={TrendingUp}
          className="reveal"
          style={{ animationDelay: "120ms" }}
        />
        <StatCard
          label="Risk signals"
          value={formatNumber(d?.riskSignals)}
          icon={AlertTriangle}
          className="reveal"
          style={{ animationDelay: "160ms" }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="reveal" style={{ animationDelay: "200ms" }}>
          <CardHeader>
            <CardTitle>Topics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {(d?.topics ?? []).map((topic) => (
                <Badge key={topic} variant="brand">
                  {topic}
                </Badge>
              ))}
            </div>

            <div className="mt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Talk ratio (agent vs customer)
              </p>
              {d?.talkRatio == null ? (
                <p className="mt-2 text-sm text-muted-foreground">No call transcripts yet.</p>
              ) : (
                <>
                  <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-brand" style={{ width: `${d.talkRatio}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                    Agents speak {d.talkRatio}% of call turns
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="reveal" style={{ animationDelay: "240ms" }}>
          <CardHeader>
            <CardTitle>Messages by channel</CardTitle>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <HBarChart
                data={channels.map(([channel, count]) => ({
                  label: channel,
                  value: count,
                  display: formatNumber(count),
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {d?.recommendation ? (
        <div
          className="reveal flex items-start gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4"
          style={{ animationDelay: "280ms" }}
        >
          <span className="flex size-8 shrink-0 items-center justify-center text-brand">
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand">
              Recommendation
            </p>
            <p className="mt-0.5 text-sm">{d.recommendation}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Page ----

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "support", label: "Support" },
  { value: "predictive", label: "Predictive" },
  { value: "conversations", label: "Conversations" },
];

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Sales, marketing and service performance." />

      <Tabs defaultValue="overview" className="reveal" style={{ animationDelay: "60ms" }}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="sales" className="mt-4">
          <SalesTab />
        </TabsContent>
        <TabsContent value="marketing" className="mt-4">
          <MarketingTab />
        </TabsContent>
        <TabsContent value="support" className="mt-4">
          <SupportTab />
        </TabsContent>
        <TabsContent value="predictive" className="mt-4">
          <PredictiveTab />
        </TabsContent>
        <TabsContent value="conversations" className="mt-4">
          <ConversationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
