import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  Link2,
  ListChecks,
  ListTodo,
  Mail,
  Monitor,
  NotebookPen,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  completeTask,
  countActivities,
  createTask,
  deleteActivity,
  deleteTask,
  listActivities,
  listTasks,
  logActivity,
  updateActivity,
  updateTask,
  type Activity,
  type ActivityType,
  type Priority,
  type Task,
} from "@/lib/api/activities";
import { useConfirm } from "@/components/confirm-provider";
import { listContacts } from "@/lib/api/contacts";
import { getBoard } from "@/lib/api/deals";
import { listUsers } from "@/lib/api/users";
import { listLeadOptions } from "@/lib/api/lead-options";
import { useAuthStore } from "@/stores/auth-store";
import { formatDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const ALL = "__all__";

const ACTIVITY_TYPES: ActivityType[] = [
  "CALL",
  "MEETING",
  "DEMO",
  "NOTE",
  "EMAIL",
  "TASK",
];
const PRIORITIES: Priority[] = ["HIGH", "MEDIUM", "LOW"];

const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  CALL: Phone,
  MEETING: Users,
  DEMO: Monitor,
  NOTE: NotebookPen,
  EMAIL: Mail,
  TASK: FileText,
};

// Type-specific accent tints, keeps the feed scannable without the tenant brand.
const ACTIVITY_ICON_STYLES: Record<ActivityType, string> = {
  CALL: "text-emerald-700 dark:text-emerald-400",
  MEETING: "text-violet-600 dark:text-violet-400",
  DEMO: "text-sky-600 dark:text-sky-400",
  NOTE: "text-amber-700 dark:text-amber-400",
  EMAIL: "text-blue-600 dark:text-blue-400",
  TASK: "text-slate-600 dark:text-slate-400",
};

const PRIORITY_STYLES: Record<Priority, string> = {
  HIGH: "text-danger",
  MEDIUM: "text-warning",
  LOW: "text-neutral",
};

const PRIORITY_CHIP_ACTIVE: Record<Priority, string> = {
  HIGH: "text-danger",
  MEDIUM: "text-warning",
  LOW: "text-neutral",
};

const TASK_STATUSES: Task["status"][] = ["OPEN", "DONE", "CANCELLED"];

function formatDuration(sec: number): string {
  if (sec <= 0) return "";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** "Today" / "Yesterday" / a formatted date, for feed day-grouping headers. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfThat = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const dayMs = 86_400_000;
  if (startOfThat === startOfToday) return "Today";
  if (startOfThat === startOfToday - dayMs) return "Yesterday";
  return formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
}

function groupActivitiesByDay(
  items: Activity[],
): Array<{ label: string; items: Activity[] }> {
  const groups: Array<{ label: string; items: Activity[] }> = [];
  const index = new Map<string, number>();
  for (const a of items) {
    const label = dayLabel(a.created_at);
    let i = index.get(label);
    if (i === undefined) {
      i = groups.length;
      index.set(label, i);
      groups.push({ label, items: [] });
    }
    groups[i].items.push(a);
  }
  return groups;
}

function linkLabel(entry: {
  lead_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
}): string | null {
  if (entry.lead_id) return "Lead";
  if (entry.contact_id) return "Contact";
  if (entry.deal_id) return "Deal";
  return null;
}

function StatPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          tone,
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-none tracking-tight">
          {value}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function TaskRowItem({
  task,
  ownerName,
  onComplete,
  onEdit,
  onDelete,
  completing,
  deleting,
}: {
  task: Task;
  ownerName?: string;
  onComplete?: (id: string) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  completing?: boolean;
  deleting?: boolean;
}) {
  const done = task.status === "DONE";
  const overdue =
    !done && task.due_at && new Date(task.due_at).getTime() < Date.now();
  const link = linkLabel(task);
  return (
    <li className="group -mx-2 flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50">
      <input
        type="checkbox"
        aria-label={done ? `${task.title} (done)` : `Complete ${task.title}`}
        className="mt-0.5 size-4 cursor-pointer accent-brand"
        checked={done}
        disabled={done || completing}
        onChange={() => onComplete?.(task.id)}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm text-foreground/90",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge
            className={cn(
              "text-[10px]",
              PRIORITY_STYLES[task.priority],
            )}
          >
            {task.priority}
          </Badge>
          {task.ai_generated ? (
            <Badge
              variant="secondary"
              className="gap-1 text-[10px] font-medium"
              title="Created by an AI agent"
            >
              <Bot className="size-3" />
              AI
            </Badge>
          ) : null}
          {task.due_at ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                overdue ? "font-medium text-danger" : "text-muted-foreground",
              )}
            >
              <CalendarClock className="size-3" />
              {overdue ? "overdue · " : "due "}
              {formatDate(task.due_at)}
            </span>
          ) : null}
          {ownerName ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <User className="size-3" />
              {ownerName}
            </span>
          ) : null}
          {link ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Link2 className="size-3" />
              {link}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="Edit task"
          onClick={() => onEdit?.(task)}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-danger"
          aria-label="Delete task"
          disabled={deleting}
          onClick={() => onDelete?.(task)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function EditTaskDialog({
  task,
  onOpenChange,
}: {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("MEDIUM");
  const [status, setStatus] = React.useState<Task["status"]>("OPEN");
  const [dueAt, setDueAt] = React.useState("");

  React.useEffect(() => {
    if (task) {
      setTitle(task.title);
      setPriority(task.priority);
      setStatus(task.status);
      setDueAt(task.due_at ? task.due_at.slice(0, 10) : "");
    }
  }, [task]);

  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof updateTask>[1]) =>
      updateTask(task!.id, body),
    onSuccess: (updated) => {
      toast.success(`Task "${updated.title}" updated`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleSave = () => {
    if (!title.trim()) {
      toast.error("Title cannot be empty");
      return;
    }
    mutation.mutate({
      title: title.trim(),
      priority,
      status,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
    });
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Update the task's details.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-task-title">Title</Label>
            <Input
              id="edit-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="activities-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as Priority)}
              >
                <SelectTrigger id="activities-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="activities-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as Task["status"])}
              >
                <SelectTrigger id="activities-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-task-due">Due date</Label>
            <Input
              id="edit-task-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} loading={mutation.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditActivityDialog({
  activity,
  onOpenChange,
}: {
  activity: Activity | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<ActivityType>("CALL");
  const [direction, setDirection] = React.useState<"INBOUND" | "OUTBOUND">(
    "OUTBOUND",
  );
  const [subject, setSubject] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (activity) {
      setType(activity.type);
      setDirection(activity.direction ?? "OUTBOUND");
      setSubject(activity.subject ?? "");
      setNotes(activity.notes ?? "");
    }
  }, [activity]);

  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof updateActivity>[1]) =>
      updateActivity(activity!.id, body),
    onSuccess: () => {
      toast.success("Activity updated");
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={!!activity} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
          <DialogDescription>Update this feed entry.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="activities-type-2">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ActivityType)}
              >
                <SelectTrigger id="activities-type-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="activities-direction">Direction</Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as "INBOUND" | "OUTBOUND")}
              >
                <SelectTrigger id="activities-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OUTBOUND">OUTBOUND</SelectItem>
                  <SelectItem value="INBOUND">INBOUND</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-act-subject">Subject</Label>
            <Input
              id="edit-act-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-act-notes">Notes</Label>
            <Textarea
              id="edit-act-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate({ type, direction, subject, notes })}
            loading={mutation.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    title: "",
    priority: "MEDIUM" as Priority,
    due_at: "",
    ownerId: "",
    linkType: "" as "" | "lead" | "contact" | "deal",
    linkId: "",
  });

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const leadOptsQuery = useQuery({
    queryKey: ["lead-options"],
    queryFn: listLeadOptions,
    enabled: open && form.linkType === "lead",
  });
  const contactOptsQuery = useQuery({
    queryKey: ["contact-options"],
    queryFn: () => listContacts(),
    enabled: open && form.linkType === "contact",
  });
  const dealOptsQuery = useQuery({
    queryKey: ["deal-options"],
    queryFn: () => getBoard(),
    enabled: open && form.linkType === "deal",
  });

  const linkOptions: Array<{ id: string; label: string }> =
    form.linkType === "lead"
      ? (leadOptsQuery.data ?? []).map((l) => ({ id: l.id, label: l.name }))
      : form.linkType === "contact"
        ? (contactOptsQuery.data ?? []).map((c) => ({ id: c.id, label: c.name }))
        : form.linkType === "deal"
          ? (dealOptsQuery.data?.board ?? [])
              .flatMap((col) => col.deals)
              .map((d) => ({ id: d.id, label: d.title }))
          : [];
  const linkLoading =
    (form.linkType === "lead" && leadOptsQuery.isLoading) ||
    (form.linkType === "contact" && contactOptsQuery.isLoading) ||
    (form.linkType === "deal" && dealOptsQuery.isLoading);

  const mutation = useMutation({
    mutationFn: () =>
      createTask({
        title: form.title.trim(),
        priority: form.priority,
        due_at: form.due_at || undefined,
        owner_id: form.ownerId || undefined,
        lead_id:
          form.linkType === "lead" ? form.linkId || undefined : undefined,
        contact_id:
          form.linkType === "contact" ? form.linkId || undefined : undefined,
        deal_id:
          form.linkType === "deal" ? form.linkId || undefined : undefined,
      }),
    onSuccess: (task) => {
      toast.success(`Task "${task.title}" added`);
      setForm({
        title: "",
        priority: "MEDIUM",
        due_at: "",
        ownerId: "",
        linkType: "",
        linkId: "",
      });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          Add task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
          <DialogDescription>
            Create a task with an owner, due date and optional link.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="add-task-title">Title</Label>
            <Input
              id="add-task-title"
              placeholder="Follow up with Acme"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  className={cn(
                    "rounded-md border px-2.5 py-0.5 text-[11px] font-semibold transition-colors duration-120",
                    form.priority === priority
                      ? PRIORITY_CHIP_ACTIVE[priority]
                      : "bg-card text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => setForm({ ...form, priority })}
                >
                  {priority}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="add-task-due">Due date</Label>
              <Input
                id="add-task-due"
                type="date"
                value={form.due_at}
                onChange={(e) => setForm({ ...form, due_at: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="activities-assignee">Assignee</Label>
              <Select
                value={form.ownerId || "__me__"}
                onValueChange={(v) =>
                  setForm({ ...form, ownerId: v === "__me__" ? "" : v })
                }
              >
                <SelectTrigger id="activities-assignee">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__me__">Assign to me</SelectItem>
                  {(usersQuery.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Link to</Label>
            <Select
              value={form.linkType || "__none__"}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  linkType:
                    v === "__none__"
                      ? ""
                      : (v as "lead" | "contact" | "deal"),
                  linkId: "",
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No link" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No link</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="contact">Contact</SelectItem>
                <SelectItem value="deal">Deal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.linkType ? (
            <Select
              value={form.linkId}
              onValueChange={(v) => setForm({ ...form, linkId: v })}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    linkLoading
                      ? "Loading..."
                      : `Select a ${form.linkType}...`
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {linkOptions.length === 0 && !linkLoading ? (
                  <SelectItem value="__empty__" disabled>
                    {`No ${form.linkType}s found`}
                  </SelectItem>
                ) : (
                  linkOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.title.trim()}
          >
            Add task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ActivitiesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const [typeFilter, setTypeFilter] = React.useState<string>("");
  const [ownerFilter, setOwnerFilter] = React.useState<string>("");
  const [search, setSearch] = React.useState("");
  // AI-generated activities/tasks are hidden by default so the feed reflects team
  // work; the toggle brings them back (badged). Sent to every list/count query.
  const [showAi, setShowAi] = React.useState(false);
  const includeAi = showAi ? undefined : false;
  const [taskTab, setTaskTab] = React.useState<"OPEN" | "DONE">("OPEN");
  const [logOpen, setLogOpen] = React.useState(false);
  const [quickTitle, setQuickTitle] = React.useState("");
  const [editTask, setEditTask] = React.useState<Task | null>(null);
  const [editActivity, setEditActivity] = React.useState<Activity | null>(null);
  const [logForm, setLogForm] = React.useState({
    type: "CALL" as ActivityType,
    direction: "OUTBOUND" as "INBOUND" | "OUTBOUND",
    subject: "",
    notes: "",
  });

  const activitiesQuery = useQuery({
    queryKey: ["activities", typeFilter, ownerFilter, showAi],
    queryFn: () =>
      listActivities({
        type: (typeFilter || undefined) as ActivityType | undefined,
        owner: ownerFilter || undefined,
        includeAi,
        limit: 50,
      }),
  });
  // The feed above is capped at 50 rows, so its length is NOT the real total.
  // This is the true count (same filters, no limit) that drives the stat tile.
  // Keyed under ["activities", …] so existing ["activities"] invalidations after
  // logging/deleting refresh it too.
  const activitiesCountQuery = useQuery({
    queryKey: ["activities", "count", typeFilter, ownerFilter, showAi],
    queryFn: () =>
      countActivities({
        type: (typeFilter || undefined) as ActivityType | undefined,
        owner: ownerFilter || undefined,
        includeAi,
      }),
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", taskTab, showAi],
    queryFn: () => listTasks(taskTab, false, includeAi),
  });
  // Always-open list powers the summary stats + Open tab count regardless of
  // which tab is showing. When taskTab === "OPEN" this shares the same cache key.
  const openTasksQuery = useQuery({
    queryKey: ["tasks", "OPEN", showAi],
    queryFn: () => listTasks("OPEN", false, includeAi),
  });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });

  const userMap = React.useMemo(
    () => new Map((usersQuery.data ?? []).map((u) => [u.id, u.name])),
    [usersQuery.data],
  );

  const logMutation = useMutation({
    mutationFn: () =>
      logActivity({
        type: logForm.type,
        direction: logForm.direction,
        subject: logForm.subject || undefined,
        notes: logForm.notes || undefined,
      }),
    onSuccess: () => {
      toast.success("Activity logged");
      setLogOpen(false);
      setLogForm({
        type: "CALL",
        direction: "OUTBOUND",
        subject: "",
        notes: "",
      });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const quickAddMutation = useMutation({
    mutationFn: () =>
      createTask({ title: quickTitle.trim(), priority: "MEDIUM" }),
    onSuccess: (task) => {
      toast.success(`Task "${task.title}" added`);
      setQuickTitle("");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const completeMutation = useMutation({
    mutationFn: completeTask,
    onSuccess: (task) => {
      toast.success(`"${task.title}" completed`);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      toast.success("Task deleted");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteActivityMutation = useMutation({
    mutationFn: deleteActivity,
    onSuccess: () => {
      toast.success("Activity deleted");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleDeleteTask = async (task: Task) => {
    const ok = await confirm({
      title: "Delete task?",
      description: `"${task.title}" will be permanently removed.`,
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) deleteTaskMutation.mutate(task.id);
  };

  const handleDeleteActivity = async (activity: Activity) => {
    const ok = await confirm({
      title: "Delete activity?",
      description: `This ${activity.type.toLowerCase()} entry will be permanently removed from the feed.`,
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) deleteActivityMutation.mutate(activity.id);
  };

  const activities = activitiesQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const openTasks = openTasksQuery.data ?? [];

  const filteredActivities = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter(
      (a) =>
        (a.subject ?? "").toLowerCase().includes(q) ||
        (a.notes ?? "").toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        // Also match the agent and linked lead/contact/deal shown on the row.
        (a.with_name ?? "").toLowerCase().includes(q) ||
        (a.owner_name ?? "").toLowerCase().includes(q) ||
        (a.owner_id ? (userMap.get(a.owner_id) ?? "") : "")
          .toLowerCase()
          .includes(q),
    );
  }, [activities, search, userMap]);

  const grouped = React.useMemo(
    () => groupActivitiesByDay(filteredActivities),
    [filteredActivities],
  );

  const overdueCount = openTasks.filter(
    (t) => t.due_at && new Date(t.due_at).getTime() < Date.now(),
  ).length;
  const highCount = openTasks.filter((t) => t.priority === "HIGH").length;

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-6.5rem)]">
      <PageHeader
        title="Activities"
        description="Calls, meetings, tasks and notes across the team."
        actions={
          <Button size="sm" onClick={() => setLogOpen(true)}>
            <Plus className="size-4" />
            Log activity
          </Button>
        }
      />

      {/* Summary stats */}
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <StatPill
          icon={ListChecks}
          label={typeFilter ? `${typeFilter} activities` : "Total activities"}
          value={
            activitiesCountQuery.isLoading
              ? "-"
              : (activitiesCountQuery.data?.total ?? 0)
          }
          tone="bg-blue-500/10 text-blue-600 dark:text-blue-400"
        />
        <StatPill
          icon={ListTodo}
          label="Open tasks"
          value={openTasksQuery.isLoading ? "-" : openTasks.length}
          tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
        />
        <StatPill
          icon={Clock}
          label="Overdue"
          value={openTasksQuery.isLoading ? "-" : overdueCount}
          tone="bg-danger/10 text-danger"
        />
        <StatPill
          icon={Flame}
          label="High priority"
          value={openTasksQuery.isLoading ? "-" : highCount}
          tone="bg-amber-500/10 text-amber-700 dark:text-amber-400"
        />
      </div>

      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-3">
        {/* Feed */}
        <section
          className="reveal flex min-h-0 flex-col lg:col-span-2"
          style={{ animationDelay: "60ms" }}
        >
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 gap-3 space-y-0 border-b">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  Recent activity
                  {!activitiesQuery.isLoading ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      {filteredActivities.length}
                    </span>
                  ) : null}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Select
                    value={ownerFilter || ALL}
                    onValueChange={(v) => setOwnerFilter(v === ALL ? "" : v)}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="All owners" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All owners</SelectItem>
                      {currentUserId ? (
                        <SelectItem value={currentUserId}>My activities</SelectItem>
                      ) : null}
                      {(usersQuery.data ?? [])
                        .filter((u) => u.id !== currentUserId)
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={typeFilter || ALL}
                    onValueChange={(v) => setTypeFilter(v === ALL ? "" : v)}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All types</SelectItem>
                      {ACTIVITY_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search subject, notes, agent or lead…"
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {/* AI activity is hidden by default so the feed reads as team
                    work; flip this to bring bot-logged rows back (badged). */}
                <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground">
                  <Bot className="size-3.5" />
                  <span className="hidden sm:inline">Show AI</span>
                  <Switch checked={showAi} onCheckedChange={setShowAi} />
                </label>
              </div>
            </CardHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {activitiesQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : filteredActivities.length === 0 ? (
                <EmptyState
                  icon={ListTodo}
                  title={search ? "No matches" : "No activity yet"}
                  description={
                    search
                      ? "Try a different search term or clear the filter."
                      : "Log your first call, meeting or note to start the feed."
                  }
                  className="border-0 py-10"
                  action={
                    search ? undefined : (
                      <Button size="sm" onClick={() => setLogOpen(true)}>
                        <Plus className="size-4" />
                        Log activity
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="space-y-5">
                  {grouped.map((group) => (
                    <div key={group.label}>
                      <p className="sticky -top-5 z-10 -mx-5 mb-2 bg-card/95 px-5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                        {group.label}
                      </p>
                      <ul className="space-y-1">
                        {group.items.map((activity) => {
                          const Icon = ACTIVITY_ICONS[activity.type] ?? FileText;
                          // Agent: prefer the live users list, fall back to the
                          // name the server resolved on the row.
                          const agent =
                            (activity.owner_id
                              ? userMap.get(activity.owner_id)
                              : undefined) ??
                            activity.owner_name ??
                            undefined;
                          const duration = activity.duration_sec
                            ? formatDuration(activity.duration_sec)
                            : "";
                          // Linked record: real name when available, else the
                          // generic type word (e.g. record since deleted).
                          const withName =
                            activity.with_name ?? linkLabel(activity);
                          const withType = activity.with_type
                            ? activity.with_type.charAt(0) +
                              activity.with_type.slice(1).toLowerCase()
                            : linkLabel(activity);
                          return (
                            <li
                              key={activity.id}
                              className="group -mx-2 flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
                            >
                              <span
                                className={cn(
                                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                                  ACTIVITY_ICON_STYLES[activity.type],
                                )}
                              >
                                <Icon className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[13px] font-semibold text-foreground/90">
                                    {activity.subject || activity.type}
                                  </span>
                                  {activity.direction ? (
                                    activity.direction === "INBOUND" ? (
                                      <ArrowDownLeft className="size-3.5 text-success" />
                                    ) : (
                                      <ArrowUpRight className="size-3.5 text-brand" />
                                    )
                                  ) : null}
                                  {activity.ai_generated ? (
                                    <Badge
                                      variant="secondary"
                                      className="gap-1 text-[10px] font-medium"
                                      title="Logged by an AI agent"
                                    >
                                      <Bot className="size-3" />
                                      AI
                                    </Badge>
                                  ) : null}
                                </div>
                                {activity.notes ? (
                                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                                    {activity.notes}
                                  </p>
                                ) : null}
                                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="size-3" />
                                    {timeAgo(activity.created_at)}
                                  </span>
                                  {duration ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Phone className="size-3" />
                                      {duration}
                                    </span>
                                  ) : null}
                                  {agent ? (
                                    <span
                                      className="inline-flex items-center gap-1"
                                      title={`Agent: ${agent}`}
                                    >
                                      <User className="size-3" />
                                      <span className="font-medium text-foreground/80">
                                        {agent}
                                      </span>
                                    </span>
                                  ) : null}
                                  {withName ? (
                                    <span
                                      className="inline-flex items-center gap-1"
                                      title={
                                        withType
                                          ? `${withType}: ${withName}`
                                          : undefined
                                      }
                                    >
                                      <Link2 className="size-3" />
                                      <span>
                                        with{" "}
                                        <span className="font-medium text-foreground/80">
                                          {withName}
                                        </span>
                                        {activity.with_name && withType ? (
                                          <span className="text-muted-foreground">
                                            {" "}
                                            ({withType})
                                          </span>
                                        ) : null}
                                      </span>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-muted-foreground"
                                  aria-label="Edit activity"
                                  onClick={() => setEditActivity(activity)}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-muted-foreground hover:text-danger"
                                  aria-label="Delete activity"
                                  disabled={
                                    deleteActivityMutation.isPending &&
                                    deleteActivityMutation.variables ===
                                      activity.id
                                  }
                                  onClick={() => handleDeleteActivity(activity)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </section>

        {/* Tasks panel */}
        <section
          className="reveal flex min-h-0 flex-col"
          style={{ animationDelay: "120ms" }}
        >
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 gap-3 space-y-0 border-b">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-brand" />
                  Tasks
                </CardTitle>
                <AddTaskDialog />
              </div>
              {/* Quick add, title + Enter, sensible defaults */}
              <div className="relative">
                <Plus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Quick add a task…"
                  className="pl-9"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      quickTitle.trim() &&
                      !quickAddMutation.isPending
                    ) {
                      quickAddMutation.mutate();
                    }
                  }}
                />
              </div>
            </CardHeader>

            <Tabs
              value={taskTab}
              onValueChange={(v) => setTaskTab(v as "OPEN" | "DONE")}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="shrink-0 px-5 pt-4">
                <TabsList className="w-full">
                  <TabsTrigger value="OPEN" className="flex-1 gap-1.5">
                    Open
                    {!openTasksQuery.isLoading && openTasks.length > 0 ? (
                      <span className="text-[10px] font-semibold">
                        {openTasks.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="DONE" className="flex-1">
                    Done
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent
                value={taskTab}
                className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-3"
              >
                {tasksQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="py-12 text-center">
                    <CheckCircle2 className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      {taskTab === "OPEN"
                        ? "No open tasks. Add one above."
                        : "No completed tasks yet."}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {tasks.map((task) => (
                      <TaskRowItem
                        key={task.id}
                        task={task}
                        ownerName={
                          task.owner_id
                            ? userMap.get(task.owner_id)
                            : undefined
                        }
                        completing={completeMutation.isPending}
                        deleting={
                          deleteTaskMutation.isPending &&
                          deleteTaskMutation.variables === task.id
                        }
                        onComplete={(taskId) => completeMutation.mutate(taskId)}
                        onEdit={setEditTask}
                        onDelete={handleDeleteTask}
                      />
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </section>
      </div>

      {/* Log activity dialog */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
            <DialogDescription>
              Record a touchpoint for the team feed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="activities-type">Type</Label>
                <Select
                  value={logForm.type}
                  onValueChange={(v) =>
                    setLogForm({ ...logForm, type: v as ActivityType })
                  }
                >
                  <SelectTrigger id="activities-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Direction</Label>
                <Select
                  value={logForm.direction}
                  onValueChange={(v) =>
                    setLogForm({
                      ...logForm,
                      direction: v as "INBOUND" | "OUTBOUND",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OUTBOUND">OUTBOUND</SelectItem>
                    <SelectItem value="INBOUND">INBOUND</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="log-subject">Subject</Label>
              <Input
                id="log-subject"
                value={logForm.subject}
                onChange={(e) =>
                  setLogForm({ ...logForm, subject: e.target.value })
                }
                placeholder="Discovery call with Acme"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="log-notes">Notes</Label>
              <Textarea
                id="log-notes"
                rows={3}
                value={logForm.notes}
                onChange={(e) =>
                  setLogForm({ ...logForm, notes: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={logMutation.isPending}
              onClick={() => logMutation.mutate()}
            >
              Log activity
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditTaskDialog
        task={editTask}
        onOpenChange={(o) => !o && setEditTask(null)}
      />
      <EditActivityDialog
        activity={editActivity}
        onOpenChange={(o) => !o && setEditActivity(null)}
      />
    </div>
  );
}
