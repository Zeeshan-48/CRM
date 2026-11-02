import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileSearch,
  Fingerprint,
  Globe2,
  ScrollText,
  Server,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCompliance, listAuditLogs } from "@/lib/api/audit";
import { formatDateTime, formatNumber, initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ENTITY_TYPES = ["lead", "deal", "ticket", "user", "tenant"] as const;

const STICKY_HEAD = "sticky top-0 z-10 bg-card";

/** Category tint for the action dot, inferred from the action verb. */
function actionTone(action: string): { dot: string; label: string } {
  const a = action.toLowerCase();
  if (/(create|add|invite|sent|login|enable|grant)/.test(a))
    return { dot: "bg-success", label: "text-success" };
  if (/(update|edit|change|assign|move|renew)/.test(a))
    return { dot: "bg-info", label: "text-info" };
  if (/(delete|remove|revoke|disable|fail|logout|cancel)/.test(a))
    return { dot: "bg-danger", label: "text-danger" };
  return { dot: "bg-brand", label: "text-brand" };
}

/** Badge tone for a compliance status string. */
function statusVariant(
  status: string,
): "success" | "warning" | "neutral" {
  const s = status.toLowerCase();
  if (/(certified|compliant|passed|active|enabled|ready)/.test(s))
    return "success";
  if (/(progress|pending|review|planned|scheduled)/.test(s)) return "warning";
  return "neutral";
}

function ComplianceCard({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 transition-shadow">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            tone,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export default function AuditPage() {
  const [actionInput, setActionInput] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState("");
  const [entityType, setEntityType] = React.useState("all");

  // Debounce the action text input; the backend matches actions exactly.
  React.useEffect(() => {
    const handle = window.setTimeout(
      () => setActionFilter(actionInput.trim()),
      400,
    );
    return () => window.clearTimeout(handle);
  }, [actionInput]);

  const logsQuery = useQuery({
    queryKey: ["audit", actionFilter, entityType],
    queryFn: () =>
      listAuditLogs({
        action: actionFilter || undefined,
        entityType: entityType === "all" ? undefined : entityType,
      }),
    placeholderData: (previous) => previous,
  });

  const complianceQuery = useQuery({
    queryKey: ["audit-compliance"],
    queryFn: getCompliance,
  });

  const logs = logsQuery.data ?? [];
  const compliance = complianceQuery.data;
  const hasFilters = Boolean(actionFilter) || entityType !== "all";

  const clearFilters = () => {
    setActionInput("");
    setActionFilter("");
    setEntityType("all");
  };

  return (
    <div className="flex flex-col gap-5 lg:h-[calc(100vh-6.5rem)]">
      <PageHeader
        title="Audit & Compliance"
        description="Every action, logged and reviewable."
      />

      {/* Compliance posture */}
      <section
        className="reveal grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
        style={{ animationDelay: "60ms" }}
      >
        {complianceQuery.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))
        ) : compliance ? (
          <>
            <ComplianceCard
              icon={Globe2}
              label="GDPR"
              tone="bg-blue-500/10 text-blue-600 dark:text-blue-400"
            >
              <p className="font-display text-lg font-semibold tracking-tight">
                {compliance.gdpr.enabled ? "Enabled" : "Off"}
              </p>
              <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                {compliance.gdpr.dataRetentionDays}-day retention
              </p>
              {compliance.gdpr.rightToErasure ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 className="size-3.5" />
                  Right to erasure
                </p>
              ) : null}
            </ComplianceCard>

            <ComplianceCard
              icon={ShieldCheck}
              label="SOC 2"
              tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              <p className="font-display text-lg font-semibold tracking-tight">
                {compliance.soc2.status}
              </p>
              <Badge
                variant={statusVariant(compliance.soc2.status)}
                className="mt-2"
              >
                {statusVariant(compliance.soc2.status) === "success"
                  ? "Compliant"
                  : "Tracked"}
              </Badge>
            </ComplianceCard>

            <ComplianceCard
              icon={ShieldCheck}
              label="ISO 27001"
              tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            >
              <p className="font-display text-lg font-semibold tracking-tight">
                {compliance.iso27001.status}
              </p>
              <Badge
                variant={statusVariant(compliance.iso27001.status)}
                className="mt-2"
              >
                {statusVariant(compliance.iso27001.status) === "success"
                  ? "Compliant"
                  : "Tracked"}
              </Badge>
            </ComplianceCard>

            <ComplianceCard
              icon={Fingerprint}
              label="Sign-in"
              tone="bg-amber-500/10 text-amber-700 dark:text-amber-400"
            >
              <div className="flex flex-wrap gap-1">
                {compliance.security.sso.length > 0 ? (
                  compliance.security.sso.map((provider) => (
                    <span
                      key={provider}
                      className="inline-flex items-center text-xs font-medium text-brand"
                    >
                      {provider}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Password only
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {[
                  compliance.security.mfa ? "MFA" : null,
                  compliance.security.deviceControl ? "Device control" : null,
                  compliance.security.ipRestrictions ? "IP allowlist" : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No extra controls"}
              </p>
            </ComplianceCard>

            <ComplianceCard
              icon={ScrollText}
              label="Audit events"
              tone="bg-sky-500/10 text-sky-600 dark:text-sky-400"
            >
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                {formatNumber(compliance.auditEvents)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                recorded all-time
              </p>
            </ComplianceCard>
          </>
        ) : null}
      </section>

      {/* Filters + timeline */}
      <section
        className="reveal flex min-h-0 flex-1 flex-col"
        style={{ animationDelay: "140ms" }}
      >
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="shrink-0 gap-3 space-y-0 border-b sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              Activity log
              {!logsQuery.isLoading ? (
                <span className="text-xs font-medium text-muted-foreground">
                  {logs.length}
                </span>
              ) : null}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <FileSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  placeholder="Filter by action, e.g. user.created"
                  className="h-8 w-60 pl-8 text-xs"
                />
              </div>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="Entity type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All entities</SelectItem>
                  {ENTITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-muted-foreground"
                  onClick={clearFilters}
                >
                  <X className="size-3.5" />
                  Clear
                </Button>
              ) : null}
            </div>
          </CardHeader>

          {logsQuery.isLoading ? (
            <div className="min-h-0 flex-1 space-y-2 overflow-hidden p-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-5">
              <EmptyState
                icon={FileSearch}
                title={hasFilters ? "No matching events" : "No audit events yet"}
                description={
                  hasFilters
                    ? "Filters match exact values. Try clearing them or use a full action name like user.created."
                    : "Actions across the workspace will appear here as they happen."
                }
                className="border-0"
                action={
                  hasFilters ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full caption-bottom text-sm tabular-nums">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={STICKY_HEAD}>Action</TableHead>
                    <TableHead className={STICKY_HEAD}>Entity</TableHead>
                    <TableHead className={STICKY_HEAD}>Actor</TableHead>
                    <TableHead className={STICKY_HEAD}>Details</TableHead>
                    <TableHead className={cn(STICKY_HEAD, "text-right")}>
                      When
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const tone = actionTone(log.action);
                    const isSystem = log.user?.toLowerCase() === "system";
                    return (
                      <TableRow key={log.id} className="align-top">
                        <TableCell className="py-3">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                tone.dot,
                              )}
                            />
                            <span className="font-mono text-xs font-medium">
                              {log.action}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="py-3">
                          {log.entity_type ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="brand" className="w-fit">
                                {log.entity_type}
                              </Badge>
                              {log.entity_id ? (
                                <span
                                  className="max-w-32 truncate font-mono text-[11px] text-muted-foreground"
                                  title={log.entity_id}
                                >
                                  {log.entity_id}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              -
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                                isSystem
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-brand/10 text-brand",
                              )}
                            >
                              {isSystem ? (
                                <Server className="size-3" />
                              ) : (
                                initials(log.user)
                              )}
                            </span>
                            <span className="truncate text-sm">{log.user}</span>
                          </span>
                        </TableCell>
                        <TableCell className="py-3">
                          {log.meta !== null && log.meta !== undefined ? (
                            <details className="group">
                              <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand">
                                <span className="transition-transform group-open:rotate-90">
                                  ›
                                </span>
                                View
                              </summary>
                              <pre className="mt-1.5 max-h-44 max-w-80 overflow-auto rounded-md border bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed">
                                {JSON.stringify(log.meta, null, 2)}
                              </pre>
                            </details>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              -
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap py-3 text-right text-xs text-muted-foreground"
                          title={formatDateTime(log.created_at)}
                        >
                          {timeAgo(log.created_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
