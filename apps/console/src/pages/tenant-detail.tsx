import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Loader2,
  Pause,
  Play,
  Save,
  UserPlus,
  Users,
} from "lucide-react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { StatCard } from "@/components/layout/StatCard";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { SubscriptionCard } from "@/components/tenants/SubscriptionCard";
import { TenantBillingProfileCard } from "@/components/tenants/TenantBillingProfileCard";
import { TransactionsCard } from "@/components/tenants/TransactionsCard";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { listPlans } from "@/lib/api/plans";
import { getTenant, overrideEntitlement, updateTenant } from "@/lib/api/tenants";
import {
  LIMIT_CODE_PREFIX,
  MODULE_CODE_PREFIX,
  limitLabel,
  moduleLabel,
} from "@/lib/constants/modules";
import { formatDate, formatNumber } from "@/lib/format";
import { isSuperadmin, useAuthStore } from "@/stores/auth-store";
import type { Entitlement, TenantStatus } from "@/types";

// ---- Entitlement row editors ----

interface ModuleRowProps {
  row: Entitlement;
  canWrite: boolean;
  onSave: (payload: { code: string; enabled: boolean }) => void;
  saving: boolean;
}

function ModuleRow({ row, canWrite, onSave, saving }: ModuleRowProps) {
  const [enabled, setEnabled] = React.useState(row.enabled);

  React.useEffect(() => {
    setEnabled(row.enabled);
  }, [row.enabled]);

  const dirty = enabled !== row.enabled;

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">
          {moduleLabel(row.code.replace(MODULE_CODE_PREFIX, ""))}
        </span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">{row.code}</span>
      </TableCell>
      <TableCell>
        <Badge variant={row.source === "ADMIN" ? "brand" : "secondary"} className="text-[11px]">
          {row.source}
        </Badge>
      </TableCell>
      <TableCell>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canWrite || saving} />
      </TableCell>
      <TableCell className="text-right">
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!dirty || saving}
            onClick={() => onSave({ code: row.code, enabled })}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

interface LimitRowProps {
  row: Entitlement;
  canWrite: boolean;
  onSave: (payload: { code: string; limit_value: number }) => void;
  saving: boolean;
}

function LimitRow({ row, canWrite, onSave, saving }: LimitRowProps) {
  const [value, setValue] = React.useState(String(row.limit_value ?? 0));

  React.useEffect(() => {
    setValue(String(row.limit_value ?? 0));
  }, [row.limit_value]);

  const parsed = parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  const dirty = valid && parsed !== (row.limit_value ?? 0);

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{limitLabel(row.code)}</span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">{row.code}</span>
      </TableCell>
      <TableCell>
        <Badge variant={row.source === "ADMIN" ? "brand" : "secondary"} className="text-[11px]">
          {row.source}
        </Badge>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          className="h-8 w-32 tabular-nums"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={!canWrite || saving}
        />
      </TableCell>
      <TableCell className="text-right">
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!dirty || saving}
            onClick={() => onSave({ code: row.code, limit_value: parsed })}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

// ---- Page ----

export default function TenantDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = isSuperadmin(user);

  const detailQuery = useQuery({
    queryKey: ["tenant", id],
    queryFn: () => getTenant(id),
    enabled: Boolean(id),
  });
  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: listPlans,
    staleTime: 5 * 60_000,
  });

  const [pendingStatus, setPendingStatus] = React.useState<TenantStatus | null>(null);
  const [pendingPlan, setPendingPlan] = React.useState<string | null>(null);
  const [savingCode, setSavingCode] = React.useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant", id] });
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
    queryClient.invalidateQueries({ queryKey: ["metrics-overview"] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: TenantStatus) => updateTenant(id, { status }),
    onSuccess: (updated) => {
      invalidate();
      setPendingStatus(null);
      toast.success(`Tenant is now ${updated.status}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Status change failed.");
    },
  });

  const planMutation = useMutation({
    mutationFn: (planKey: string) => updateTenant(id, { plan_key: planKey }),
    onSuccess: (updated) => {
      invalidate();
      setPendingPlan(null);
      toast.success(`Plan changed to ${updated.plan_key}. Entitlements re-snapshotted.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Plan change failed.");
    },
  });

  const entitlementMutation = useMutation({
    mutationFn: (payload: { code: string; enabled?: boolean; limit_value?: number }) =>
      overrideEntitlement(id, payload),
    onSuccess: (row) => {
      invalidate();
      toast.success(`Entitlement ${row.code} saved`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Entitlement update failed.");
    },
    onSettled: () => setSavingCode(null),
  });

  const saveEntitlement = (payload: { code: string; enabled?: boolean; limit_value?: number }) => {
    setSavingCode(payload.code);
    entitlementMutation.mutate(payload);
  };

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="mx-auto max-w-lg pt-16">
        <EmptyState
          icon={Building2}
          title="Tenant not found"
          description="This tenant does not exist or could not be loaded."
          action={
            <Button asChild variant="outline">
              <Link to="/tenants">Back to tenants</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { tenant, entitlements, usage, adminUsers } = detailQuery.data;
  const activePlans = (plansQuery.data ?? []).filter((plan) => plan.is_active);
  const pendingPlanDetails = activePlans.find((plan) => plan.key === pendingPlan);

  const moduleRows = entitlements
    .filter((row) => row.code.startsWith(MODULE_CODE_PREFIX))
    .sort((a, b) => a.code.localeCompare(b.code));
  const limitRows = entitlements
    .filter((row) => row.code.startsWith(LIMIT_CODE_PREFIX))
    .sort((a, b) => a.code.localeCompare(b.code));

  const nextStatus: TenantStatus = tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="reveal">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 gap-1.5 text-muted-foreground">
          <Link to="/tenants">
            <ArrowLeft className="size-4" />
            Tenants
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="size-3.5 shrink-0 rounded-full border border-white/20"
              style={{ backgroundColor: tenant.brand_color || "#0a66c2" }}
            />
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {tenant.name}
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span className="font-mono text-xs">{tenant.slug}</span>
                {tenant.industry ? (
                  <>
                    <span>&middot;</span>
                    <span>{tenant.industry}</span>
                  </>
                ) : null}
                <span>&middot;</span>
                <span>since {formatDate(tenant.created_at)}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={tenant.status} />
            {tenant.plan_key ? (
              <Badge variant="brand" className="font-mono text-[11px]">
                {tenant.plan_key}
              </Badge>
            ) : null}
            {canWrite ? (
              <>
                <Button
                  variant={tenant.status === "ACTIVE" ? "outline" : "default"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setPendingStatus(nextStatus)}
                >
                  {tenant.status === "ACTIVE" ? (
                    <>
                      <Pause className="size-4" />
                      Suspend
                    </>
                  ) : (
                    <>
                      <Play className="size-4" />
                      Activate
                    </>
                  )}
                </Button>
                <Select
                  value={tenant.plan_key ?? ""}
                  onValueChange={(value) => {
                    if (value && value !== tenant.plan_key) setPendingPlan(value);
                  }}
                >
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue placeholder="Change plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePlans.map((plan) => (
                      <SelectItem key={plan.key} value={plan.key}>
                        {plan.name} ({plan.key})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Usage cards */}
      <section className="reveal grid grid-cols-2 gap-3 sm:max-w-md" style={{ animationDelay: "60ms" }}>
        <StatCard label="Users" value={formatNumber(usage.users)} icon={Users} />
        <StatCard label="Leads" value={formatNumber(usage.leads)} icon={UserPlus} />
      </section>

      {/* Subscription */}
      <section className="reveal" style={{ animationDelay: "80ms" }}>
        <SubscriptionCard tenantId={id} isSuperadmin={canWrite} />
      </section>

      {/* Tax Invoice & Legal Profile */}
      <section className="reveal" style={{ animationDelay: "100ms" }}>
        <TenantBillingProfileCard tenant={tenant} canWrite={canWrite} />
      </section>

      {/* Admin users */}
      <section className="reveal" style={{ animationDelay: "120ms" }}>
        <Card>
          <CardHeader>
            <CardTitle>Admin users</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {adminUsers.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                No admin users found for this workspace.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="pr-5">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminUsers.map((adminUser) => (
                    <TableRow key={adminUser.id}>
                      <TableCell className="pl-5 font-medium">{adminUser.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {adminUser.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[11px]">
                          {adminUser.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-5">
                        <StatusBadge status={adminUser.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Billing transactions */}
      <section className="reveal" style={{ animationDelay: "160ms" }}>
        <TransactionsCard tenantId={id} />
      </section>

      {/* Entitlements */}
      <section className="reveal" style={{ animationDelay: "180ms" }}>
        <Card>
          <CardHeader>
            <CardTitle>Entitlements</CardTitle>
            <p className="text-sm text-muted-foreground">
              PLAN rows come from the plan snapshot; edited rows become ADMIN overrides and
              survive future plan changes.
            </p>
          </CardHeader>
          <CardContent className="space-y-6 px-0 pb-2">
            <div>
              <p className="px-5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Modules
              </p>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Module</TableHead>
                    <TableHead className="w-28">Source</TableHead>
                    <TableHead className="w-28">Enabled</TableHead>
                    <TableHead className="w-28 pr-5 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moduleRows.map((row) => (
                    <ModuleRow
                      key={row.code}
                      row={row}
                      canWrite={canWrite}
                      saving={savingCode === row.code && entitlementMutation.isPending}
                      onSave={saveEntitlement}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <p className="px-5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Limits
              </p>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Limit</TableHead>
                    <TableHead className="w-28">Source</TableHead>
                    <TableHead className="w-40">Value</TableHead>
                    <TableHead className="w-28 pr-5 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limitRows.map((row) => (
                    <LimitRow
                      key={row.code}
                      row={row}
                      canWrite={canWrite}
                      saving={savingCode === row.code && entitlementMutation.isPending}
                      onSave={saveEntitlement}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Suspend/Activate confirm */}
      <Dialog
        open={pendingStatus !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStatus(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingStatus === "SUSPENDED" ? "Suspend tenant?" : "Activate tenant?"}
            </DialogTitle>
            <DialogDescription>
              {pendingStatus === "SUSPENDED"
                ? `${tenant.name} will be marked SUSPENDED. Workspace sign-ins are blocked while suspended.`
                : `${tenant.name} will be marked ACTIVE and its users can sign in again.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStatus(null)}>
              Cancel
            </Button>
            <Button
              variant={pendingStatus === "SUSPENDED" ? "destructive" : "default"}
              disabled={statusMutation.isPending}
              onClick={() => pendingStatus && statusMutation.mutate(pendingStatus)}
              className="gap-1.5"
            >
              {statusMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {pendingStatus === "SUSPENDED" ? "Suspend" : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan change confirm */}
      <Dialog
        open={pendingPlan !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPlan(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change plan to {pendingPlanDetails?.name ?? pendingPlan}?</DialogTitle>
            <DialogDescription>
              The current PLAN entitlement snapshot will be dropped and re-snapshotted from{" "}
              {pendingPlan}. ADMIN overrides are preserved as-is. The plan itself is never
              read at runtime; only the snapshot matters.
            </DialogDescription>
          </DialogHeader>
          {pendingPlanDetails ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              {pendingPlanDetails.modules.length} modules
              <span className="px-1.5">&middot;</span>
              {formatNumber(pendingPlanDetails.limits.seats)} seats
              <span className="px-1.5">&middot;</span>
              {formatNumber(pendingPlanDetails.limits.leads)} leads
              <span className="px-1.5">&middot;</span>
              {formatNumber(pendingPlanDetails.limits.ai_credits_monthly)} AI credits/mo
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingPlan(null)}>
              Cancel
            </Button>
            <Button
              disabled={planMutation.isPending}
              onClick={() => pendingPlan && planMutation.mutate(pendingPlan)}
              className="gap-1.5"
            >
              {planMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Change plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
