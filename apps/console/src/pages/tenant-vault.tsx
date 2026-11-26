import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Building2,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FileText,
  Headphones,
  Loader2,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Mp3DownloadButton } from "@/components/tenants/Mp3DownloadButton";
import { RoleDetailsDialog, type VaultRoleRecord } from "@/components/vault/RoleDetailsDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTenants } from "@/lib/api/tenants";
import {
  getVaultData,
  getVaultSummary,
  purgeVaultItem,
  restoreVaultItem,
} from "@/lib/api/vault";
import { formatDate, formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const ALL_TENANTS = "__ALL__";

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function describeVaultCallStatus(status?: string | null): {
  label: string;
  variant: "secondary" | "destructive" | "outline";
  className?: string;
} {
  const s = (status || "queued").toLowerCase();
  if (s === "completed") {
    return {
      label: "Completed",
      variant: "secondary",
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    };
  }
  if (s === "failed") {
    return { label: "Failed", variant: "destructive" };
  }
  if (s === "no-answer") {
    return {
      label: "No Answer",
      variant: "outline",
      className: "border-amber-400/50 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }
  if (s === "busy") {
    return {
      label: "Busy",
      variant: "outline",
      className: "border-amber-400/50 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }
  if (s === "canceled") {
    return { label: "Canceled", variant: "secondary" };
  }
  if (s === "in-progress") {
    return {
      label: "In Progress",
      variant: "outline",
      className: "border-sky-400/50 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    };
  }
  if (s === "ringing" || s === "initiated") {
    return {
      label: "Ringing",
      variant: "outline",
      className: "border-sky-400/50 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    };
  }
  return { label: "Queued", variant: "outline" };
}

type EntityKey =
  | "leads"
  | "contacts"
  | "deals"
  | "accounts"
  | "contracts"
  | "invoices"
  | "roles"
  | "recordings";

interface EntityTabDef {
  key: EntityKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ENTITY_TABS: EntityTabDef[] = [
  { key: "leads", label: "Leads", icon: Users },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "deals", label: "Deals", icon: FileSpreadsheet },
  { key: "accounts", label: "Accounts", icon: Building2 },
  { key: "contracts", label: "Contracts", icon: FileText },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "roles", label: "Roles", icon: Shield },
  { key: "recordings", label: "Call Recordings", icon: Headphones },
];

export default function TenantVaultPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const activeTenantId = searchParams.get("tenantId") || ALL_TENANTS;
  const [entity, setEntity] = React.useState<EntityKey>("leads");
  const [filter, setFilter] = React.useState<"all" | "active" | "deleted">("all");
  const [searchTerm, setSearchTerm] = React.useState("");
  const debouncedSearch = useDebouncedValue(searchTerm, 300);

  // Dialog state for permanent purge confirmation
  const [purgeTarget, setPurgeTarget] = React.useState<{
    tenantId: string;
    entity: string;
    id: string;
    label: string;
  } | null>(null);
  const [roleDetail, setRoleDetail] = React.useState<{
    role: VaultRoleRecord;
    tenantName: string;
  } | null>(null);

  // Tenants list
  const tenantsQuery = useQuery({
    queryKey: ["tenants", "list"],
    queryFn: () => listTenants(),
  });

  const tenants = tenantsQuery.data ?? [];
  const tenantMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tenantsQuery.data ?? []) {
      map.set(t.id, t.name);
    }
    return map;
  }, [tenantsQuery.data]);

  const selectedTenantId = activeTenantId === ALL_TENANTS ? undefined : activeTenantId;

  // Vault summary statistics
  const summaryQuery = useQuery({
    queryKey: ["vault", "summary", selectedTenantId],
    queryFn: () => getVaultSummary(selectedTenantId),
    refetchInterval: 10000,
  });

  // Vault entity table data
  const dataQuery = useQuery({
    queryKey: ["vault", "data", selectedTenantId, entity, filter, debouncedSearch],
    queryFn: () =>
      getVaultData({
        tenantId: selectedTenantId,
        entity,
        filter,
        q: debouncedSearch.trim() || undefined,
        limit: 100,
      }),
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: restoreVaultItem,
    onSuccess: (res) => {
      toast.success(res.message || "Record restored successfully to tenant");
      queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err.message || "Failed to restore record");
    },
  });

  // Purge mutation
  const purgeMutation = useMutation({
    mutationFn: purgeVaultItem,
    onSuccess: (res) => {
      toast.success(res.message || "Record permanently deleted");
      setPurgeTarget(null);
      queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err.message || "Failed to purge record");
    },
  });

  const handleTenantChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === ALL_TENANTS) {
      next.delete("tenantId");
    } else {
      next.set("tenantId", value);
    }
    setSearchParams(next, { replace: true });
  };

  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Centralized Tenant Data Vault"
        description="Unified Super Admin repository for all tenant data, live records, custom roles, and soft-deleted recovery."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Select value={activeTenantId} onValueChange={handleTenantChange}>
              <SelectTrigger className="w-[240px] bg-background">
                <Building2 className="mr-2 size-4 text-muted-foreground" />
                <SelectValue placeholder="All Tenants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TENANTS}>All Tenants (Global)</SelectItem>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["vault"] });
                toast.info("Refreshed vault data");
              }}
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" />
              Sync
            </Button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard
          label="Leads"
          value={
            summary ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.leads.total}
                {summary.leads.deleted > 0 && (
                  <span className="text-xs font-normal text-rose-500">
                    ({summary.leads.deleted} in vault)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.leads.active} active
              </span>
            ) : null
          }
          icon={Users}
        />
        <StatCard
          label="Contacts"
          value={
            summary ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.contacts.total}
                {summary.contacts.deleted > 0 && (
                  <span className="text-xs font-normal text-rose-500">
                    ({summary.contacts.deleted} in vault)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.contacts.active} active
              </span>
            ) : null
          }
          icon={Users}
        />
        <StatCard
          label="Deals"
          value={
            summary ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.deals.total}
                {summary.deals.deleted > 0 && (
                  <span className="text-xs font-normal text-rose-500">
                    ({summary.deals.deleted} in vault)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.deals.active} active
              </span>
            ) : null
          }
          icon={FileSpreadsheet}
        />
        <StatCard
          label="Accounts"
          value={
            summary ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.accounts.total}
                {summary.accounts.deleted > 0 && (
                  <span className="text-xs font-normal text-rose-500">
                    ({summary.accounts.deleted} in vault)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.accounts.active} active
              </span>
            ) : null
          }
          icon={Building2}
        />
        <StatCard
          label="Contracts"
          value={
            summary ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.contracts.total}
                {summary.contracts.deleted > 0 && (
                  <span className="text-xs font-normal text-rose-500">
                    ({summary.contracts.deleted} in vault)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.contracts.active} active
              </span>
            ) : null
          }
          icon={FileText}
        />
        <StatCard
          label="Invoices"
          value={
            summary ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.invoices.total}
                {summary.invoices.deleted > 0 && (
                  <span className="text-xs font-normal text-rose-500">
                    ({summary.invoices.deleted} in vault)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.invoices.active} active
              </span>
            ) : null
          }
          icon={FileText}
        />
        <StatCard
          label="Roles"
          value={
            summary ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.roles.total}
                {summary.roles.deleted > 0 && (
                  <span className="text-xs font-normal text-rose-500">
                    ({summary.roles.deleted} in vault)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.roles.active} active
              </span>
            ) : null
          }
          icon={Shield}
        />
        <StatCard
          label="Call Recordings"
          value={
            summary?.recordings ? (
              <span className="flex items-baseline gap-1.5 text-xl font-bold">
                {summary.recordings.total}
                {summary.recordings.withAudio > 0 && (
                  <span className="text-xs font-normal text-emerald-500">
                    ({summary.recordings.withAudio} audio)
                  </span>
                )}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            summary?.recordings ? (
              <span className="text-[11px] text-muted-foreground">
                {Math.round(summary.recordings.totalDurationSec / 60)} mins audio
              </span>
            ) : null
          }
          icon={Headphones}
        />
      </div>

      {/* Entity Selection Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-2">
        {ENTITY_TABS.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = entity === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setEntity(tab.key);
                setSearchTerm("");
              }}
              className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-all ${
                isActive
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <TabIcon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 rounded-lg border bg-muted/40 p-1">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "ghost"}
            className="h-8 text-xs font-medium"
            onClick={() => setFilter("all")}
          >
            {entity === "recordings" ? "All Calls" : "All Records"}
          </Button>
          <Button
            size="sm"
            variant={filter === "active" ? "default" : "ghost"}
            className="h-8 text-xs font-medium"
            onClick={() => setFilter("active")}
          >
            {entity === "recordings" ? "With Audio Recording" : "Active Only"}
          </Button>
          <Button
            size="sm"
            variant={filter === "deleted" ? (entity === "recordings" ? "default" : "destructive") : "ghost"}
            className="h-8 gap-1.5 text-xs font-medium"
            onClick={() => setFilter("deleted")}
          >
            {entity === "recordings" ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
            {entity === "recordings" ? "Completed Calls" : "Deleted / Vault"}
          </Button>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={
              entity === "recordings"
                ? "Search by phone, lead, contact, agent, or tenant..."
                : `Search ${entity}...`
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 pl-9 text-sm"
          />
        </div>
      </div>

      {/* Main Data Table */}
      <Card>
        <CardContent className="p-0">
          {dataQuery.isLoading ? (
            <div className="p-8 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : dataQuery.isError ? (
            <div className="p-8 text-center text-sm text-destructive">
              Failed to load vault records: {(dataQuery.error as any)?.message}
            </div>
          ) : !dataQuery.data?.items?.length ? (
            <div className="py-12">
              <EmptyState
                icon={entity === "recordings" ? Headphones : Archive}
                title={entity === "recordings" ? "No call records found" : "No records found"}
                description={
                  entity === "recordings"
                    ? filter === "deleted"
                      ? "No completed calls found."
                      : filter === "active"
                      ? "No calls with audio recordings found."
                      : "No call records found matching current criteria."
                    : filter === "deleted"
                    ? `No deleted ${entity} found in the Vault for this view.`
                    : entity === "roles"
                    ? "No custom roles created by this tenant yet. Standard built-in roles (ADMIN, MANAGER, SALES_AGENT, etc.) are active. When tenant admin creates custom roles in Users & Roles, they will appear here in real-time."
                    : `No ${entity} matching the current filters.`
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Tenant</TableHead>
                    {renderEntityHeaders(entity)}
                    <TableHead className="whitespace-nowrap">
                      {entity === "recordings" ? "Call Status" : "Lifecycle Status"}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {entity === "recordings" ? "Call Time" : "Created"}
                    </TableHead>
                    <TableHead className="whitespace-nowrap text-right">Vault Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataQuery.data.items.map((row: any) => {
                    const isDeleted = Boolean(row.deleted_at);
                    const tenantName =
                      row.tenant_name || tenantMap.get(row.tenant_id) || row.tenant_id;

                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          isDeleted ? "bg-rose-50/40 dark:bg-rose-950/20" : undefined,
                          entity === "roles" && "cursor-pointer hover:bg-muted/40"
                        )}
                        onClick={
                          entity === "roles"
                            ? () => setRoleDetail({ role: row as VaultRoleRecord, tenantName })
                            : undefined
                        }
                      >
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-col">
                            <span
                              className="max-w-[180px] truncate font-semibold text-xs text-foreground"
                              title={tenantName}
                            >
                              {tenantName}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {row.tenant_id}
                            </span>
                          </div>
                        </TableCell>

                        {renderEntityCells(entity, row, {
                          onInspectRole: (r) =>
                            setRoleDetail({ role: r as VaultRoleRecord, tenantName }),
                        })}

                        <TableCell className="whitespace-nowrap">
                          {entity === "recordings" ? (
                            (() => {
                              const cs = describeVaultCallStatus(row.call_status);
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <Badge
                                    variant={cs.variant}
                                    className={cn("w-fit text-[11px]", cs.className)}
                                  >
                                    {cs.label}
                                  </Badge>
                                  {row.call_error ? (
                                    <span
                                      className="max-w-[160px] truncate text-[10px] text-destructive"
                                      title={row.call_error}
                                    >
                                      {row.call_error}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })()
                          ) : isDeleted ? (
                            <div className="flex flex-col gap-1">
                              <Badge variant="destructive" className="w-fit text-[11px]">
                                DELETED (VAULT)
                              </Badge>
                              <span className="text-[11px] text-muted-foreground" title={formatDateTime(row.deleted_at)}>
                                {timeAgo(row.deleted_at)}
                              </span>
                              {row.deleted_by && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  by {row.deleted_by}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                              <Badge variant="secondary" className="text-[11px]">
                                ACTIVE
                              </Badge>
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {entity === "recordings"
                            ? formatDateTime(row.created_at)
                            : row.builtin
                            ? "System Default"
                            : formatDate(row.created_at)}
                        </TableCell>

                        <TableCell
                          className="whitespace-nowrap text-right"
                          onClick={(e) => {
                            if (entity === "roles") e.stopPropagation();
                          }}
                        >
                          {entity === "recordings" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              title="Permanently Purge Call Record"
                              onClick={() =>
                                setPurgeTarget({
                                  tenantId: row.tenant_id,
                                  entity: "recordings",
                                  id: row.id,
                                  label: `Call ${row.from_number} → ${row.to_number} (${formatDuration(row.duration_sec)})`,
                                })
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : isDeleted ? (
                            <div className="flex items-center justify-end gap-1.5">
                              {entity === "roles" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    setRoleDetail({ role: row as VaultRoleRecord, tenantName })
                                  }
                                >
                                  <Eye className="size-3.5" />
                                  View
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-500/30 dark:hover:bg-emerald-950/40"
                                disabled={restoreMutation.isPending}
                                onClick={() =>
                                  restoreMutation.mutate({
                                    tenantId: row.tenant_id,
                                    entity,
                                    id: row.id,
                                  })
                                }
                              >
                                {restoreMutation.isPending ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="size-3" />
                                )}
                                Restore
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                title="Permanently Purge"
                                onClick={() =>
                                  setPurgeTarget({
                                    tenantId: row.tenant_id,
                                    entity,
                                    id: row.id,
                                    label: row.name || row.title || row.number || row.key || row.id,
                                  })
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ) : entity === "roles" ? (
                            <div className="inline-flex items-center justify-end gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {row.builtin ? "System Built-in" : "Tenant Managed"}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={() =>
                                  setRoleDetail({ role: row as VaultRoleRecord, tenantName })
                                }
                              >
                                <Eye className="size-3.5" />
                                Details
                              </Button>
                            </div>
                          ) : row.builtin ? (
                            <span className="text-xs text-muted-foreground font-mono">
                              System Built-in
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground font-mono">
                              Managed by Tenant
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Role Details Dialog (Members & Permissions) */}
      <RoleDetailsDialog
        open={Boolean(roleDetail)}
        onOpenChange={(open) => !open && setRoleDetail(null)}
        role={roleDetail?.role ?? null}
        tenantName={roleDetail?.tenantName ?? ""}
      />

      {/* Purge Confirmation Dialog */}
      <Dialog open={Boolean(purgeTarget)} onOpenChange={(open) => !open && setPurgeTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="size-5" />
              Permanently Purge Record
            </DialogTitle>
            <DialogDescription>
              This action is <strong className="text-foreground">irreversible</strong>. The record{" "}
              <strong className="text-foreground">"{purgeTarget?.label}"</strong> will be permanently
              wiped from the database and will no longer be recoverable from the Super Admin Vault.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              onClick={() => setPurgeTarget(null)}
              disabled={purgeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={purgeMutation.isPending}
              onClick={() => {
                if (purgeTarget) {
                  purgeMutation.mutate({
                    tenantId: purgeTarget.tenantId,
                    entity: purgeTarget.entity,
                    id: purgeTarget.id,
                  });
                }
              }}
            >
              {purgeMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Confirm Permanent Purge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderEntityHeaders(entity: EntityKey) {
  switch (entity) {
    case "leads":
      return (
        <>
          <TableHead>Lead Name</TableHead>
          <TableHead>Contact Info</TableHead>
          <TableHead>Status / Score</TableHead>
        </>
      );
    case "contacts":
      return (
        <>
          <TableHead>Contact Name</TableHead>
          <TableHead>Email & Phone</TableHead>
          <TableHead>Company / Title</TableHead>
        </>
      );
    case "deals":
      return (
        <>
          <TableHead>Deal Title</TableHead>
          <TableHead>Value (INR)</TableHead>
          <TableHead>Status</TableHead>
        </>
      );
    case "accounts":
      return (
        <>
          <TableHead>Account Name</TableHead>
          <TableHead>Project Name</TableHead>
          <TableHead>Contact & City</TableHead>
        </>
      );
    case "contracts":
      return (
        <>
          <TableHead>Contract Title</TableHead>
          <TableHead>Value / Billing</TableHead>
          <TableHead>Status</TableHead>
        </>
      );
    case "invoices":
      return (
        <>
          <TableHead>Invoice #</TableHead>
          <TableHead>Amount & Tax</TableHead>
          <TableHead>Status</TableHead>
        </>
      );
    case "roles":
      return (
        <>
          <TableHead className="min-w-[200px]">Role</TableHead>
          <TableHead className="min-w-[210px]">Assigned Members</TableHead>
          <TableHead className="min-w-[240px]">Permissions / Modules</TableHead>
        </>
      );
    case "recordings":
      return (
        <>
          <TableHead>Agent / User</TableHead>
          <TableHead>Call Details</TableHead>
          <TableHead>Lead / Contact</TableHead>
          <TableHead>Duration & Provider</TableHead>
          <TableHead className="min-w-[280px]">Audio Recording</TableHead>
        </>
      );
  }
}

function renderEntityCells(
  entity: EntityKey,
  row: any,
  opts?: { onInspectRole?: (row: any) => void }
) {
  switch (entity) {
    case "leads":
      return (
        <>
          <TableCell>
            <div className="font-medium text-sm text-foreground">
              {row.name || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "—"}
            </div>
            {(row.company || row.company_name || row.source) && (
              <div className="text-xs text-muted-foreground">{row.company || row.company_name || row.source}</div>
            )}
          </TableCell>
          <TableCell>
            <div className="text-xs">{row.email || "—"}</div>
            <div className="text-xs text-muted-foreground">{row.phone || "—"}</div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px]">
                {row.status}
              </Badge>
              {row.score_total != null && row.score_total > 0 && (
                <span className="text-xs font-semibold tabular-nums text-brand">
                  Score: {row.score_total}
                </span>
              )}
            </div>
          </TableCell>
        </>
      );

    case "contacts":
      return (
        <>
          <TableCell>
            <div className="font-medium text-sm text-foreground">
              {row.name || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "—"}
            </div>
            {row.company && (
              <div className="text-xs text-muted-foreground">{row.company}</div>
            )}
          </TableCell>
          <TableCell>
            <div className="text-xs">{row.email || "—"}</div>
            <div className="text-xs text-muted-foreground">{row.phone || "—"}</div>
          </TableCell>
          <TableCell>
            <div className="text-xs">{row.title || row.lifecycle || "—"}</div>
          </TableCell>
        </>
      );

    case "deals":
      return (
        <>
          <TableCell>
            <div className="font-medium text-sm text-foreground">{row.title}</div>
          </TableCell>
          <TableCell>
            <div className="font-semibold text-sm tabular-nums">
              ₹{formatNumber(row.value ?? 0)}
            </div>
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="text-[11px]">
              {row.status}
            </Badge>
          </TableCell>
        </>
      );

    case "accounts":
      return (
        <>
          <TableCell>
            <div className="font-medium text-sm text-foreground">{row.name}</div>
            {row.website && (
              <div className="text-xs text-muted-foreground">{row.website}</div>
            )}
          </TableCell>
          <TableCell>
            <div className="text-xs font-medium text-foreground">
              {row.project_name || "—"}
            </div>
          </TableCell>
          <TableCell>
            <div className="text-xs">{row.city || row.state || "—"}</div>
            <div className="text-xs text-muted-foreground">{row.phone || row.email || ""}</div>
          </TableCell>
        </>
      );

    case "contracts":
      return (
        <>
          <TableCell>
            <div className="font-medium text-sm text-foreground">{row.title}</div>
          </TableCell>
          <TableCell>
            <div className="font-semibold text-sm tabular-nums">
              ₹{formatNumber(row.value ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">{row.billing_type || "ONE_TIME"}</div>
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="text-[11px]">
              {row.status}
            </Badge>
          </TableCell>
        </>
      );

    case "invoices":
      return (
        <>
          <TableCell>
            <div className="font-mono text-sm font-semibold">{row.number}</div>
          </TableCell>
          <TableCell>
            <div className="font-semibold text-sm tabular-nums">
              ₹{formatNumber(row.amount ?? 0)}
            </div>
            {row.tax > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Tax: ₹{formatNumber(row.tax)}
              </div>
            )}
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="text-[11px]">
              {row.status}
            </Badge>
          </TableCell>
        </>
      );

    case "roles": {
      const perms = Array.isArray(row.permissions) ? row.permissions : [];
      const members = Array.isArray(row.members) ? row.members : [];
      const memberCount = row.member_count ?? members.length;
      const firstMember = members[0];
      const extraMembers = Math.max(0, memberCount - 1);
      const previewPerms = perms.slice(0, 3);
      const extraPerms = Math.max(0, perms.length - previewPerms.length);
      const inspectRole = (e: React.MouseEvent) => {
        e.stopPropagation();
        opts?.onInspectRole?.(row);
      };

      return (
        <>
          {/* Merged compact Role Identity column */}
          <TableCell className="align-middle">
            <div className="flex flex-col gap-0.5 max-w-[240px]">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={inspectRole}
                  className="truncate text-left text-sm font-semibold text-foreground hover:text-brand hover:underline"
                  title={row.description ? `${row.name} — ${row.description}` : row.name}
                >
                  {row.name}
                </button>
                <Badge
                  variant={row.builtin ? "secondary" : "outline"}
                  className="shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px]"
                >
                  {row.builtin ? "Built-in" : "Custom"}
                </Badge>
              </div>
              <span className="truncate font-mono text-[11px] text-brand">{row.key}</span>
            </div>
          </TableCell>

          {/* Compact fixed-height Assigned Members column */}
          <TableCell className="align-middle">
            {members.length > 0 && firstMember ? (
              <div className="flex items-center justify-between gap-2 max-w-[260px]">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {firstMember.name || "Unnamed user"}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {firstMember.email}
                  </p>
                </div>
                {extraMembers > 0 ? (
                  <button
                    type="button"
                    onClick={inspectRole}
                    className="shrink-0 whitespace-nowrap rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand/15"
                  >
                    +{extraMembers} more
                  </button>
                ) : null}
              </div>
            ) : memberCount > 0 ? (
              <button
                type="button"
                onClick={inspectRole}
                className="whitespace-nowrap rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/15"
              >
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </button>
            ) : (
              <span className="whitespace-nowrap text-xs text-muted-foreground italic">
                0 members
              </span>
            )}
          </TableCell>

          {/* Horizontal fixed-height Permissions / Modules column */}
          <TableCell className="align-middle">
            <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
              {perms.includes("*") ? (
                <Badge variant="brand" className="px-2 py-0.5 text-[10px] font-medium">
                  All Modules (*)
                </Badge>
              ) : perms.length > 0 ? (
                <>
                  {previewPerms.map((p: string) => (
                    <Badge
                      key={p}
                      variant="secondary"
                      className="px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {p}
                    </Badge>
                  ))}
                  {extraPerms > 0 ? (
                    <button
                      type="button"
                      onClick={inspectRole}
                      className="shrink-0 whitespace-nowrap rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand transition-colors hover:bg-brand/15"
                    >
                      +{extraPerms} more
                    </button>
                  ) : null}
                </>
              ) : (
                <span className="text-xs text-muted-foreground italic">No modules</span>
              )}
            </div>
          </TableCell>
        </>
      );
    }

    case "recordings":
      return (
        <>
          <TableCell>
            <div className="flex flex-col">
              <span className="font-semibold text-xs text-foreground">
                {row.agent_name || "System / Unassigned"}
              </span>
              {row.agent_email && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {row.agent_email}
                </span>
              )}
            </div>
          </TableCell>
          <TableCell>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                {row.direction === "INBOUND" ? (
                  <Badge variant="outline" className="text-[10px] gap-1 text-sky-600 dark:text-sky-400 border-sky-300">
                    <PhoneIncoming className="size-3" />
                    INBOUND
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] gap-1 text-indigo-600 dark:text-indigo-400 border-indigo-300">
                    <PhoneOutgoing className="size-3" />
                    OUTBOUND
                  </Badge>
                )}
              </div>
              <div className="text-xs font-mono text-foreground">
                {row.from_number} <span className="text-muted-foreground">→</span> {row.to_number}
              </div>
            </div>
          </TableCell>
          <TableCell>
            {row.lead_name ? (
              <div className="flex flex-col">
                <span className="text-xs font-medium text-foreground">{row.lead_name}</span>
                <Badge variant="secondary" className="w-fit text-[9px] px-1 py-0 mt-0.5">
                  Lead
                </Badge>
              </div>
            ) : row.contact_name ? (
              <div className="flex flex-col">
                <span className="text-xs font-medium text-foreground">{row.contact_name}</span>
                <Badge variant="secondary" className="w-fit text-[9px] px-1 py-0 mt-0.5">
                  Contact
                </Badge>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground italic">—</span>
            )}
          </TableCell>
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {formatDuration(row.duration_sec)}
              </span>
              {row.provider && (
                <Badge variant="outline" className="w-fit text-[9px] font-mono uppercase px-1 py-0">
                  {row.provider}
                </Badge>
              )}
            </div>
          </TableCell>
          <TableCell>
            {row.audio_url ? (
              <div className="flex items-center gap-2 py-1">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  controls
                  preload="none"
                  src={row.audio_url}
                  className="h-8 w-52 sm:w-60 accent-brand rounded"
                />
                <Mp3DownloadButton url={row.audio_url} filename={`recording-${row.id}.mp3`} />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground italic flex items-center gap-1">
                <PhoneOff className="size-3.5" />
                No audio recorded
              </span>
            )}
          </TableCell>
        </>
      );
  }
}
