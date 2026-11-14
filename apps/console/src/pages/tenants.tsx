import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { OnboardTenantDialog } from "@/components/tenants/OnboardTenantDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPlans } from "@/lib/api/plans";
import { listTenants } from "@/lib/api/tenants";
import { useDebouncedValue } from "@/lib/hooks";
import { formatDate, formatNumber } from "@/lib/format";
import { BRAND } from "@/lib/brand";
import { isSuperadmin, useAuthStore } from "@/stores/auth-store";

const STATUS_OPTIONS = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;
const ALL_STATUSES = "__ALL__";

export default function TenantsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canWrite = isSuperadmin(user);

  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>(ALL_STATUSES);
  const [onboardOpen, setOnboardOpen] = React.useState(false);

  const debouncedQ = useDebouncedValue(q.trim());
  const effectiveStatus = status === ALL_STATUSES ? "" : status;

  const tenantsQuery = useQuery({
    queryKey: ["tenants", debouncedQ, effectiveStatus],
    queryFn: () =>
      listTenants({
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(effectiveStatus ? { status: effectiveStatus } : {}),
      }),
    placeholderData: (previous) => previous,
  });

  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: listPlans,
    staleTime: 5 * 60_000,
  });

  const tenants = tenantsQuery.data ?? [];
  const hasFilters = Boolean(debouncedQ || effectiveStatus);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tenants"
        description={`Every ${BRAND.name} workspace, its plan, status and live usage.`}
        actions={
          canWrite ? (
            <Button onClick={() => setOnboardOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              Onboard Tenant
            </Button>
          ) : null
        }
      />

      {/* Filters */}
      <div className="reveal flex flex-wrap items-center gap-2" style={{ animationDelay: "60ms" }}>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or slug..."
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {formatNumber(tenants.length)} {tenants.length === 1 ? "tenant" : "tenants"}
        </span>
      </div>

      {/* Table */}
      <div className="reveal rounded-lg border bg-card" style={{ animationDelay: "120ms" }}>
        {tenantsQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={hasFilters ? "No tenants match" : "No tenants yet"}
            description={
              hasFilters
                ? "Try a different search or clear the status filter."
                : "Onboard your first tenant to provision a workspace, plan snapshot and admin account."
            }
            action={
              canWrite && !hasFilters ? (
                <Button onClick={() => setOnboardOpen(true)} className="gap-1.5">
                  <Plus className="size-4" />
                  Onboard Tenant
                </Button>
              ) : undefined
            }
            className="border-0"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice Setup</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow
                  key={tenant.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/tenants/${tenant.id}`)}
                >
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <span
                        className="size-2.5 shrink-0 rounded-full border border-white/20"
                        style={{ backgroundColor: tenant.brand_color || "#0a66c2" }}
                      />
                      <span className="font-medium">{tenant.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {tenant.slug}
                  </TableCell>
                  <TableCell>
                    {tenant.plan_key ? (
                      <Badge variant="brand" className="font-mono text-[11px]">
                        {tenant.plan_key}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">none</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={tenant.status} />
                  </TableCell>
                  <TableCell>
                    {tenant.billing_verified ? (
                      <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[11px] py-0 px-2">
                        ✓ Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 font-medium text-[11px] py-0 px-2">
                        ⏳ Pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(tenant.usage.users)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(tenant.usage.leads)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(tenant.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <OnboardTenantDialog
        open={onboardOpen}
        onOpenChange={setOnboardOpen}
        plans={plansQuery.data ?? []}
      />
    </div>
  );
}
