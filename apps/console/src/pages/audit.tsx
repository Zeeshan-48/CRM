import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ScrollText, Search } from "lucide-react";
import * as React from "react";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { listAudit } from "@/lib/api/audit";
import { listTenants } from "@/lib/api/tenants";
import { useDebouncedValue } from "@/lib/hooks";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import type { AuditRow } from "@/types";

const ALL_TENANTS = "__ALL__";

const CATEGORY_STYLES: Record<string, string> = {
  auth: "text-success",
  tenants: "text-brand",
  plans: "text-info",
  operators: "text-warning",
};

function AuditEntry({ row, tenantName }: { row: AuditRow; tenantName?: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const hasMetadata = row.metadata && Object.keys(row.metadata).length > 0;

  return (
    <li className="px-4 py-3 transition-colors duration-120 hover:bg-muted/40 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-muted-foreground">
          <ScrollText className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">{row.summary}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span
              className={`inline-flex items-center font-medium ${
                CATEGORY_STYLES[row.category] ?? "text-muted-foreground"
              }`}
            >
              {row.category}
            </span>
            <span className="font-mono text-[11px]">{row.action}</span>
            {row.actor_email ? (
              <>
                <span>&middot;</span>
                <span>{row.actor_email}</span>
              </>
            ) : null}
            {tenantName ? (
              <>
                <span>&middot;</span>
                <span>{tenantName}</span>
              </>
            ) : null}
            <span>&middot;</span>
            <span title={formatDateTime(row.created_at)}>{timeAgo(row.created_at)}</span>
            {hasMetadata ? (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
              >
                {expanded ? (
                  <>
                    Hide metadata
                    <ChevronUp className="size-3" />
                  </>
                ) : (
                  <>
                    Metadata
                    <ChevronDown className="size-3" />
                  </>
                )}
              </button>
            ) : null}
          </div>
          {expanded && hasMetadata ? (
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function AuditPage() {
  const [action, setAction] = React.useState("");
  const [tenantId, setTenantId] = React.useState<string>(ALL_TENANTS);

  const debouncedAction = useDebouncedValue(action.trim());
  const effectiveTenantId = tenantId === ALL_TENANTS ? "" : tenantId;

  const auditQuery = useQuery({
    queryKey: ["audit", debouncedAction, effectiveTenantId],
    queryFn: () =>
      listAudit({
        ...(debouncedAction ? { action: debouncedAction } : {}),
        ...(effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
      }),
    placeholderData: (previous) => previous,
  });

  const tenantsQuery = useQuery({
    queryKey: ["tenants", "", ""],
    queryFn: () => listTenants(),
    staleTime: 5 * 60_000,
  });

  const rows = auditQuery.data ?? [];
  const tenants = tenantsQuery.data ?? [];
  const tenantNameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const hasFilters = Boolean(debouncedAction || effectiveTenantId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit"
        description="The last 200 operator actions: onboarding, plan changes, suspensions and entitlement overrides."
      />

      {/* Filters */}
      <div className="reveal flex flex-wrap items-center gap-2" style={{ animationDelay: "60ms" }}>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 font-mono text-xs"
            placeholder="Filter by action, e.g. tenant.created"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </div>
        <Select value={tenantId} onValueChange={setTenantId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All tenants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TENANTS}>All tenants</SelectItem>
            {tenants.map((tenant) => (
              <SelectItem key={tenant.id} value={tenant.id}>
                {tenant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {formatNumber(rows.length)} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {/* Feed */}
      <div className="reveal rounded-lg border bg-card" style={{ animationDelay: "120ms" }}>
        {auditQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={hasFilters ? "No matching entries" : "No audit entries yet"}
            description={
              hasFilters
                ? "Try a different action filter or pick another tenant."
                : "Operator actions will appear here as they happen."
            }
            className="border-0"
          />
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <AuditEntry
                key={row.id}
                row={row}
                tenantName={row.tenant_id ? tenantNameById.get(row.tenant_id) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
