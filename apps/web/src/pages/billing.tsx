import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, ExternalLink, Loader2, Receipt, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { getMyBilling, listMyTransactions, payMyBilling, setMyBillingMode } from "@/lib/api/billing";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";
import type { PlatformTxnStatus, SubscriptionStatus } from "@/types";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_VARIANT: Record<
  SubscriptionStatus,
  "success" | "warning" | "destructive" | "secondary" | "outline"
> = {
  ACTIVE: "success",
  PENDING: "warning",
  PAST_DUE: "warning",
  CANCELED: "destructive",
  EXPIRED: "destructive",
  PAUSED: "secondary",
  GRANDFATHERED: "outline",
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  ACTIVE: "Active",
  PENDING: "Awaiting payment",
  PAST_DUE: "Payment due",
  CANCELED: "Canceled",
  EXPIRED: "Expired",
  PAUSED: "Paused",
  GRANDFATHERED: "Complimentary",
};

const TXN_VARIANT: Record<PlatformTxnStatus, "success" | "warning" | "destructive" | "secondary"> = {
  PAID: "success",
  PENDING: "warning",
  FAILED: "destructive",
  REFUNDED: "secondary",
};

const money = (paise: number, currency: string) =>
  currency && currency !== "INR" ? `${currency} ${(paise / 100).toLocaleString()}` : formatINR(paise / 100);

export default function BillingPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "ADMIN";

  const billingQuery = useQuery({
    queryKey: ["my-billing"],
    queryFn: getMyBilling,
    enabled: isAdmin,
  });
  const txnQuery = useQuery({
    queryKey: ["my-transactions"],
    queryFn: listMyTransactions,
    enabled: isAdmin,
  });

  const goToUrl = (url: string | null | undefined) => {
    if (url) window.location.href = url;
  };

  const payMutation = useMutation({
    mutationFn: payMyBilling,
    onSuccess: (data) => {
      if (data.url) {
        toast.success("Redirecting to secure checkout…");
        goToUrl(data.url);
      } else {
        toast.info("Nothing to pay right now.");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not start payment"),
  });

  const modeMutation = useMutation({
    mutationFn: setMyBillingMode,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["my-billing"] });
      if (data.url) {
        toast.success("Redirecting to authorize auto-renew…");
        goToUrl(data.url);
      } else {
        toast.success("Auto-renew turned off, you'll pay manually each month.");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update preference"),
  });

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing" description="Your workspace subscription and invoices." />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Only workspace admins can view billing.
          </CardContent>
        </Card>
      </div>
    );
  }

  const sub = billingQuery.data?.subscription ?? null;
  const plan = billingQuery.data?.plan ?? null;
  const txns = txnQuery.data ?? [];
  const isAuto = sub?.billing_mode === "AUTO";
  const grandfathered = sub?.status === "GRANDFATHERED";
  const needsPayment = sub ? ["PENDING", "PAST_DUE"].includes(sub.status) : false;
  const busy = payMutation.isPending || modeMutation.isPending;

  const payLabel =
    sub?.status === "PENDING" ? "Complete payment" : sub?.status === "PAST_DUE" ? "Pay now" : "Pay next month";

  const modules = Array.isArray(plan?.modules) ? (plan.modules as string[]) : [];
  const limits = (plan?.limits ?? {}) as {
    seats?: number;
    leads?: number;
    ai_credits_monthly?: number;
  };
  const renewalLabel = sub?.status === "PAST_DUE" ? "Pay before" : "Renews on";
  const renewalDate =
    sub?.status === "PAST_DUE" && sub.grace_until
      ? formatDate(sub.grace_until)
      : sub?.current_period_end
        ? formatDate(sub.current_period_end)
        : "-";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Your workspace subscription, payment method and invoices."
        actions={
          needsPayment ? (
            <Button className="gap-1.5" disabled={busy} onClick={() => payMutation.mutate()}>
              {payMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              {payLabel}
            </Button>
          ) : undefined
        }
      />

      {billingQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      ) : !sub ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No subscription is set up for this workspace yet. Please contact your platform administrator to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Subscription */}
          <Card className="reveal lg:col-span-2" style={{ animationDelay: "60ms" }}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" />
                  Subscription
                </CardTitle>
                <CardDescription>Your current plan.</CardDescription>
              </div>
              <Badge variant={STATUS_VARIANT[sub.status]}>{STATUS_LABEL[sub.status]}</Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Plan + price hero */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Current plan</p>
                  <p className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
                    {plan?.name ?? sub.plan_key}
                  </p>
                  {plan?.description ? (
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">{plan.description}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl font-semibold tabular-nums">
                    {sub.amount ? money(sub.amount, sub.currency) : "Free"}
                  </p>
                  <p className="text-xs text-muted-foreground">per month</p>
                </div>
              </div>

              {/* Details grid */}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Renewal</dt>
                  <dd className="mt-1 font-medium">
                    {grandfathered ? "-" : isAuto ? "Automatic" : "Manual"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{renewalLabel}</dt>
                  <dd className="mt-1 font-medium">{renewalDate}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Member since</dt>
                  <dd className="mt-1 font-medium">{formatDate(sub.created_at)}</dd>
                </div>
              </dl>

              {sub.status === "PAST_DUE" ? (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                  Your last payment didn&apos;t go through. Pay now to keep your workspace active,
                  access is paused after the grace period.
                </div>
              ) : null}

              {/* Auto-renew + manual pay */}
              {!grandfathered ? (
                <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                  <div>
                    <p className="text-sm font-medium">Automatic renewal</p>
                    <p className="text-xs text-muted-foreground">
                      {isAuto
                        ? "Your card is charged automatically each month."
                        : "Auto-renew is off, you pay a link manually each month."}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {sub.status === "ACTIVE" && !isAuto ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy}
                        onClick={() => payMutation.mutate()}
                      >
                        {payMutation.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Pay next month
                      </Button>
                    ) : null}
                    <Switch
                      checked={isAuto}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        modeMutation.mutate(checked ? "AUTO" : "MANUAL")
                      }
                    />
                  </div>
                </div>
              ) : (
                <p className="border-t pt-4 text-sm text-muted-foreground">
                  You&apos;re on a complimentary plan, no payment required.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Plan includes */}
          <Card className="reveal" style={{ animationDelay: "120ms" }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-muted-foreground" />
                Plan includes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Seats</dt>
                  <dd className="font-medium tabular-nums">
                    {limits.seats != null ? formatNumber(limits.seats) : "-"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Leads</dt>
                  <dd className="font-medium tabular-nums">
                    {limits.leads != null ? formatNumber(limits.leads) : "-"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">AI credits / mo</dt>
                  <dd className="font-medium tabular-nums">
                    {limits.ai_credits_monthly != null
                      ? formatNumber(limits.ai_credits_monthly)
                      : "-"}
                  </dd>
                </div>
              </dl>

              {modules.length ? (
                <div className="border-t pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Modules ({modules.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {modules.map((m) => (
                      <Badge key={m} variant="secondary" className="capitalize">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Invoices */}
      <Card className="reveal" style={{ animationDelay: "180ms" }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4 text-muted-foreground" />
            Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {txnQuery.isLoading ? (
            <div className="space-y-2 px-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : txns.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell className="pl-6 text-muted-foreground">
                      {formatDate(txn.occurred_at)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {money(txn.amount, txn.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TXN_VARIANT[txn.status]}>{txn.status}</Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {txn.hosted_invoice_url ? (
                        <a
                          href={txn.hosted_invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          View <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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
