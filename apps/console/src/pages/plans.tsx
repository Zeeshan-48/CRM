import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Layers, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PlanDialog } from "@/components/plans/PlanDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { listPlans, updatePlan } from "@/lib/api/plans";
import { moduleLabel } from "@/lib/constants/modules";
import { formatMoney, formatNumber } from "@/lib/format";
import { isSuperadmin, useAuthStore } from "@/stores/auth-store";
import type { Plan } from "@/types";

const COLLAPSED_MODULE_COUNT = 6;

interface PlanCardProps {
  plan: Plan;
  canWrite: boolean;
  onEdit: (plan: Plan) => void;
  onToggleActive: (plan: Plan, isActive: boolean) => void;
  toggling: boolean;
  style?: React.CSSProperties;
}

function PlanCard({ plan, canWrite, onEdit, onToggleActive, toggling, style }: PlanCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const visibleModules = expanded
    ? plan.modules
    : plan.modules.slice(0, COLLAPSED_MODULE_COUNT);
  const hiddenCount = plan.modules.length - COLLAPSED_MODULE_COUNT;

  return (
    <Card
      className="reveal flex flex-col transition-colors duration-120 hover:border-brand/40"
      style={style}
    >
      <CardHeader className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Badge variant="brand" className="font-mono text-[11px]">
              {plan.key}
            </Badge>
            <h3 className="mt-2 font-display text-lg font-semibold tracking-tight">
              {plan.name}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {plan.is_active ? "Active" : "Inactive"}
            </span>
            <Switch
              aria-label={`${plan.name} plan active`}
              checked={plan.is_active}
              disabled={!canWrite || toggling}
              onCheckedChange={(checked) => onToggleActive(plan, checked)}
            />
          </div>
        </div>
        <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
          {formatMoney(plan.price_monthly, plan.currency)}
          <span className="text-sm font-normal text-muted-foreground">/mo</span>
        </p>
        {plan.description ? (
          <p className="text-sm text-muted-foreground">{plan.description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Modules{" "}
            <span className="font-normal normal-case tabular-nums">
              ({plan.modules.length})
            </span>
          </p>
          <div className="flex flex-wrap gap-1">
            {visibleModules.map((moduleKey) => (
              <Badge key={moduleKey} variant="secondary" className="text-[11px]">
                {moduleLabel(moduleKey)}
              </Badge>
            ))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand hover:underline"
              >
                {expanded ? (
                  <>
                    Show less
                    <ChevronUp className="size-3" />
                  </>
                ) : (
                  <>
                    +{hiddenCount} more
                    <ChevronDown className="size-3" />
                  </>
                )}
              </button>
            ) : null}
          </div>
        </div>

        <Separator />

        <p className="text-xs tabular-nums text-muted-foreground">
          {formatNumber(plan.limits.seats)} seats
          <span className="px-1.5">&middot;</span>
          {formatNumber(plan.limits.leads)} leads
          <span className="px-1.5">&middot;</span>
          {formatNumber(plan.limits.ai_credits_monthly)} AI credits/mo
        </p>

        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-xs tabular-nums text-muted-foreground">
            Sort order {plan.sort_order}
          </span>
          {canWrite ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onEdit(plan)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = isSuperadmin(user);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingPlan, setEditingPlan] = React.useState<Plan | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: listPlans,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ plan, isActive }: { plan: Plan; isActive: boolean }) =>
      updatePlan(plan.id, { is_active: isActive }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast.success(`Plan ${saved.key} is now ${saved.is_active ? "active" : "inactive"}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Toggling the plan failed.");
    },
    onSettled: () => setTogglingId(null),
  });

  const plans = [...(plansQuery.data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)
  );

  const openCreate = () => {
    setEditingPlan(null);
    setDialogOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Plans"
        description="The plan catalog new tenants onboard onto. Entitlements snapshot at onboarding; editing a plan never mutates existing tenants."
        actions={
          canWrite ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="size-4" />
              New Plan
            </Button>
          ) : null
        }
      />

      {plansQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No plans yet"
          description="Create your first plan so tenants can be onboarded onto it."
          action={
            canWrite ? (
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="size-4" />
                New Plan
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan, index) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              canWrite={canWrite}
              onEdit={openEdit}
              toggling={togglingId === plan.id && toggleMutation.isPending}
              onToggleActive={(target, isActive) => {
                setTogglingId(target.id);
                toggleMutation.mutate({ plan: target, isActive });
              }}
              style={{ animationDelay: `${60 + index * 45}ms` }}
            />
          ))}
        </div>
      )}

      <PlanDialog open={dialogOpen} onOpenChange={setDialogOpen} plan={editingPlan} />
    </div>
  );
}
