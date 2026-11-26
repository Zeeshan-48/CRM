import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Lock,
  Sparkles,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiGet } from "@/lib/api/client";
import {
  bulkImportLeads,
  getLeadImportJobStatus,
  type LeadImportAssignMode,
  type LeadImportJobProgress,
  type SkippedImportRow,
} from "@/lib/api/leads";
import {
  autoMapColumns,
  compileMappedImportRows,
  detectHeaderRowIndex,
  downloadSampleTemplate,
  downloadSkippedImportCsv,
  getMappableFields,
  LEAD_IMPORT_PRESETS,
  parseDelimitedText,
  parseSpreadsheetFile,
  type ParsedSheet,
} from "@/lib/lead-import";
import { cn } from "@/lib/utils";
import type { CrmUser } from "@/lib/api/users";
import { useAuthStore } from "@/stores/auth-store";
import type { LeadImportType, User } from "@/types";

const SKIP_COLUMN = "__skip__";
const EMPTY_IMPORT_TYPES: LeadImportType[] = [];
const EMPTY_GRID: string[][] = [];

interface LeadImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignableUsers: CrmUser[];
  onImported: (result: {
    imported: number;
    skipped: number;
    skippedRows?: SkippedImportRow[];
  }) => void;
}

export function LeadImportDialog({
  open,
  onOpenChange,
  assignableUsers,
  onImported,
}: LeadImportDialogProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);

  // Refresh workspace config when dialog opens so Super Admin format toggles
  // apply immediately without forcing the user to sign out and back in.
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    apiGet<{ user: User }>("/auth/me")
      .then((res) => {
        if (active && res?.user?.tenant) {
          patchUser({ tenant: res.user.tenant });
          queryClient.invalidateQueries({ queryKey: ["tenant-me"] });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, patchUser, queryClient]);

  const allowedTypes = user?.tenant?.allowed_import_types ?? EMPTY_IMPORT_TYPES;
  const [selectedType, setSelectedType] = React.useState<LeadImportType>(
    allowedTypes[0] ?? "sales"
  );

  React.useEffect(() => {
    if (allowedTypes.length > 0 && !allowedTypes.includes(selectedType)) {
      setSelectedType(allowedTypes[0]);
    }
  }, [allowedTypes, selectedType]);

  const preset = LEAD_IMPORT_PRESETS[selectedType] ?? LEAD_IMPORT_PRESETS.sales;
  const mappableFields = React.useMemo(() => getMappableFields(preset), [preset]);

  const [sheets, setSheets] = React.useState<ParsedSheet[]>([]);
  const [sheetIdx, setSheetIdx] = React.useState(0);
  const [headerRowIdx, setHeaderRowIdx] = React.useState(0);
  const [columnMapping, setColumnMapping] = React.useState<(string | null)[]>([]);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [pasteMode, setPasteMode] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [skipDuplicates, setSkipDuplicates] = React.useState(true);
  const [showPreview, setShowPreview] = React.useState(false);
  const [parsing, setParsing] = React.useState(false);

  // Upload-time assignment
  const isElevated = user?.role === "ADMIN" || user?.role === "MANAGER";
  const [assignMode, setAssignMode] = React.useState<LeadImportAssignMode>("default");
  const [singleOwnerId, setSingleOwnerId] = React.useState<string>("");
  const [splitOwnerIds, setSplitOwnerIds] = React.useState<string[]>([]);

  // Background job polling + skipped report state
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
  const [jobProgress, setJobProgress] = React.useState<LeadImportJobProgress | null>(null);
  const [failedMsg, setFailedMsg] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const dropRef = React.useRef<HTMLDivElement | null>(null);

  const activeSheet = sheets[sheetIdx] ?? null;
  const rawGrid = activeSheet?.grid ?? EMPTY_GRID;
  const headerCells = rawGrid[headerRowIdx] ?? [];

  const applySheetAutoMap = React.useCallback(
    (grid: string[][], nextHeaderIdx?: number) => {
      if (grid.length === 0) return;
      const hIdx = nextHeaderIdx ?? detectHeaderRowIndex(grid, preset);
      const safeIdx = Math.min(hIdx, Math.max(0, grid.length - 1));
      setHeaderRowIdx(safeIdx);
      const hdrs = grid[safeIdx] ?? [];
      const sampleRows = grid.slice(safeIdx + 1, safeIdx + 7);
      setColumnMapping(autoMapColumns(hdrs, sampleRows, preset));
    },
    [preset]
  );

  // Re-map cleanly when switching format preset or sheet
  React.useEffect(() => {
    if (rawGrid.length > 0) {
      applySheetAutoMap(rawGrid);
    }
  }, [selectedType, sheetIdx, rawGrid.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetAll = React.useCallback(() => {
    setSheets([]);
    setSheetIdx(0);
    setHeaderRowIdx(0);
    setColumnMapping([]);
    setFileName(null);
    setPasteMode(false);
    setPasteText("");
    setFileError(null);
    setDragging(false);
    setSkipDuplicates(true);
    setShowPreview(false);
    setAssignMode("default");
    setSingleOwnerId("");
    setSplitOwnerIds([]);
    setActiveJobId(null);
    setJobProgress(null);
    setFailedMsg(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleLoadFile = React.useCallback(
    async (file: File) => {
      setFileError(null);
      setFailedMsg(null);
      setParsing(true);
      try {
        const parsed = await parseSpreadsheetFile(file);
        setSheets(parsed);
        setSheetIdx(0);
        setFileName(file.name);
        setPasteMode(false);
        setPasteText("");
        applySheetAutoMap(parsed[0].grid);
      } catch (err) {
        setSheets([]);
        setFileName(null);
        setFileError(
          err instanceof Error ? err.message : "Could not read that spreadsheet file."
        );
      } finally {
        setParsing(false);
      }
    },
    [applySheetAutoMap]
  );

  const handlePasteChange = (val: string) => {
    setPasteText(val);
    setFileName(null);
    setFileError(null);
    if (!val.trim()) {
      setSheets([]);
      setColumnMapping([]);
      return;
    }
    const grid = parseDelimitedText(val);
    setSheets([{ name: "Pasted rows", grid }]);
    setSheetIdx(0);
    applySheetAutoMap(grid);
  };

  // Drag & drop inside modal
  React.useEffect(() => {
    const el = dropRef.current;
    if (!el || !open) return;
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth--;
      if (depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void handleLoadFile(file);
    };
    el.addEventListener("dragenter", onEnter);
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", onEnter);
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [open, handleLoadFile]);

  // Prevent browser opening file on missed drop outside modal
  React.useEffect(() => {
    if (!open) return;
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, [open]);

  const compiled = React.useMemo(() => {
    if (rawGrid.length <= headerRowIdx + 1) return null;
    return compileMappedImportRows(
      rawGrid,
      headerRowIdx,
      columnMapping,
      preset,
      skipDuplicates
    );
  }, [rawGrid, headerRowIdx, columnMapping, preset, skipDuplicates]);

  // Background polling when >50 rows
  React.useEffect(() => {
    if (!activeJobId) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getLeadImportJobStatus(activeJobId);
        if (cancelled) return;
        setJobProgress(res);
        if (res.status === "completed") {
          const mergedSkipped = [
            ...(compiled?.skippedRows ?? []),
            ...(res.skippedRows ?? []),
          ];
          setActiveJobId(null);
          queryClient.invalidateQueries({ queryKey: ["leads"] });
          queryClient.invalidateQueries({ queryKey: ["lead-sources"] });
          queryClient.invalidateQueries({ queryKey: ["lead-tags"] });
          onOpenChange(false);
          resetAll();
          onImported({
            imported: res.imported,
            skipped: res.skipped + (compiled?.skippedRows.length ?? 0),
            skippedRows: mergedSkipped,
          });
        } else if (res.status === "failed") {
          setActiveJobId(null);
          setFailedMsg(res.error || "Lead import failed in background worker.");
        } else {
          timer = setTimeout(poll, 1000);
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 2000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeJobId, compiled, onImported, onOpenChange, queryClient, resetAll]);

  const mutation = useMutation({
    mutationFn: bulkImportLeads,
    onSuccess: (res) => {
      if (res.async && res.jobId) {
        setActiveJobId(res.jobId);
        toast.info("Import queued in background worker...", { duration: 3000 });
        return;
      }
      const clientSkipped = compiled?.skippedRows ?? [];
      const allSkipped = [...clientSkipped, ...(res.skippedRows ?? [])];
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["lead-sources"] });
      queryClient.invalidateQueries({ queryKey: ["lead-tags"] });
      onOpenChange(false);
      resetAll();
      onImported({
        imported: res.imported,
        skipped: res.skipped + clientSkipped.length,
        skippedRows: allSkipped,
      });
    },
    onError: (err: Error) => {
      setFailedMsg(err.message || "Failed to import leads.");
    },
  });

  const handleAssignModeChange = (mode: LeadImportAssignMode) => {
    setAssignMode(mode);
    if (mode === "single" && !singleOwnerId) {
      if (!isElevated && user?.id) setSingleOwnerId(user.id);
      else if (assignableUsers[0]) setSingleOwnerId(assignableUsers[0].id);
    }
    if (mode === "round_robin" && splitOwnerIds.length === 0 && assignableUsers.length > 0) {
      setSplitOwnerIds(assignableUsers.slice(0, 2).map((u) => u.id));
    }
  };

  const assignmentInvalid =
    (assignMode === "single" && !singleOwnerId) ||
    (assignMode === "round_robin" && splitOwnerIds.length === 0);

  const handleSubmit = () => {
    if (!compiled || compiled.readyRows.length === 0) {
      toast.error("No valid rows ready to import.");
      return;
    }
    if (assignmentInvalid) {
      toast.error("Pick at least one team member to assign imported leads.");
      return;
    }
    setFailedMsg(null);
    const ownerIds =
      assignMode === "single"
        ? [singleOwnerId]
        : assignMode === "round_robin"
          ? splitOwnerIds
          : undefined;

    mutation.mutate({
      importType: preset.key,
      rows: compiled.readyRows,
      skipDuplicates,
      assignment: {
        mode: assignMode,
        ...(ownerIds ? { ownerIds } : {}),
      },
    });
  };

  const mappedTargets = columnMapping.filter((k): k is string => Boolean(k));
  const splitShareText = React.useMemo(() => {
    if (assignMode !== "round_robin" || splitOwnerIds.length === 0 || !compiled) return null;
    const perAgent = Math.ceil(compiled.readyRows.length / splitOwnerIds.length);
    return `~${perAgent} lead${perAgent === 1 ? "" : "s"} per agent (${splitOwnerIds.length} selected)`;
  }, [assignMode, splitOwnerIds, compiled]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next && !activeJobId) resetAll();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import leads from Excel or CSV</DialogTitle>
          <DialogDescription>
            Upload a <code className="font-mono text-xs">.xlsx</code>,{" "}
            <code className="font-mono text-xs">.xls</code>, or{" "}
            <code className="font-mono text-xs">.csv</code> file, verify column mapping, and
            optionally assign leads directly on upload.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleLoadFile(file);
          }}
        />

        {allowedTypes.length === 0 ? (
          <div className="my-4 flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/30 px-6 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Lock className="size-6" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold">Spreadsheet import is not enabled</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Your platform Super Admin hasn&apos;t enabled an Excel/CSV import format for this
                workspace yet. Ask them to turn on Sales, Student Admission, Medical, or Construction
                data in the Operator Console.
              </p>
            </div>
          </div>
        ) : activeJobId ? (
          <div className="space-y-4 py-6">
            <div className="flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-2 text-foreground">
                <Loader2 className="size-4 animate-spin text-brand" />
                Importing {jobProgress?.total ?? 0} leads ({preset.label})...
              </span>
              <span className="font-mono font-semibold text-brand">
                {jobProgress?.percent ?? 0}%
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-secondary p-0.5">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${jobProgress?.percent ?? 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Processed: {jobProgress?.processed ?? 0} / {jobProgress?.total ?? 0}
              </span>
              <span>
                Imported: {jobProgress?.imported ?? 0} · Skipped: {jobProgress?.skipped ?? 0}
              </span>
            </div>
          </div>
        ) : (
          <div ref={dropRef} className="space-y-4">
            {/* Step 1: Import format badge (single) or interactive selector (multiple) */}
            {allowedTypes.length === 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-brand/40 bg-brand/10 text-brand">
                    {preset.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{preset.subtitle}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadSampleTemplate(preset)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                >
                  <Download className="size-3.5" />
                  Download sample (.xlsx)
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    1. Choose data format
                  </p>
                  <button
                    type="button"
                    onClick={() => void downloadSampleTemplate(preset)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                  >
                    <Download className="size-3.5" />
                    Download {preset.label} sample (.xlsx)
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {allowedTypes.map((typeKey) => {
                    const p = LEAD_IMPORT_PRESETS[typeKey];
                    const active = typeKey === selectedType;
                    return (
                      <button
                        key={typeKey}
                        type="button"
                        onClick={() => setSelectedType(typeKey)}
                        className={cn(
                          "rounded-lg border p-2.5 text-left transition-colors",
                          active
                            ? "border-brand bg-brand/5 ring-1 ring-brand/40"
                            : "border-border bg-card hover:bg-muted/40"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{p.label}</span>
                          {active ? <CheckCircle2 className="size-4 text-brand" /> : null}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {p.subtitle}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* File upload dropzone OR loaded file header bar */}
            {rawGrid.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                  dragging
                    ? "border-brand bg-brand/5"
                    : "border-border hover:border-brand/50 hover:bg-muted/40"
                )}
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-brand/10 text-brand">
                  {parsing ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <FileUp className="size-5" />
                  )}
                </span>
                <span className="text-sm font-medium">
                  {dragging
                    ? "Drop spreadsheet here"
                    : "Click to upload Excel (.xlsx / .xls) or CSV, or drag & drop"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Expected fields: {preset.fields.map((f) => f.label).join(" · ")}
                </span>
              </button>
            ) : (
              <div className="space-y-3">
                {/* Loaded workbook controls bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileSpreadsheet className="size-4 shrink-0 text-emerald-600" />
                    <span className="truncate text-sm font-medium">
                      {fileName ?? "Pasted spreadsheet data"}
                    </span>
                    <Badge variant="secondary" className="text-[11px]">
                      {rawGrid.length - headerRowIdx - 1} rows
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {sheets.length > 1 ? (
                      <Select
                        value={String(sheetIdx)}
                        onValueChange={(v) => {
                          const idx = Number(v);
                          setSheetIdx(idx);
                          applySheetAutoMap(sheets[idx].grid);
                        }}
                      >
                        <SelectTrigger aria-label="Select worksheet" className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {sheets.map((s, i) => (
                            <SelectItem key={s.name} value={String(i)}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}

                    {rawGrid.length > 1 ? (
                      <Select
                        value={String(headerRowIdx)}
                        onValueChange={(v) => {
                          applySheetAutoMap(rawGrid, Number(v));
                        }}
                      >
                        <SelectTrigger aria-label="Header row" className="h-7 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: Math.min(5, rawGrid.length - 1) }, (_, idx) => (
                            <SelectItem key={idx} value={String(idx)}>
                              Header row {idx + 1}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => inputRef.current?.click()}
                    >
                      Change file
                    </Button>
                    <button
                      type="button"
                      onClick={resetAll}
                      aria-label="Remove file"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>

                {/* Interactive Column Mapper */}
                <div className="overflow-hidden rounded-xl border">
                  <div className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Sparkles className="size-3.5 text-brand" />
                      Column mapping ({mappedTargets.length} of {preset.fields.length} mapped)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPreview((v) => !v)}
                      className="text-xs font-medium text-brand hover:underline"
                    >
                      {showPreview ? "Back to column mapper" : "Preview mapped rows"}
                    </button>
                  </div>

                  {!showPreview ? (
                    <div className="max-h-56 overflow-y-auto divide-y">
                      {headerCells.map((hdr, colIdx) => {
                        const sample1 = rawGrid[headerRowIdx + 1]?.[colIdx] ?? "";
                        const sample2 = rawGrid[headerRowIdx + 2]?.[colIdx] ?? "";
                        const samplePreview = [sample1, sample2].filter(Boolean).join(" · ");
                        const currentTarget = columnMapping[colIdx] ?? SKIP_COLUMN;
                        return (
                          <div
                            key={`${colIdx}-${hdr}`}
                            className="grid grid-cols-[1fr_190px] items-center gap-3 px-3.5 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">
                                {hdr || `Column ${colIdx + 1}`}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {samplePreview ? `Sample: ${samplePreview}` : "Empty column"}
                              </p>
                            </div>
                            <Select
                              value={currentTarget}
                              onValueChange={(nextKey) => {
                                setColumnMapping((prev) => {
                                  const next = [...prev];
                                  // Ensure one-to-one mapping so a field isn't mapped twice accidentally
                                  if (nextKey !== SKIP_COLUMN) {
                                    for (let i = 0; i < next.length; i++) {
                                      if (i !== colIdx && next[i] === nextKey) next[i] = null;
                                    }
                                  }
                                  next[colIdx] = nextKey === SKIP_COLUMN ? null : nextKey;
                                  return next;
                                });
                              }}
                            >
                              <SelectTrigger
                                aria-label={`Map column ${hdr || colIdx + 1}`}
                                className="h-8 text-xs"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SKIP_COLUMN}>Skip column</SelectItem>
                                {mappableFields.map((f) => (
                                  <SelectItem key={f.key} value={f.key}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wide text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
                          <tr>
                            {preset.fields.map((f) => (
                              <th key={f.key} className="whitespace-nowrap px-3 py-2 font-medium">
                                {f.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(compiled?.readyRows ?? []).slice(0, 6).map((row, rIdx) => (
                            <tr key={rIdx} className="border-t">
                              {preset.fields.map((f) => (
                                <td
                                  key={f.key}
                                  className="max-w-[11rem] truncate px-3 py-1.5 text-muted-foreground"
                                >
                                  {typeof row[f.key] === "string" && row[f.key]
                                    ? (row[f.key] as string)
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Health summary + Duplicate rule + Upload-Time Assignment */}
                {compiled ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3.5 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {compiled.readyRows.length} ready
                        </span>
                        {compiled.inFileDuplicates > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            {compiled.inFileDuplicates} duplicate in file
                          </span>
                        ) : null}
                        {compiled.invalidCount > 0 ? (
                          <span className="text-danger">
                            {compiled.invalidCount} missing identifier
                          </span>
                        ) : null}
                        {compiled.skippedRows.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => downloadSkippedImportCsv(compiled.skippedRows)}
                            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                          >
                            <Download className="size-3" />
                            Download skipped ({compiled.skippedRows.length})
                          </button>
                        ) : null}
                      </div>

                      <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={skipDuplicates}
                          onChange={(e) => setSkipDuplicates(e.target.checked)}
                          className="size-3.5 accent-brand"
                        />
                        <span>Skip duplicate mobile / email</span>
                      </label>
                    </div>

                    {/* Assign Leads at Upload Time */}
                    <div className="space-y-2.5 rounded-xl border bg-card p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <UserCheck className="size-3.5 text-brand" />
                          Assign uploaded leads to
                        </span>
                        {splitShareText ? (
                          <span className="text-[11px] font-medium text-brand">
                            {splitShareText}
                          </span>
                        ) : null}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <Select
                          value={assignMode}
                          onValueChange={(v) => handleAssignModeChange(v as LeadImportAssignMode)}
                        >
                          <SelectTrigger aria-label="Assignment mode" className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Workspace Default Rule</SelectItem>
                            <SelectItem value="unassigned">Leave Unassigned</SelectItem>
                            <SelectItem value="single">
                              {isElevated ? "Specific Person (All leads → 1)" : "Assign all to me"}
                            </SelectItem>
                            {isElevated && assignableUsers.length > 1 ? (
                              <SelectItem value="round_robin">
                                Split Equally Across Selected Agents
                              </SelectItem>
                            ) : null}
                          </SelectContent>
                        </Select>

                        {assignMode === "single" ? (
                          isElevated ? (
                            <Select value={singleOwnerId} onValueChange={setSingleOwnerId}>
                              <SelectTrigger aria-label="Pick owner" className="h-8 text-xs">
                                <SelectValue placeholder="Choose team member..." />
                              </SelectTrigger>
                              <SelectContent>
                                {assignableUsers.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.name} ({u.role.replace("_", " ")})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2.5 text-xs text-muted-foreground">
                              Assigned to {user?.name ?? "You"}
                            </div>
                          )
                        ) : null}
                      </div>

                      {assignMode === "round_robin" && isElevated ? (
                        <div className="space-y-1.5 pt-1">
                          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Users className="size-3" />
                            Select agents to divide the {compiled.readyRows.length} leads evenly:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {assignableUsers.map((u) => {
                              const picked = splitOwnerIds.includes(u.id);
                              return (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() =>
                                    setSplitOwnerIds((prev) =>
                                      picked ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                                    )
                                  }
                                  className={cn(
                                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                    picked
                                      ? "border-brand bg-brand/10 text-brand"
                                      : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50"
                                  )}
                                >
                                  {u.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {fileError || failedMsg ? (
              <div className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{fileError || failedMsg}</span>
              </div>
            ) : null}

            {/* Paste toggle (helpful for quick tests or copy-paste from Sheets) */}
            {rawGrid.length === 0 || pasteMode ? (
              <div className="space-y-2">
                <div className="flex justify-end text-xs">
                  <button
                    type="button"
                    onClick={() => setPasteMode((v) => !v)}
                    className="font-medium text-muted-foreground hover:text-foreground"
                  >
                    {pasteMode ? "Hide paste box" : "Or paste CSV rows instead"}
                  </button>
                </div>
                {pasteMode ? (
                  <Textarea
                    rows={5}
                    className="font-mono text-xs"
                    placeholder={preset.pastePlaceholder}
                    value={pasteText}
                    onChange={(e) => handlePasteChange(e.target.value)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {activeJobId ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close (Continue in background)
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {allowedTypes.length > 0 ? (
                <Button
                  loading={mutation.isPending}
                  disabled={
                    mutation.isPending ||
                    !compiled ||
                    compiled.readyRows.length === 0 ||
                    assignmentInvalid
                  }
                  onClick={handleSubmit}
                >
                  {compiled && compiled.readyRows.length > 0
                    ? `Import ${compiled.readyRows.length} ${compiled.readyRows.length === 1 ? "lead" : "leads"}`
                    : "Import leads"}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
