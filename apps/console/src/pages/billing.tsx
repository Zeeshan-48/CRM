import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Wallet, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

import { getBillingMetrics } from "@/lib/api/billing";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

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

export default function BillingPage() {
  const query = useQuery({
    queryKey: ["billing-metrics"],
    queryFn: getBillingMetrics,
  });

  const metrics = query.data;
  const byStatus = metrics?.byStatus ?? {};
  const terminated = (byStatus.CANCELED ?? 0) + (byStatus.EXPIRED ?? 0);

  const cards = [
    {
      label: "MRR",
      value: formatMoney((metrics?.mrr ?? 0) / 100, metrics?.currency ?? "INR"),
      icon: Wallet,
      hint: "Active subscriptions",
    },
    {
      label: "Active",
      value: formatNumber(byStatus.ACTIVE ?? 0),
      icon: CheckCircle2,
      hint: "Paying workspaces",
    },
    {
      label: "Past due",
      value: formatNumber(byStatus.PAST_DUE ?? 0),
      icon: AlertTriangle,
      hint: "In dunning grace",
    },
    {
      label: "Canceled / expired",
      value: formatNumber(terminated),
      icon: XCircle,
      hint: "No longer billing",
    },
  ];

  const renewals = metrics?.upcomingRenewals ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Platform subscription revenue and renewals across all tenants."
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            hint={card.hint}
            loading={query.isLoading}
          />
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming renewals (next 7 days)</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {query.isLoading ? (
            <div className="space-y-2 px-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : renewals.length === 0 ? (
            <p className="px-5 text-sm text-muted-foreground">No renewals in the next 7 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-5">Renews</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renewals.map((r) => (
                  <TableRow key={r.tenant_id}>
                    <TableCell className="pl-5">
                      <Link
                        to={`/tenants/${r.tenant_id}`}
                        className="font-mono text-[12px] text-brand hover:underline"
                      >
                        {r.tenant_id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="brand" className="font-mono text-[11px]">
                        {r.plan_key}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(r.amount / 100, metrics?.currency ?? "INR")}
                    </TableCell>
                    <TableCell className="pr-5">
                      {r.current_period_end ? formatDate(r.current_period_end) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
