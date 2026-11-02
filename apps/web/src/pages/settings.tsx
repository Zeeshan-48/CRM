import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CreditCard,
  Layers,
  Palette,
  Settings,
  Users,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { WorkingHoursCard } from "@/components/settings/WorkingHoursCard";
import {
  getTenantMe,
  listTenantPlans,
  updateTenantMe,
  type UpdateTenantPayload,
} from "@/lib/api/tenant";
import { BRAND } from "@/lib/brand";
import { formatINR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { applyBrandColor, useAuthStore } from "@/stores/auth-store";

/** Default lead-assignment strategies, mirrored from the backend. "MANUAL" here
 * means auto-assignment is off, new leads stay unassigned. */
const ASSIGNMENT_STRATEGY_OPTIONS: {
  value: string;
  label: string;
  hint: string;
}[] = [
  {
    value: "MANUAL",
    label: "Off, assign manually",
    hint: "New leads stay unassigned until someone picks an owner.",
  },
  {
    value: "ROUND_ROBIN",
    label: "Round robin",
    hint: "Spread new leads evenly across agents by lightest current load.",
  },
  {
    value: "AI",
    label: "AI, smart routing",
    hint: "Score agents on performance, skill/territory fit and load, then pick the best.",
  },
  {
    value: "SKILL_BASED",
    label: "Skill based",
    hint: "Route by the lead's source to an agent who lists it as a skill (else round robin).",
  },
  {
    value: "TERRITORY_BASED",
    label: "Territory based",
    hint: "Route by the lead's city to an agent covering that territory (else round robin).",
  },
];

/** Reads tenants.config.leadAssignment.defaultStrategy, defaulting to MANUAL. */
const readDefaultStrategy = (
  config: Record<string, unknown> | null | undefined,
): string => {
  const la =
    config?.leadAssignment && typeof config.leadAssignment === "object"
      ? (config.leadAssignment as Record<string, unknown>)
      : {};
  const value =
    typeof la.defaultStrategy === "string" ? la.defaultStrategy : "MANUAL";
  return ASSIGNMENT_STRATEGY_OPTIONS.some((o) => o.value === value)
    ? value
    : "MANUAL";
};

const planPrice = (price: number, currency: string): string => {
  if (price === 0) return "Free";
  const amount =
    currency === "INR"
      ? formatINR(price)
      : `${currency} ${formatNumber(price)}`;
  return `${amount}/month`;
};

function UsageMeter({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number | null | undefined;
}) {
  const pct =
    typeof limit === "number" && limit > 0
      ? Math.min(100, Math.round((used / limit) * 100))
      : null;
  return (
    <div className="border-t pt-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatNumber(used)}
          {typeof limit === "number"
            ? ` / ${formatNumber(limit)}`
            : " / Unlimited"}
        </p>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full bg-brand",
            pct === null && "bg-brand/30",
          )}
          style={{ width: `${pct ?? 100}%` }}
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === "ADMIN";

  const tenantQuery = useQuery({
    queryKey: ["tenant-me"],
    queryFn: getTenantMe,
  });
  const plansQuery = useQuery({
    queryKey: ["tenant-plans"],
    queryFn: listTenantPlans,
  });

  const data = tenantQuery.data;
  const tenant = data?.tenant;
  const plans = plansQuery.data ?? [];

  // ---- Form state, synced from the workspace query ----
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [emailDomain, setEmailDomain] = React.useState("");
  const [brandColor, setBrandColor] = React.useState<string>(BRAND.defaultColor);
  const [whiteLabel, setWhiteLabel] = React.useState(false);
  const [assignStrategy, setAssignStrategy] = React.useState("MANUAL");
  // Which section's Save is in flight, the three save buttons share one
  // mutation, so track this to spin only the button that was clicked.
  const [savingSection, setSavingSection] = React.useState<
    "workspace" | "branding" | "assignment" | null
  >(null);

  React.useEffect(() => {
    if (!tenant) return;
    setName(tenant.name ?? "");
    setDomain(tenant.domain ?? "");
    setEmailDomain((tenant.email_domain as string | null) ?? "");
    setBrandColor(tenant.brand_color || BRAND.defaultColor);
    setWhiteLabel(Boolean(tenant.white_label));
    setAssignStrategy(
      readDefaultStrategy(
        (tenant.config as Record<string, unknown> | null) ?? null,
      ),
    );
  }, [tenant]);

  const saveMutation = useMutation({
    mutationFn: (payload: UpdateTenantPayload) => updateTenantMe(payload),
    onSuccess: (updated, payload) => {
      toast.success("Workspace updated.");
      queryClient.invalidateQueries({ queryKey: ["tenant-me"] });
      // Keep the auth store's tenant snapshot in sync so the shell (top bar,
      // side nav) reflects the new name immediately.
      const { user } = useAuthStore.getState();
      if (user?.tenant) {
        useAuthStore.setState({
          user: {
            ...user,
            tenant: {
              ...user.tenant,
              name: updated.name,
              brand_color: updated.brand_color,
              domain: updated.domain,
            },
          },
        });
      }
      // Re-theme the whole app when branding changed: the --brand CSS variable
      // resolves from the tenant brand colour.
      if (payload.brand_color !== undefined) {
        applyBrandColor(updated.brand_color);
      }
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => setSavingSection(null),
  });

  const saveWorkspace = () => {
    if (!name.trim()) {
      toast.error("Workspace name cannot be empty.");
      return;
    }
    setSavingSection("workspace");
    saveMutation.mutate({
      name: name.trim(),
      domain: domain.trim() || null,
      email_domain: emailDomain.trim() || null,
    });
  };

  const saveBranding = () => {
    setSavingSection("branding");
    saveMutation.mutate({ brand_color: brandColor, white_label: whiteLabel });
  };

  const saveAssignment = () => {
    // The backend shallow-merges config, so sending only the leadAssignment
    // section preserves other config (scheduling, etc.).
    setSavingSection("assignment");
    saveMutation.mutate({
      config: { leadAssignment: { defaultStrategy: assignStrategy } },
    });
  };

  if (tenantQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Workspace branding, preferences and configuration."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (!data || !tenant) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Workspace branding, preferences and configuration."
        />
        <EmptyState
          icon={Settings}
          title="Workspace unavailable"
          description="We could not load your workspace details. Try refreshing the page."
        />
      </div>
    );
  }

  const currentPlan = plans.find((plan) => plan.key === tenant.plan_key);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Workspace branding, preferences and configuration."
      />

      {!isAdmin ? (
        <div className="reveal rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Read-only: only workspace admins can edit these settings.
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Workspace */}
        <section className="reveal" style={{ animationDelay: "60ms" }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-brand" />
                Workspace
              </CardTitle>
              <CardDescription>
                Identity and domains for this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ws-name">Workspace name</Label>
                <Input
                  id="ws-name"
                  value={name}
                  disabled={!isAdmin}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-domain">Domain</Label>
                <Input
                  id="ws-domain"
                  value={domain}
                  disabled={!isAdmin}
                  placeholder="crm.yourcompany.com"
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-email-domain">Email domain</Label>
                <Input
                  id="ws-email-domain"
                  value={emailDomain}
                  disabled={!isAdmin}
                  placeholder="yourcompany.com"
                  onChange={(e) => setEmailDomain(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Outbound email is sent from this domain.
                </p>
              </div>
              {isAdmin ? (
                <div className="flex justify-end">
                  <Button
                    onClick={saveWorkspace}
                    loading={savingSection === "workspace"}
                    disabled={saveMutation.isPending}
                  >
                    Save workspace
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* Branding */}
        <section className="reveal" style={{ animationDelay: "120ms" }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="size-4 text-brand" />
                Branding
              </CardTitle>
              <CardDescription>
                Saving re-themes the app for everyone in this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="brand-color">Brand colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="brand-color"
                    type="color"
                    value={brandColor}
                    disabled={!isAdmin}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-9 w-14 cursor-pointer rounded-md border border-input bg-card p-1 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Input
                    value={brandColor}
                    disabled={!isAdmin}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="w-32 font-mono text-xs"
                  />
                  <span
                    className="inline-flex items-center rounded-md px-3 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: brandColor }}
                  >
                    Live preview
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-3.5">
                <div>
                  <p className="text-sm font-medium">White label</p>
                  <p className="text-xs text-muted-foreground">
                    Hide {BRAND.name} branding across the workspace.
                  </p>
                </div>
                <Switch
                  checked={whiteLabel}
                  disabled={!isAdmin}
                  onCheckedChange={setWhiteLabel}
                />
              </div>
              {isAdmin ? (
                <div className="flex justify-end">
                  <Button
                    onClick={saveBranding}
                    loading={savingSection === "branding"}
                    disabled={saveMutation.isPending}
                  >
                    Save branding
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Lead assignment */}
      <section className="reveal" style={{ animationDelay: "150ms" }}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-brand" />
              Lead assignment
            </CardTitle>
            <CardDescription>
              How new leads are routed to agents automatically as they arrive.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="settings-default-strategy-for-new-leads">Default strategy for new leads</Label>
              <Select
                value={assignStrategy}
                onValueChange={setAssignStrategy}
                disabled={!isAdmin}
              >
                <SelectTrigger id="settings-default-strategy-for-new-leads" className="sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_STRATEGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  ASSIGNMENT_STRATEGY_OPTIONS.find(
                    (o) => o.value === assignStrategy,
                  )?.hint
                }
              </p>
            </div>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Skill- and territory-based routing rely on each agent&apos;s
              skills and territory, set those on the{" "}
              <span className="font-medium">Users &amp; Roles</span> page. Leads
              a workflow or import already assigns are left untouched. You can
              still re-assign any lead manually at any time.
            </p>
            {isAdmin ? (
              <div className="flex justify-end">
                <Button
                  onClick={saveAssignment}
                  loading={savingSection === "assignment"}
                  disabled={saveMutation.isPending}
                >
                  Save assignment
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* Working hours, workspace-wide, consumed by scheduling + the sales agent */}
      <section className="reveal" style={{ animationDelay: "150ms" }}>
        <WorkingHoursCard canEdit={isAdmin} />
      </section>

      {/* Plan & usage */}
      <section className="reveal" style={{ animationDelay: "180ms" }}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-4 text-brand" />
              Plan &amp; Usage
            </CardTitle>
            <CardDescription>
              What this workspace is on and how much of it is in use.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 border-l-2 border-brand py-1 pl-4">
              <span className="flex size-10 items-center justify-center text-brand">
                <BadgeCheck className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-semibold tracking-tight">
                  {currentPlan?.name ?? tenant.plan_key ?? "No plan"}
                  {tenant.plan_key ? (
                    <span className="ml-2 align-middle font-sans text-xs font-medium text-brand">
                      {tenant.plan_key}
                    </span>
                  ) : null}
                </p>
                {currentPlan ? (
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {planPrice(currentPlan.price_monthly, currentPlan.currency)}
                  </p>
                ) : null}
              </div>
              <div className="flex max-w-md flex-wrap gap-1">
                {(data.modules.includes("*")
                  ? ["All modules"]
                  : data.modules
                ).map((mod) => (
                  <span
                    key={mod}
                    className="inline-flex items-center text-xs text-muted-foreground"
                  >
                    {mod}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <UsageMeter
                label="Seats"
                used={data.usage.users}
                limit={data.limits.seats}
              />
              <UsageMeter
                label="Leads"
                used={data.usage.leads}
                limit={data.limits.leads}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="border-t pt-3.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Contacts
                </p>
                <p className="mt-1.5 font-display text-xl font-semibold tabular-nums tracking-tight">
                  {formatNumber(data.usage.contacts)}
                </p>
              </div>
              <div className="border-t pt-3.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Deals
                </p>
                <p className="mt-1.5 font-display text-xl font-semibold tabular-nums tracking-tight">
                  {formatNumber(data.usage.deals)}
                </p>
              </div>
              <div className="col-span-2 border-t pt-3.5 sm:col-span-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Open deal value
                </p>
                <p className="mt-1.5 font-display text-xl font-semibold tabular-nums tracking-tight">
                  {formatINR(data.usage.openDealValue)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* All plans */}
      <section className="reveal" style={{ animationDelay: "240ms" }}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-brand" />
              All plans
            </CardTitle>
            <CardDescription>
              Compare what each {BRAND.name} plan includes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {plansQuery.isLoading ? (
              <div className="grid gap-3 md:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No plans are published yet.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {plans.map((plan) => {
                  const isCurrent = plan.key === tenant.plan_key;
                  return (
                    <div
                      key={plan.key}
                      className={cn(
                        "rounded-lg border p-4 transition-colors duration-120",
                        isCurrent
                          ? "border-brand bg-brand/5"
                          : "hover:border-brand/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-display text-sm font-semibold tracking-tight">
                          {plan.name}
                        </p>
                        {isCurrent ? (
                          <span className="inline-flex items-center rounded-md bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground">
                            Current plan
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-display text-xl font-semibold tabular-nums tracking-tight">
                        {planPrice(plan.price_monthly, plan.currency)}
                      </p>
                      {plan.description ? (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {plan.description}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {(plan.modules.includes("*")
                          ? ["All modules"]
                          : plan.modules
                        ).map((mod) => (
                          <span
                            key={mod}
                            className="inline-flex items-center text-xs text-muted-foreground"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 space-y-1 border-t pt-3 text-xs tabular-nums text-muted-foreground">
                        {Object.entries(plan.limits).map(([code, value]) => (
                          <p key={code} className="flex justify-between gap-2">
                            <span>{code.replace(/_/g, " ")}</span>
                            <span>
                              {value === null
                                ? "Unlimited"
                                : formatNumber(value)}
                            </span>
                          </p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
