import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import * as React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  assignLead,
  bulkLeadAction,
  createLead,
  downloadLeadsCsv,
  getLeadSources,
  getLeadTags,
  listLeads,
  updateLead,
  LEAD_GRADES,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type Lead,
  type LeadGrade,
  type SkippedImportRow,
} from "@/lib/api/leads";
import { LeadImportDialog } from "@/components/leads/LeadImportDialog";
import {
  downloadSkippedImportCsv,
  getLeadVerticalSubtitle,
  IMPORT_TYPE_LABELS,
} from "@/lib/lead-import";
import { getTenantMe } from "@/lib/api/tenant";
import { listUsers } from "@/lib/api/users";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";
import { usePersistentState } from "@/hooks/usePersistentState";
import { cn } from "@/lib/utils";
import type { LeadImportType } from "@/types";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResultDialog } from "@/components/ui/result-dialog";
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
import { Textarea } from "@/components/ui/textarea";

const ALL = "__all__";
// Sentinel understood by the leads list API to match leads with no owner.
const UNASSIGNED = "unassigned";
// Local sentinel: let the backend pick the owner via the workspace rule instead
// of assigning to a specific person.
const AUTO_ASSIGN = "__auto__";
const PAGE_SIZE = 15;
const EMPTY_IMPORT_TYPES: LeadImportType[] = [];

// Friendly labels for the workspace's default lead-assignment strategy.
const STRATEGY_LABELS: Record<string, string> = {
  ROUND_ROBIN: "round-robin",
  AI: "AI routing",
  SKILL_BASED: "skill match",
  TERRITORY_BASED: "territory",
  MANUAL: "manual",
};

// Reads tenants.config.leadAssignment.defaultStrategy, defaulting to MANUAL.
const readDefaultStrategy = (config: unknown): string => {
  const cfg =
    config && typeof config === "object"
      ? (config as Record<string, unknown>)
      : {};
  const la =
    cfg.leadAssignment && typeof cfg.leadAssignment === "object"
      ? (cfg.leadAssignment as Record<string, unknown>)
      : {};
  const value =
    typeof la.defaultStrategy === "string" ? la.defaultStrategy : "MANUAL";
  return value in STRATEGY_LABELS ? value : "MANUAL";
};

const GRADE_STYLES: Record<LeadGrade, string> = {
  HOT: "text-danger",
  WARM: "text-warning",
  COLD: "text-neutral",
};

const GRADE_CHIP_ACTIVE: Record<LeadGrade, string> = {
  HOT: "text-danger",
  WARM: "text-warning",
  COLD: "text-neutral",
};

const STATUS_STYLES: Record<string, string> = {
  NEW: "text-brand",
  ATTEMPTED: "text-warning",
  CONNECTED: "text-info",
  QUALIFIED: "text-success",
  NURTURE: "text-neutral",
  NOT_INTERESTED: "text-neutral",
  DISQUALIFIED: "text-danger",
  CONVERTED: "text-success",
};

interface Filters {
  q: string;
  source: string;
  tag: string;
  importType: string;
  status: string;
  owner: string;
  grade: string;
  // Relative date-range keys (see DATE_RANGES); "" means no date filter.
  createdRange: string;
  // "" | a DATE_RANGES key | "today" | "custom". When "custom", the concrete
  // window comes from activityFrom/activityTo (YYYY-MM-DD, either optional).
  activityRange: string;
  activityFrom: string;
  activityTo: string;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  source: "",
  tag: "",
  importType: "",
  status: "",
  owner: "",
  grade: "",
  createdRange: "",
  activityRange: "",
  activityFrom: "",
  activityTo: "",
};

// Relative date presets shared by the "Created" and "Last activity" filters.
// Each maps to a lookback window in days; the query converts it to an ISO
// cutoff at request time.
const DATE_RANGES: { value: string; label: string; days: number }[] = [
  { value: "1d", label: "Last 24 hours", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
];

// Turns a range key into an ISO cutoff instant, or undefined when unset/unknown.
const rangeToIso = (key: string): string | undefined => {
  const preset = DATE_RANGES.find((r) => r.value === key);
  if (!preset) return undefined;
  return new Date(Date.now() - preset.days * 86_400_000).toISOString();
};

// Resolves the "Last activity" filter into ISO from/to cutoffs. Handles the
// relative presets, "today" (since local midnight), and a "custom" date range
// where either bound may be left open. Local-day dates are widened to full-day
// bounds so the range is inclusive of the whole calendar day.
const activityCutoffs = (
  range: string,
  from: string,
  to: string,
): { from?: string; to?: string } => {
  if (range === "custom") {
    return {
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    };
  }
  if (range === "today") {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return { from: midnight.toISOString() };
  }
  return { from: rangeToIso(range) };
};

/**
 * Compact page-number window for the pager: always shows the first and last
 * page, the current page ±1, and "…" gaps between. e.g. 1 … 4 5 6 … 20.
 */
const pageWindow = (current: number, totalPages: number): (number | "…")[] => {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages - 1) pages.push("…");
  pages.push(totalPages);
  return pages;
};

function ScoreBadge({ grade, total }: { grade: LeadGrade; total: number }) {
  return (
    <Badge
      className={cn(
        "gap-1 tabular-nums",
        GRADE_STYLES[grade],
      )}
    >
      {grade}
      <span className="opacity-60">&middot;</span>
      {total}
    </Badge>
  );
}

export default function LeadsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- Filters ----
  // Persisted to sessionStorage so filters/search survive a round-trip to a
  // lead's detail page and back (restored regardless of how the user returns).
  const [search, setSearch] = usePersistentState("leads:search", "");
  // Seed the debounced value from the restored search so the first render is
  // already filtered (no unfiltered flash before the 300ms debounce fires).
  const [debouncedQ, setDebouncedQ] = React.useState(() => search.trim());
  const [filters, setFilters] = usePersistentState<Filters>(
    "leads:filters",
    EMPTY_FILTERS,
  );
  // Seed the page from the URL so returning from a lead's detail page (via the
  // back button) lands on the page the user left, not page 1.
  const [page, setPage] = React.useState(() => {
    const p = Math.floor(Number(searchParams.get("page")));
    return Number.isFinite(p) && p >= 1 ? p : 1;
  });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Keep the URL in sync with the current page (?page=N, omitted on page 1) so
  // the position survives navigation away and back, refresh, and deep links.
  React.useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (page > 1) next.set("page", String(page));
        else next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [page, setSearchParams]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset to page 1 whenever a filter/search actually changes, but never on the
  // initial mount (which must preserve the page restored from the URL) and never
  // on StrictMode's dev double-invoke. Keying off a signature of the filter
  // values (instead of a one-shot mount flag) makes both cases a no-op, because
  // the signature is unchanged; only a real filter change flips it.
  const filterSig = JSON.stringify([
    debouncedQ,
    filters.source,
    filters.tag,
    filters.importType,
    filters.status,
    filters.owner,
    filters.grade,
    filters.createdRange,
    filters.activityRange,
    filters.activityFrom,
    filters.activityTo,
  ]);
  const lastFilterSig = React.useRef(filterSig);
  React.useEffect(() => {
    if (lastFilterSig.current === filterSig) return;
    lastFilterSig.current = filterSig;
    setPage(1);
    setSelected(new Set());
  }, [filterSig]);

  const patchFilters = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const clearFilters = () => {
    setSearch("");
    setFilters(EMPTY_FILTERS);
  };

  // Keep the *range keys* (not resolved timestamps) in the query key so it's
  // stable across renders, otherwise a fresh ISO cutoff every render would
  // thrash the cache. The keys are resolved to ISO instants inside queryFn.
  const queryParams = {
    q: debouncedQ || undefined,
    source: filters.source || undefined,
    tag: filters.tag || undefined,
    importType: filters.importType || undefined,
    status: filters.status || undefined,
    owner: filters.owner || undefined,
    grade: filters.grade || undefined,
    createdRange: filters.createdRange || undefined,
    activityRange: filters.activityRange || undefined,
    activityFrom: filters.activityFrom || undefined,
    activityTo: filters.activityTo || undefined,
    page,
    limit: PAGE_SIZE,
  };

  // ---- Queries ----
  const leadsQuery = useQuery({
    queryKey: ["leads", queryParams],
    queryFn: () => {
      const activity = activityCutoffs(
        filters.activityRange,
        filters.activityFrom,
        filters.activityTo,
      );
      return listLeads({
        q: queryParams.q,
        source: queryParams.source,
        tag: queryParams.tag,
        importType: queryParams.importType,
        status: queryParams.status,
        owner: queryParams.owner,
        grade: queryParams.grade,
        createdFrom: rangeToIso(filters.createdRange),
        lastActivityFrom: activity.from,
        lastActivityTo: activity.to,
        page: queryParams.page,
        limit: queryParams.limit,
      });
    },
    placeholderData: keepPreviousData,
  });
  // These lists change rarely; cache them so switching pages/filters doesn't
  // refetch the sidebars' worth of options on every keystroke.
  const sourcesQuery = useQuery({
    queryKey: ["lead-sources"],
    queryFn: getLeadSources,
    staleTime: 5 * 60 * 1000,
  });
  const tagsQuery = useQuery({
    queryKey: ["lead-tags"],
    queryFn: getLeadTags,
    staleTime: 5 * 60 * 1000,
  });
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    staleTime: 5 * 60 * 1000,
  });
  // Drives the bulk-assign flow: when the workspace runs on MANUAL assignment,
  // the picker forces choosing a person; otherwise "Auto-assign" stays available.
  const tenantQuery = useQuery({
    queryKey: ["tenant-me"],
    queryFn: getTenantMe,
    staleTime: 5 * 60 * 1000,
  });
  const defaultStrategy = readDefaultStrategy(tenantQuery.data?.tenant.config);
  const isManualAssign = defaultStrategy === "MANUAL";

  const leads = leadsQuery.data?.leads ?? [];
  const total = leadsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);

  // If the current page falls past the end (e.g. after a bulk delete), snap
  // back to the last real page instead of showing an empty table. Only act once
  // real data has loaded, otherwise the initial total of 0 would bounce a page
  // restored from the URL back to page 1 before the count is known.
  React.useEffect(() => {
    if (leadsQuery.data && page > totalPages) setPage(totalPages);
  }, [page, totalPages, leadsQuery.data]);

  const users = usersQuery.data ?? [];
  const ownerName = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.name ?? "Unknown") : "Unassigned";
  // Only active members can own leads, mirrors the backend's auto-assign pool.
  const assignableUsers = React.useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.status === "ACTIVE"),
    [usersQuery.data],
  );

  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserRole = useAuthStore((s) => s.user?.role);
  const isElevated = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";
  const canReassignLead = (lead: Lead) =>
    lead.status !== "DISQUALIFIED" && (isElevated || !lead.owner_id || lead.owner_id === currentUserId);

  const [assigningLeadId, setAssigningLeadId] = React.useState<string | null>(null);

  const handleQuickAssign = async (lead: Lead, val: string) => {
    if (val === (lead.owner_id ?? UNASSIGNED)) return;
    setAssigningLeadId(lead.id);
    try {
      if (val === AUTO_ASSIGN) {
        const res = await assignLead(lead.id, { strategy: defaultStrategy });
        toast.success(
          `Assigned ${lead.name} to ${res.owner.name} (${STRATEGY_LABELS[res.strategy] ?? res.strategy})`,
          { description: res.reason }
        );
      } else if (val === UNASSIGNED) {
        await updateLead(lead.id, { owner_id: null });
        toast.success(`Unassigned ${lead.name}`);
      } else {
        const targetUser = assignableUsers.find((u) => u.id === val);
        await assignLead(lead.id, { strategy: "MANUAL", ownerId: val });
        toast.success(`Assigned ${lead.name} to ${targetUser?.name ?? "agent"}`);
      }
      invalidateLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign lead");
    } finally {
      setAssigningLeadId(null);
    }
  };

  const hasActiveFilters =
    !!debouncedQ ||
    !!filters.source ||
    !!filters.tag ||
    !!filters.importType ||
    !!filters.status ||
    !!filters.owner ||
    !!filters.grade ||
    !!filters.createdRange ||
    !!filters.activityRange;

  // Return raw nullable slice from Zustand selector (never `?? []` inside selector)
  // so React 19's useSyncExternalStore gets a referentially stable snapshot.
  const storeAllowedImportTypes = useAuthStore((s) => s.user?.tenant?.allowed_import_types);
  const allowedImportTypes =
    storeAllowedImportTypes ??
    tenantQuery.data?.tenant?.allowed_import_types ??
    EMPTY_IMPORT_TYPES;

  // ---- Selection ----
  const allOnPageSelected =
    leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) leads.forEach((l) => next.delete(l.id));
      else leads.forEach((l) => next.add(l.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectedIds = React.useMemo(() => Array.from(selected), [selected]);

  // ---- Dialog state ----
  const [newLeadOpen, setNewLeadOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [tagOpen, setTagOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignOwnerId, setAssignOwnerId] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [newLead, setNewLead] = React.useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    source: "",
    notes: "",
    owner_id: AUTO_ASSIGN,
  });
  const [tagValue, setTagValue] = React.useState("");
  const [exporting, setExporting] = React.useState(false);

  const invalidateLeads = () => {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    // A new/imported lead can introduce a brand-new source or tag (e.g. the
    // "CSV Import" marker), so refresh those filter lists too, both are now
    // derived from real lead data.
    queryClient.invalidateQueries({ queryKey: ["lead-sources"] });
    queryClient.invalidateQueries({ queryKey: ["lead-tags"] });
  };

  // ---- Mutations ----
  const createMutation = useMutation({
    mutationFn: createLead,
    onSuccess: (lead) => {
      toast.success(`Lead "${lead.name}" created`);
      setNewLeadOpen(false);
      setNewLead({
        name: "",
        email: "",
        phone: "",
        city: "",
        source: "",
        notes: "",
        owner_id: AUTO_ASSIGN,
      });
      invalidateLeads();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const [importSuccess, setImportSuccess] = React.useState<number | null>(null);
  const [importSkipped, setImportSkipped] = React.useState(0);
  const [importSkippedRows, setImportSkippedRows] = React.useState<SkippedImportRow[]>([]);

  const bulkMutation = useMutation({
    mutationFn: bulkLeadAction,
    onSuccess: (result, variables) => {
      const verb =
        variables.action === "assign"
          ? "Assigned"
          : variables.action === "tag"
            ? "Tagged"
            : "Deleted";
      toast.success(`${verb} ${result.affected} leads`);
      setSelected(new Set());
      setTagOpen(false);
      setAssignOpen(false);
      setDeleteOpen(false);
      setTagValue("");
      invalidateLeads();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Bulk assign opens a picker instead of silently auto-assigning. On MANUAL
  // workspaces the manager must choose a person; otherwise "Auto-assign" is the
  // default and defers to the configured routing rule.
  const openAssignDialog = () => {
    setAssignOwnerId(isManualAssign ? "" : AUTO_ASSIGN);
    setAssignOpen(true);
  };
  const applyAssign = () => {
    const ownerId =
      assignOwnerId && assignOwnerId !== AUTO_ASSIGN ? assignOwnerId : undefined;
    bulkMutation.mutate({ ids: selectedIds, action: "assign", ownerId });
  };

  const handleExport = async (ids?: string[]) => {
    setExporting(true);
    try {
      await downloadLeadsCsv(ids);
      toast.success("CSV downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const showEmpty = !leadsQuery.isLoading && leads.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        description="Capture, score and convert leads across every channel."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="size-4" />
              Import Excel / CSV
            </Button>
            <Button size="sm" onClick={() => setNewLeadOpen(true)}>
              <Plus className="size-4" />
              New Lead
            </Button>
          </>
        }
      />

      {/* Filter bar */}
      <div
        className="reveal flex flex-wrap items-center gap-2"
        style={{ animationDelay: "40ms" }}
      >
        <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select
          value={filters.source || ALL}
          onValueChange={(v) => patchFilters({ source: v === ALL ? "" : v })}
        >
          <SelectTrigger aria-label="Filter by source" className="w-[150px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sources</SelectItem>
            {(sourcesQuery.data ?? []).map((source) => (
              <SelectItem key={source} value={source}>
                {source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Tag filter, how a lead entered the CRM, independent of its source.
            Imports are stamped "CSV Import" so a whole batch is findable here.
            Only shown once the workspace actually has tags. */}
        {(tagsQuery.data ?? []).length > 0 && (
          <Select
            value={filters.tag || ALL}
            onValueChange={(v) => patchFilters({ tag: v === ALL ? "" : v })}
          >
            {/* Wrapper is a <div>, not a <span>: the trigger's
                `[&>span]:line-clamp-1` sets display:-webkit-box, which would
                override flex and stack the icon above the text. */}
            <SelectTrigger aria-label="Filter by tag" className="w-[160px]">
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden [&>span]:min-w-0 [&>span]:truncate">
                <Tag className="size-3.5 shrink-0 opacity-60" />
                <SelectValue placeholder="Tag" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tags</SelectItem>
              {(tagsQuery.data ?? []).map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(allowedImportTypes.length > 1 || !!filters.importType) && (
          <Select
            value={filters.importType || ALL}
            onValueChange={(v) => patchFilters({ importType: v === ALL ? "" : v })}
          >
            <SelectTrigger aria-label="Filter by data type" className="w-[165px]">
              <SelectValue placeholder="Data Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All data types</SelectItem>
              {(Object.keys(IMPORT_TYPE_LABELS) as (keyof typeof IMPORT_TYPE_LABELS)[])
                .filter((k) => allowedImportTypes.includes(k) || filters.importType === k)
                .map((typeKey) => (
                  <SelectItem key={typeKey} value={typeKey}>
                    {IMPORT_TYPE_LABELS[typeKey]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={filters.status || ALL}
          onValueChange={(v) => patchFilters({ status: v === ALL ? "" : v })}
        >
          <SelectTrigger aria-label="Filter by status" className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {LEAD_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {LEAD_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.owner || ALL}
          onValueChange={(v) => patchFilters({ owner: v === ALL ? "" : v })}
        >
          <SelectTrigger aria-label="Filter by owner" className="w-[160px]">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All owners</SelectItem>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.createdRange || ALL}
          onValueChange={(v) =>
            patchFilters({ createdRange: v === ALL ? "" : v })
          }
        >
          <SelectTrigger aria-label="Filter by created date" className="w-[150px]">
            <SelectValue placeholder="Created" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any created date</SelectItem>
            {DATE_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                Created · {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.activityRange || ALL}
          onValueChange={(v) =>
            // Leaving "custom" drops any stale date bounds so they don't linger
            // as hidden filters behind a relative preset.
            patchFilters({
              activityRange: v === ALL ? "" : v,
              ...(v === "custom" ? {} : { activityFrom: "", activityTo: "" }),
            })
          }
        >
          <SelectTrigger aria-label="Filter by last activity" className="w-[160px]">
            <SelectValue placeholder="Last activity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any activity</SelectItem>
            <SelectItem value="today">Active · Today</SelectItem>
            {DATE_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                Active · {r.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Active · Custom range</SelectItem>
          </SelectContent>
        </Select>

        {filters.activityRange === "custom" ? (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Active from"
              value={filters.activityFrom}
              max={filters.activityTo || undefined}
              onChange={(e) => patchFilters({ activityFrom: e.target.value })}
              className="w-[150px]"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="Active to"
              value={filters.activityTo}
              min={filters.activityFrom || undefined}
              onChange={(e) => patchFilters({ activityTo: e.target.value })}
              className="w-[150px]"
            />
          </div>
        ) : null}

        <div className="flex items-center gap-1.5">
          {LEAD_GRADES.map((grade) => (
            <button
              key={grade}
              type="button"
              className={cn(
                "inline-flex h-9 items-center rounded-md border px-3.5 text-xs font-semibold transition-colors duration-120",
                filters.grade === grade
                  ? GRADE_CHIP_ACTIVE[grade]
                  : "bg-card text-muted-foreground hover:bg-muted",
              )}
              onClick={() =>
                patchFilters({ grade: filters.grade === grade ? "" : grade })
              }
            >
              {grade}
            </button>
          ))}
        </div>

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground"
            onClick={clearFilters}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="reveal flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-4 py-2.5">
          <span className="text-sm font-medium tabular-nums">
            {selected.size} selected
          </span>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button variant="outline" size="sm" onClick={() => setTagOpen(true)}>
            <Tag className="size-3.5" />
            Tag
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkMutation.isPending}
            onClick={openAssignDialog}
          >
            <UserCheck className="size-3.5" />
            Assign
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={() => handleExport(selectedIds)}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      ) : null}

      {/* Table */}
      {showEmpty ? (
        <EmptyState
          icon={UserPlus}
          title={
            hasActiveFilters ? "No leads match your filters" : "No leads yet"
          }
          description={
            hasActiveFilters
              ? "Try adjusting or clearing the filters above."
              : "Add your first lead or import a CSV to get started."
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setNewLeadOpen(true)}>
                <Plus className="size-4" />
                New Lead
              </Button>
            )
          }
        />
      ) : (
        <div
          className="reveal rounded-lg border bg-card"
          style={{ animationDelay: "120ms" }}
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-3">
                  <input
                    type="checkbox"
                    aria-label="Select all leads on this page"
                    className="size-4 cursor-pointer accent-brand"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leadsQuery.isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={10}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : leads.map((lead: Lead) => (
                    <TableRow
                      key={lead.id}
                      data-state={
                        selected.has(lead.id) ? "selected" : undefined
                      }
                      className="cursor-pointer"
                      onClick={() =>
                        navigate(`/leads/${lead.id}`, {
                          // Remember where we came from (incl. ?page=N) so the
                          // detail page's back button returns to this exact page.
                          state: { from: `/leads${location.search}` },
                        })
                      }
                    >
                      <TableCell
                        className="pl-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${lead.name}`}
                          className="size-4 cursor-pointer accent-brand"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p className="font-medium">{lead.name}</p>
                        {(() => {
                          const sub = getLeadVerticalSubtitle(lead);
                          if (sub) {
                            return (
                              <p className="mt-0.5 max-w-[230px] truncate text-xs text-muted-foreground">
                                {sub}
                              </p>
                            );
                          }
                          if (Array.isArray(lead.tags) && lead.tags.length > 0) {
                            return (
                              <p className="mt-0.5 max-w-[180px] truncate text-xs text-muted-foreground">
                                {lead.tags.slice(0, 3).join(", ")}
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p className="text-sm">{lead.email || "-"}</p>
                        <p className="text-xs text-muted-foreground">
                          {lead.phone || ""}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {lead.city || "-"}
                      </TableCell>
                      <TableCell>
                        {lead.source ? (
                          <Badge variant="secondary" className="font-normal">
                            {lead.source}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ScoreBadge
                          grade={lead.score_grade}
                          total={lead.score_total}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "",
                            STATUS_STYLES[lead.status] ??
                              "text-muted-foreground",
                          )}
                        >
                          {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {lead.status === "DISQUALIFIED" ? (
                          <span className="text-xs text-muted-foreground italic">Disqualified</span>
                        ) : canReassignLead(lead) ? (
                          <div className="w-fit min-w-[130px]">
                            <Select
                              value={lead.owner_id ?? UNASSIGNED}
                              onValueChange={(val) => handleQuickAssign(lead, val)}
                              disabled={assigningLeadId === lead.id}
                            >
                              <SelectTrigger
                                className="h-7 text-xs border-muted/70 bg-background/60 hover:bg-accent/40 px-2 py-0.5 gap-1 focus:ring-1 focus:ring-brand font-normal"
                                aria-label={`Assign owner for ${lead.name}`}
                              >
                                {assigningLeadId === lead.id ? (
                                  <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <Loader2 className="size-3 animate-spin" />
                                    <span>Saving...</span>
                                  </span>
                                ) : (
                                  <SelectValue>
                                    <span
                                      className={
                                        lead.owner_id
                                          ? "text-foreground font-medium"
                                          : "text-muted-foreground italic"
                                      }
                                    >
                                      {ownerName(lead.owner_id)}
                                    </span>
                                  </SelectValue>
                                )}
                              </SelectTrigger>
                              <SelectContent onClick={(e) => e.stopPropagation()}>
                                <SelectItem value={AUTO_ASSIGN} className="text-xs">
                                  <span className="flex items-center gap-1.5">
                                    <Sparkles className="size-3 text-brand" />
                                    <span>
                                      Auto-assign ({STRATEGY_LABELS[defaultStrategy] ?? defaultStrategy})
                                    </span>
                                  </span>
                                </SelectItem>
                                <SelectItem value={UNASSIGNED} className="text-xs">
                                  <span className="text-muted-foreground">Unassigned</span>
                                </SelectItem>
                                {assignableUsers.map((user) => (
                                  <SelectItem key={user.id} value={user.id} className="text-xs">
                                    {user.name}{" "}
                                    <span className="text-[10px] text-muted-foreground">
                                      ({user.role})
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <span>{ownerName(lead.owner_id)}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(lead.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {lead.last_activity_at ? (
                          // Exact date + time; hover shows the relative "x ago".
                          <span title={timeAgo(lead.last_activity_at)}>
                            {formatDateTime(lead.last_activity_at)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs tabular-nums text-muted-foreground">
              {total === 0 ? (
                "No leads"
              ) : (
                <>
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {rangeFrom}
                  </span>
                  -
                  <span className="font-medium text-foreground">{rangeTo}</span>{" "}
                  of{" "}
                  <span className="font-medium text-foreground">{total}</span>{" "}
                  leads
                </>
              )}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>

              {/* Numbered pages (desktop) / compact indicator (mobile) */}
              <div className="hidden items-center gap-1 sm:flex">
                {pageWindow(page, totalPages).map((p, i) =>
                  p === "…" ? (
                    <span
                      key={`gap-${i}`}
                      className="px-1 text-xs text-muted-foreground"
                    >
                      &hellip;
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="icon"
                      className={cn(
                        "size-8 text-xs tabular-nums",
                        p === page && "pointer-events-none",
                      )}
                      aria-current={p === page ? "page" : undefined}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ),
                )}
              </div>
              <span className="px-2 text-xs tabular-nums text-muted-foreground sm:hidden">
                {page} / {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* New Lead dialog */}
      <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Lead</DialogTitle>
            <DialogDescription>
              Provide at least a name, email or phone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-name">Name</Label>
              <Input
                id="lead-name"
                value={newLead.name}
                onChange={(e) =>
                  setNewLead({ ...newLead, name: e.target.value })
                }
                placeholder="Priya Sharma"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="lead-email">Email</Label>
                <Input
                  id="lead-email"
                  type="email"
                  value={newLead.email}
                  onChange={(e) =>
                    setNewLead({ ...newLead, email: e.target.value })
                  }
                  placeholder="priya@company.example.com"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lead-phone">Phone</Label>
                <Input
                  id="lead-phone"
                  value={newLead.phone}
                  onChange={(e) =>
                    setNewLead({ ...newLead, phone: e.target.value })
                  }
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="lead-city">City</Label>
                <Input
                  id="lead-city"
                  value={newLead.city}
                  onChange={(e) =>
                    setNewLead({ ...newLead, city: e.target.value })
                  }
                  placeholder="Bengaluru"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="leads-source">Source</Label>
                <Select
                  value={newLead.source || undefined}
                  onValueChange={(v) => setNewLead({ ...newLead, source: v })}
                >
                  <SelectTrigger id="leads-source">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sourcesQuery.data ?? []).map((source) => (
                      <SelectItem key={source} value={source}>
                        {source}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-owner">Assign to</Label>
              <Select
                value={newLead.owner_id}
                onValueChange={(v) => setNewLead({ ...newLead, owner_id: v })}
              >
                <SelectTrigger id="lead-owner">
                  <SelectValue placeholder="Choose assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_ASSIGN}>
                    Auto-assign ({STRATEGY_LABELS[defaultStrategy] ?? defaultStrategy})
                  </SelectItem>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {assignableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name} ({user.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-notes">Notes</Label>
              <Textarea
                id="lead-notes"
                value={newLead.notes}
                onChange={(e) =>
                  setNewLead({ ...newLead, notes: e.target.value })
                }
                placeholder="Context, requirements, timeline..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewLeadOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createMutation.isPending ||
                (!newLead.name && !newLead.email && !newLead.phone)
              }
              onClick={() =>
                createMutation.mutate({
                  name: newLead.name || undefined,
                  email: newLead.email || undefined,
                  phone: newLead.phone || undefined,
                  city: newLead.city || undefined,
                  source: newLead.source || undefined,
                  notes: newLead.notes || undefined,
                  owner_id:
                    newLead.owner_id === AUTO_ASSIGN || !newLead.owner_id
                      ? undefined
                      : newLead.owner_id === UNASSIGNED
                        ? null
                        : newLead.owner_id,
                })
              }
            >
              {createMutation.isPending ? "Creating..." : "Create lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Excel / CSV dialog */}
      <LeadImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        assignableUsers={assignableUsers}
        onImported={(res) => {
          invalidateLeads();
          setImportSkipped(res.skipped);
          setImportSkippedRows(res.skippedRows ?? []);
          setImportSuccess(res.imported);
        }}
      />

      {/* Import outcome */}
      <ResultDialog
        open={importSuccess !== null}
        onOpenChange={(open) => {
          if (!open) {
            setImportSuccess(null);
            setImportSkippedRows([]);
          }
        }}
        variant="success"
        title="Import complete"
        description={
          <div className="space-y-2">
            <p>
              {importSuccess ?? 0} {importSuccess === 1 ? "lead has" : "leads have"} been added to
              your workspace.
              {importSkipped > 0
                ? ` ${importSkipped} row${importSkipped === 1 ? "" : "s"} skipped (duplicate or missing contact).`
                : ""}
            </p>
            {importSkippedRows.length > 0 ? (
              <button
                type="button"
                onClick={() => downloadSkippedImportCsv(importSkippedRows)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
              >
                <Download className="size-3.5" />
                Download skipped rows ({importSkippedRows.length})
              </button>
            ) : null}
          </div>
        }
        autoCloseMs={importSkippedRows.length > 0 ? undefined : 5500}
      />

      {/* Tag dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign {selected.size} leads</DialogTitle>
            <DialogDescription>
              {isManualAssign
                ? "Choose the team member who should own the selected leads."
                : "Auto-assign by your workspace rule, or pick a specific team member."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="leads-assign-to">Assign to</Label>
            <Select value={assignOwnerId} onValueChange={setAssignOwnerId}>
              <SelectTrigger id="leads-assign-to">
                <SelectValue placeholder="Select a team member" />
              </SelectTrigger>
              <SelectContent>
                {!isManualAssign ? (
                  <SelectItem value={AUTO_ASSIGN}>
                    Auto-assign ({STRATEGY_LABELS[defaultStrategy]})
                  </SelectItem>
                ) : null}
                {assignableUsers.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No active team members
                  </div>
                ) : (
                  assignableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={bulkMutation.isPending}
              disabled={bulkMutation.isPending || !assignOwnerId}
              onClick={applyAssign}
            >
              Assign leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Tag {selected.size} leads</DialogTitle>
            <DialogDescription>
              The tag is added to every selected lead.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="tag-value">Tag</Label>
            <Input
              id="tag-value"
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="q3-campaign"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={bulkMutation.isPending || !tagValue.trim()}
              onClick={() =>
                bulkMutation.mutate({
                  ids: selectedIds,
                  action: "tag",
                  value: tagValue.trim(),
                })
              }
            >
              Apply tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {selected.size} leads?</DialogTitle>
            <DialogDescription>
              This permanently removes the selected leads. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkMutation.isPending}
              onClick={() =>
                bulkMutation.mutate({ ids: selectedIds, action: "delete" })
              }
            >
              {bulkMutation.isPending ? "Deleting..." : "Delete leads"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
