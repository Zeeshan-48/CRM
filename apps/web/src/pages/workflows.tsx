import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  History,
  LifeBuoy,
  ListTodo,
  Mail,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  Tag,
  Trash2,
  UserCheck,
  Workflow as WorkflowIcon,
  Zap,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  createWorkflow,
  deleteWorkflow,
  getWorkflowCatalogue,
  listWorkflowRuns,
  listWorkflows,
  testRunWorkflow,
  updateWorkflow,
  type Workflow,
  type WorkflowAction,
  type WorkflowCatalogue,
  type WorkflowInput,
} from "@/lib/api/workflows";
import { listWaTemplates } from "@/lib/api/whatsapp";
import { listEmailTemplates } from "@/lib/api/email";
import { formatNumber, timeAgo } from "@/lib/format";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

// ---- Action metadata ----

const ACTION_ICONS: Record<string, LucideIcon> = {
  ASSIGN_AGENT: UserCheck,
  SEND_WHATSAPP: MessageCircle,
  SEND_EMAIL: Mail,
  CREATE_TASK: ListTodo,
  ADD_TAG: Tag,
  CREATE_TICKET: LifeBuoy,
  NOTIFY: Bell,
};

const ROLES = [
  "SALES_AGENT",
  "SUPPORT_AGENT",
  "MARKETING_AGENT",
  "MANAGER",
  "FINANCE",
  "HR",
  "ADMIN",
];

interface ParamField {
  key: string;
  label: string;
  kind: "text" | "number" | "role" | "template" | "email-template";
  placeholder?: string;
}

// Param fields shown per action type, matching what engine.service.ts reads.
const ACTION_PARAM_FIELDS: Record<string, ParamField[]> = {
  ASSIGN_AGENT: [{ key: "role", label: "Assign to role", kind: "role" }],
  SEND_WHATSAPP: [{ key: "templateKey", label: "Template", kind: "template" }],
  SEND_EMAIL: [{ key: "templateName", label: "Email template", kind: "email-template" }],
  CREATE_TASK: [
    { key: "title", label: "Task title", kind: "text", placeholder: "Follow up with {name}" },
    { key: "dueInDays", label: "Due in (days)", kind: "number", placeholder: "1" },
  ],
  ADD_TAG: [{ key: "tag", label: "Tag", kind: "text", placeholder: "workflow" }],
  CREATE_TICKET: [
    { key: "subject", label: "Ticket subject", kind: "text", placeholder: "Workflow ticket" },
  ],
  NOTIFY: [
    { key: "role", label: "Notify role", kind: "role" },
    { key: "text", label: "Message", kind: "text", placeholder: "Workflow fired" },
  ],
};

const prettyAction = (type: string): string =>
  type
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// ---- Workflow editor dialog ----

interface ActionRowDraft {
  type: string;
  params: Record<string, string>;
}

const draftFromActions = (actions: WorkflowAction[]): ActionRowDraft[] =>
  actions.map((a) => ({
    type: a.type,
    params: Object.fromEntries(
      Object.entries(a.params ?? {}).map(([k, v]) => [k, String(v ?? "")])
    ),
  }));

const actionsFromDraft = (rows: ActionRowDraft[]): WorkflowAction[] =>
  rows.map((row) => {
    const params: Record<string, unknown> = {};
    for (const field of ACTION_PARAM_FIELDS[row.type] ?? []) {
      const raw = (row.params[field.key] ?? "").trim();
      if (!raw) continue;
      params[field.key] = field.kind === "number" ? Number(raw) : raw;
    }
    return Object.keys(params).length ? { type: row.type, params } : { type: row.type };
  });

interface WorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogue: WorkflowCatalogue;
  workflow: Workflow | null;
  onSubmit: (input: WorkflowInput) => void;
  saving: boolean;
}

function WorkflowDialog({
  open,
  onOpenChange,
  catalogue,
  workflow,
  onSubmit,
  saving,
}: WorkflowDialogProps) {
  const [name, setName] = React.useState(workflow?.name ?? "");
  const [trigger, setTrigger] = React.useState(workflow?.trigger ?? "");
  const [rows, setRows] = React.useState<ActionRowDraft[]>(
    workflow ? draftFromActions(workflow.actions) : []
  );

  // WhatsApp templates for the template picker, loaded lazily while the editor
  // is open. Only genuinely Meta-approved templates (those with a meta_id) can
  // be sent, local drafts would be rejected by Meta at send time.
  const waTemplatesQuery = useQuery({
    queryKey: ["wa-templates"],
    queryFn: listWaTemplates,
    enabled: open,
  });
  const approvedTemplates = (waTemplatesQuery.data ?? []).filter(
    (t) => t.status === "APPROVED" && !!t.meta_id
  );

  // Email templates for the SEND_EMAIL picker. The engine matches on the
  // template's `name`, and always falls back to the built-in "Welcome" template
  // when no matching row exists, so "Welcome" is offered even with zero rows.
  const emailTemplatesQuery = useQuery({
    queryKey: ["email-templates"],
    queryFn: listEmailTemplates,
    enabled: open,
  });
  const emailTemplateNames = React.useMemo(() => {
    const names = (emailTemplatesQuery.data ?? []).map((t) => t.name);
    if (!names.some((n) => n.toLowerCase() === "welcome")) names.unshift("Welcome");
    return names;
  }, [emailTemplatesQuery.data]);

  const addRow = () => {
    const type = catalogue.actions[0] ?? "NOTIFY";
    setRows((prev) => [...prev, { type, params: {} }]);
  };

  const updateRow = (index: number, patch: Partial<ActionRowDraft>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const setParam = (index: number, key: string, value: string) => {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, params: { ...row.params, [key]: value } } : row
      )
    );
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("Give the workflow a name");
      return;
    }
    if (!trigger) {
      toast.error("Pick a trigger");
      return;
    }
    onSubmit({ name: name.trim(), trigger, actions: actionsFromDraft(rows) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{workflow ? "Edit workflow" : "New workflow"}</DialogTitle>
          <DialogDescription>
            When the trigger fires, every action below runs in order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">Name</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome new leads"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="workflows-trigger">Trigger</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger id="workflows-trigger">
                <SelectValue placeholder="Select a trigger event" />
              </SelectTrigger>
              <SelectContent>
                {catalogue.triggers.map((t) => (
                  <SelectItem key={t} value={t}>
                    <span className="font-mono text-xs">{t}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Actions</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="size-3.5" />
                Add action
              </Button>
            </div>

            {rows.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                No actions yet. Add at least one so the workflow does something.
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map((row, index) => {
                  const Icon = ACTION_ICONS[row.type] ?? Zap;
                  const fields = ACTION_PARAM_FIELDS[row.type] ?? [];
                  return (
                    <div key={index} className="border-t pt-3">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center text-brand">
                          <Icon className="size-3.5" />
                        </span>
                        <Select
                          value={row.type}
                          onValueChange={(type) => updateRow(index, { type, params: {} })}
                        >
                          <SelectTrigger className="h-8 flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {catalogue.actions.map((a) => (
                              <SelectItem key={a} value={a}>
                                {prettyAction(a)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(index)}
                          aria-label="Remove action"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>

                      {fields.length > 0 ? (
                        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                          {fields.map((field) => (
                            <div key={field.key} className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                {field.label}
                              </Label>
                              {field.kind === "role" ? (
                                <Select
                                  value={row.params[field.key] ?? ""}
                                  onValueChange={(v) => setParam(index, field.key, v)}
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue placeholder="Select role" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ROLES.map((r) => (
                                      <SelectItem key={r} value={r}>
                                        {r}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : field.kind === "template" ? (
                                <Select
                                  value={row.params[field.key] ?? ""}
                                  onValueChange={(v) => setParam(index, field.key, v)}
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue placeholder="Select template" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {waTemplatesQuery.isLoading ? (
                                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                                        <Spinner />
                                        Loading templates
                                      </div>
                                    ) : approvedTemplates.length === 0 ? (
                                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                        No approved WhatsApp templates yet.
                                      </p>
                                    ) : (
                                      approvedTemplates.map((t) => (
                                        <SelectItem key={t.id} value={t.key}>
                                          {t.key}
                                        </SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : field.kind === "email-template" ? (
                                <Select
                                  value={row.params[field.key] ?? ""}
                                  onValueChange={(v) => setParam(index, field.key, v)}
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue placeholder="Select template" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {emailTemplatesQuery.isLoading ? (
                                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                                        <Spinner />
                                        Loading templates
                                      </div>
                                    ) : (
                                      emailTemplateNames.map((name) => (
                                        <SelectItem key={name} value={name}>
                                          {name}
                                        </SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  className="h-8"
                                  type={field.kind === "number" ? "number" : "text"}
                                  value={row.params[field.key] ?? ""}
                                  placeholder={field.placeholder}
                                  onChange={(e) => setParam(index, field.key, e.target.value)}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          No configuration needed. The engine writes a contextual email.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : workflow ? "Save changes" : "Create workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Page ----

export default function WorkflowsPage() {
  const queryClient = useQueryClient();

  const catalogueQuery = useQuery({
    queryKey: ["workflow-catalogue"],
    queryFn: getWorkflowCatalogue,
    staleTime: 5 * 60_000,
  });
  const workflowsQuery = useQuery({ queryKey: ["workflows"], queryFn: listWorkflows });
  const runsQuery = useQuery({ queryKey: ["workflow-runs"], queryFn: listWorkflowRuns });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Workflow | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: WorkflowInput) =>
      editing ? updateWorkflow(editing.id, input) : createWorkflow(input),
    onSuccess: (workflow) => {
      toast.success(editing ? `Updated "${workflow.name}"` : `Created "${workflow.name}"`);
      setDialogOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateWorkflow(id, { active }),
    onSuccess: (workflow) => {
      toast.success(`"${workflow.name}" is now ${workflow.active ? "active" : "paused"}`);
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWorkflow(id),
    onSuccess: () => {
      toast.success("Workflow deleted");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testRunMutation = useMutation({
    mutationFn: (id: string) => testRunWorkflow(id),
    onSuccess: (result) => {
      const lines = result.runs.flatMap((run) => run.log);
      toast.success(
        `Fired ${result.fired} workflow ${result.fired === 1 ? "run" : "runs"}`,
        {
          description: lines.length ? (
            <ul className="mt-1 space-y-0.5 font-mono text-xs">
              {lines.slice(0, 8).map((line, i) => (
                <li key={i} className="truncate">
                  &rsaquo; {line}
                </li>
              ))}
              {lines.length > 8 ? <li>...and {lines.length - 8} more</li> : null}
            </ul>
          ) : (
            "No log output."
          ),
          duration: 8000,
        }
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const workflows = workflowsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const catalogue = catalogueQuery.data;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (workflow: Workflow) => {
    setEditing(workflow);
    setDialogOpen(true);
  };

  const handleDelete = (workflow: Workflow) => {
    if (window.confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(workflow.id);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Trigger-based automation across your CRM."
        actions={
          <Button onClick={openCreate} disabled={!catalogue}>
            <Plus className="size-4" />
            New Workflow
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Workflow list */}
        <section className="reveal space-y-3 lg:col-span-2" style={{ animationDelay: "60ms" }}>
          {workflowsQuery.isLoading ? (
            <>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </>
          ) : workflows.length === 0 ? (
            <EmptyState
              icon={WorkflowIcon}
              title="No workflows yet"
              description="Automate the busywork. Pick a trigger, stack a few actions, done."
              action={
                <Button onClick={openCreate} disabled={!catalogue}>
                  <Plus className="size-4" />
                  New Workflow
                </Button>
              }
            />
          ) : (
            workflows.map((workflow, index) => (
              <Card
                key={workflow.id}
                className="reveal"
                style={{ animationDelay: `${80 + index * 40}ms` }}
              >
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-sm font-semibold tracking-tight">
                          {workflow.name}
                        </h3>
                        <Badge variant="brand" className="font-mono text-[11px]">
                          <Zap className="mr-1 size-3" />
                          {workflow.trigger}
                        </Badge>
                      </div>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatNumber(workflow.run_count)} runs
                        <span className="px-1.5">&middot;</span>
                        last run {timeAgo(workflow.last_run_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={workflow.active}
                        onCheckedChange={(active) =>
                          toggleMutation.mutate({ id: workflow.id, active })
                        }
                        aria-label={workflow.active ? "Deactivate workflow" : "Activate workflow"}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(workflow)}
                        aria-label="Edit workflow"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(workflow)}
                        aria-label="Delete workflow"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {workflow.actions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {workflow.actions.map((action, i) => {
                        const Icon = ACTION_ICONS[action.type] ?? Zap;
                        return (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                          >
                            <Icon className="size-3 text-brand" />
                            {prettyAction(action.type)}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">No actions configured.</p>
                  )}

                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testRunMutation.mutate(workflow.id)}
                      disabled={
                        testRunMutation.isPending && testRunMutation.variables === workflow.id
                      }
                    >
                      <Play className="size-3.5" />
                      {testRunMutation.isPending && testRunMutation.variables === workflow.id
                        ? "Running..."
                        : "Run test"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </section>

        {/* Run history */}
        <section className="reveal" style={{ animationDelay: "140ms" }}>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Run history</CardTitle>
              <History className="size-4 text-brand" />
            </CardHeader>
            <CardContent>
              {runsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No runs yet. Fire a test to see the engine in action.
                </p>
              ) : (
                <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
                  {runs.map((run) => (
                    <div key={run.id} className="border-t pt-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{run.workflow_name}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            {run.event}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(run.created_at)}
                        </span>
                      </div>
                      {run.log.length > 0 ? (
                        <div className="mt-2 rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
                          {run.log.map((line, i) => (
                            <p key={i} className="truncate text-muted-foreground" title={line}>
                              <span className="mr-1.5 text-brand">&rsaquo;</span>
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {catalogue && dialogOpen ? (
        <WorkflowDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditing(null);
          }}
          catalogue={catalogue}
          workflow={editing}
          onSubmit={(input) => saveMutation.mutate(input)}
          saving={saveMutation.isPending}
        />
      ) : null}
    </div>
  );
}
