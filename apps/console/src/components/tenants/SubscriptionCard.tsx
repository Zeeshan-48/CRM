import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { cancelSubscription, createSubscription, getSubscription } from "@/lib/api/billing";
import { formatDate, formatMoney } from "@/lib/format";
import type { BillingGateway, SubscriptionStatus } from "@/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// A subscription is "live" (occupies the tenant's single active slot) in these
// states; otherwise the operator can start a fresh one.
const LIVE: SubscriptionStatus[] = ["PENDING", "ACTIVE", "PAST_DUE"];

const STATUS_VARIANT: Record<SubscriptionStatus, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  ACTIVE: "success",
  PENDING: "warning",
  PAST_DUE: "warning",
  CANCELED: "destructive",
  EXPIRED: "destructive",
  PAUSED: "secondary",
  GRANDFATHERED: "outline",
};

const money = (paise: number, currency: string) => formatMoney(paise / 100, currency);

interface Props {
  tenantId: string;
  isSuperadmin: boolean;
}

export function SubscriptionCard({ tenantId, isSuperadmin }: Props) {
  const queryClient = useQueryClient();
  const [startOpen, setStartOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [gateway, setGateway] = useState<BillingGateway>("RAZORPAY");
  const [billingMode, setBillingMode] = useState<"AUTO" | "MANUAL">("MANUAL");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["tenant-subscription", tenantId],
    queryFn: () => getSubscription(tenantId),
    enabled: Boolean(tenantId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant-subscription", tenantId] });
    queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
  };

  const createMutation = useMutation({
    mutationFn: () => createSubscription(tenantId, { gateway, billingMode }),
    onSuccess: (data) => {
      setCheckoutUrl(data.checkoutUrl);
      invalidate();
      toast.success("Subscription created, awaiting first payment");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create subscription"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelSubscription(tenantId, {}),
    onSuccess: () => {
      invalidate();
      setCancelOpen(false);
      toast.success("Subscription canceled, workspace suspended");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to cancel"),
  });

  const sub = query.data?.subscription ?? null;
  const live = sub ? LIVE.includes(sub.status) : false;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          Subscription
        </CardTitle>
        {isSuperadmin ? (
          live ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setCheckoutUrl(null);
                setStartOpen(true);
              }}
            >
              Start subscription
            </Button>
          )
        ) : null}
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-24" />
        ) : !sub ? (
          <p className="text-sm text-muted-foreground">
            No subscription yet. {isSuperadmin ? "Start one to begin billing this tenant." : ""}
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <Badge variant={STATUS_VARIANT[sub.status]}>{sub.status}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Plan</dt>
              <dd className="mt-1 font-mono text-[13px]">{sub.plan_key}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Gateway</dt>
              <dd className="mt-1">{sub.gateway === "NONE" ? "-" : sub.gateway}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Renewal</dt>
              <dd className="mt-1">{sub.billing_mode === "MANUAL" ? "Manual" : "Auto"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amount</dt>
              <dd className="mt-1 font-medium">
                {sub.amount ? `${money(sub.amount, sub.currency)} / mo` : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Renews / ends</dt>
              <dd className="mt-1">
                {sub.current_period_end ? formatDate(sub.current_period_end) : "-"}
              </dd>
            </div>
            {sub.status === "PAST_DUE" && sub.grace_until ? (
              <div>
                <dt className="text-xs text-muted-foreground">Grace until</dt>
                <dd className="mt-1 text-warning">{formatDate(sub.grace_until)}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </CardContent>

      {/* Start subscription dialog */}
      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start subscription</DialogTitle>
            <DialogDescription>
              Create a subscription on the platform&apos;s gateway account. The tenant admin completes the
              hosted checkout to activate the workspace.
            </DialogDescription>
          </DialogHeader>

          {checkoutUrl ? (
            <div className="space-y-2">
              <Label>Checkout link</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
                  {checkoutUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(checkoutUrl);
                    toast.success("Copied");
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this with the tenant admin. The workspace activates on the first successful
                payment.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="gateway">Gateway</Label>
                <Select value={gateway} onValueChange={(v) => setGateway(v as BillingGateway)}>
                  <SelectTrigger id="gateway">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RAZORPAY">Razorpay</SelectItem>
                    <SelectItem value="STRIPE">Stripe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mode">Billing</Label>
                <Select value={billingMode} onValueChange={(v) => setBillingMode(v as "AUTO" | "MANUAL")}>
                  <SelectTrigger id="mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTO">Auto-renew (charge each month)</SelectItem>
                    <SelectItem value="MANUAL">Manual (pay a link each month)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            {checkoutUrl ? (
              <Button onClick={() => setStartOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setStartOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="gap-1.5"
                  disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Create
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel subscription?</DialogTitle>
            <DialogDescription>
              This cancels the subscription immediately and suspends the workspace. The tenant loses
              access until a new subscription is started and paid.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
