import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  CalendarDays,
  Check,
  CheckSquare,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createReminder,
  deleteReminder,
  getReminderCount,
  listReminders,
  toggleReminder,
  updateReminder,
  type Reminder,
  type ReminderFilter,
  type ReminderPriority,
} from "@/lib/api/reminders";
import {
  completeTask,
  listTasks,
  updateTask,
  type Priority,
} from "@/lib/api/activities";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRIORITY_STYLES: Record<ReminderPriority, string> = {
  HIGH: "text-danger",
  MEDIUM: "text-warning",
  LOW: "text-neutral",
};

const PRIORITIES: ReminderPriority[] = ["LOW", "MEDIUM", "HIGH"];

const TAB_LABELS: Array<{ value: ReminderFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "today", label: "Due today" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

const EMPTY_COPY: Record<ReminderFilter, string> = {
  open: "Nothing open. Add a reminder above to stay on top of your follow-ups.",
  today: "Nothing due today. Enjoy the breathing room.",
  done: "Nothing completed yet. Check items off and they will land here.",
  all: "No reminders yet. Add your first one above.",
};

// Matches the backend's notion of "today" (UTC date string).
const todayStr = (): string => new Date().toISOString().slice(0, 10);

export default function RemindersPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<ReminderFilter>("open");

  const countQuery = useQuery({ queryKey: ["reminders-count"], queryFn: getReminderCount });
  const listQuery = useQuery({
    queryKey: ["reminders", filter],
    queryFn: () => listReminders(filter),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["reminders"] });
    queryClient.invalidateQueries({ queryKey: ["reminders-count"] });
  };

  // ---- Quick add ----
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [priority, setPriority] = React.useState<ReminderPriority>("MEDIUM");

  const createMutation = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      toast.success("Reminder added.");
      setTitle("");
      setDueDate("");
      setPriority("MEDIUM");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const submitQuickAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Give the reminder a title.");
      return;
    }
    createMutation.mutate({
      title: title.trim(),
      priority,
      ...(dueDate ? { dueDate } : {}),
    });
  };

  // ---- Toggle / delete ----
  const toggleMutation = useMutation({
    mutationFn: toggleReminder,
    onSuccess: (updated) => {
      if (updated.status === "DONE") toast.success("Marked done.");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteReminder,
    onSuccess: () => {
      toast.success("Reminder deleted.");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  // ---- Edit dialog ----
  const [editing, setEditing] = React.useState<Reminder | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const [editNote, setEditNote] = React.useState("");
  const [editPriority, setEditPriority] = React.useState<ReminderPriority>("MEDIUM");
  const [editDue, setEditDue] = React.useState("");

  const openEdit = (reminder: Reminder) => {
    setEditing(reminder);
    setEditTitle(reminder.title);
    setEditNote(reminder.note ?? "");
    setEditPriority(reminder.priority);
    setEditDue(reminder.due_date ?? "");
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateReminder>[1] }) =>
      updateReminder(id, payload),
    onSuccess: () => {
      toast.success("Reminder updated.");
      setEditing(null);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const submitEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (!editTitle.trim()) {
      toast.error("The title cannot be empty.");
      return;
    }
    updateMutation.mutate({
      id: editing.id,
      payload: {
        title: editTitle.trim(),
        note: editNote,
        priority: editPriority,
        dueDate: editDue || null,
      },
    });
  };

  // ---- Lead & deal tasks owned by me (with daily-email reminders) ----
  const tasksQuery = useQuery({
    queryKey: ["my-tasks"],
    queryFn: () => listTasks("OPEN", true),
  });
  const refreshTasks = () => queryClient.invalidateQueries({ queryKey: ["my-tasks"] });

  const completeTaskMutation = useMutation({
    mutationFn: completeTask,
    onSuccess: () => {
      toast.success("Task completed. Reminders stopped.");
      refreshTasks();
    },
    onError: (error) => toast.error(error.message),
  });

  const remindMutation = useMutation({
    mutationFn: ({ id, remind }: { id: string; remind: boolean }) =>
      updateTask(id, { remind_daily: remind }),
    onSuccess: (task) => {
      toast.success(
        task.remind_daily
          ? "Daily email reminders on, until this task is done."
          : "Daily email reminders off."
      );
      refreshTasks();
    },
    onError: (error) => toast.error(error.message),
  });

  const counts = countQuery.data;
  const reminders = listQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const today = todayStr();

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Work"
        description="Your reminders, follow-ups and due tasks."
        actions={
          counts ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center text-xs font-medium tabular-nums text-brand">
                {formatNumber(counts.open)} open
              </span>
              <span
                className={cn(
                  "inline-flex items-center text-xs font-medium tabular-nums",
                  counts.dueToday > 0
                    ? "text-danger"
                    : "text-muted-foreground"
                )}
              >
                {formatNumber(counts.dueToday)} due today
              </span>
            </div>
          ) : null
        }
      />

      {/* Quick add */}
      <section className="reveal" style={{ animationDelay: "60ms" }}>
        <Card>
          <CardContent className="pt-5">
            <form onSubmit={submitQuickAdd} className="flex flex-wrap items-center gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a reminder, e.g. Follow up with Acme on the renewal"
                className="min-w-52 flex-1"
              />
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-40"
                aria-label="Due date"
              />
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as ReminderPriority)}
              >
                <SelectTrigger className="w-32" aria-label="Priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={createMutation.isPending}>
                <Plus />
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {/* Tabs + list */}
      <section className="reveal space-y-3" style={{ animationDelay: "120ms" }}>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as ReminderFilter)}>
          <TabsList>
            {TAB_LABELS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {listQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : reminders.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="All clear"
            description={EMPTY_COPY[filter]}
          />
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {reminders.map((reminder) => {
                const isDone = reminder.status === "DONE";
                const isOverdue =
                  !isDone && Boolean(reminder.due_date) && reminder.due_date! < today;
                return (
                  <div
                    key={reminder.id}
                    className="flex items-start gap-3 px-5 py-3.5 transition-colors duration-120 hover:bg-muted/60"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isDone}
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate(reminder.id)}
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-120",
                        isDone
                          ? "border-brand bg-brand text-brand-foreground"
                          : "border-input hover:border-brand"
                      )}
                    >
                      {isDone ? <Check className="size-3.5" /> : null}
                      <span className="sr-only">
                        {isDone ? "Reopen reminder" : "Mark done"}
                      </span>
                    </button>

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          isDone && "text-muted-foreground line-through"
                        )}
                      >
                        {reminder.title}
                      </p>
                      {reminder.note ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{reminder.note}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center text-xs font-medium",
                            PRIORITY_STYLES[reminder.priority]
                          )}
                        >
                          {reminder.priority}
                        </span>
                        {reminder.due_date ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs tabular-nums",
                              isOverdue ? "font-medium text-danger" : "text-muted-foreground"
                            )}
                          >
                            <CalendarDays className="size-3.5" />
                            {formatDate(reminder.due_date)}
                            {isOverdue ? " (overdue)" : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        onClick={() => openEdit(reminder)}
                      >
                        <Pencil />
                        <span className="sr-only">Edit reminder</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-danger"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(reminder.id)}
                      >
                        <Trash2 />
                        <span className="sr-only">Delete reminder</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Lead & deal tasks, with opt-in daily email reminders */}
      <section className="reveal space-y-3" style={{ animationDelay: "180ms" }}>
        <div>
          <h2 className="text-sm font-semibold">Tasks from leads &amp; deals</h2>
          <p className="text-xs text-muted-foreground">
            Follow-ups you created on records. Turn on the{" "}
            <Bell className="inline size-3 -translate-y-px" /> to get a daily
            email until the task is done.
          </p>
        </div>

        {tasksQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="No open tasks"
            description="Tasks you add on a lead or deal show up here, with an option to be reminded daily by email."
          />
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {tasks.map((task) => {
                const isOverdue =
                  Boolean(task.due_at) && task.due_at!.slice(0, 10) < today;
                return (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 px-5 py-3.5 transition-colors duration-120 hover:bg-muted/60"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={false}
                      disabled={completeTaskMutation.isPending}
                      onClick={() => completeTaskMutation.mutate(task.id)}
                      title="Mark done"
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-input transition-colors duration-120 hover:border-brand"
                    >
                      <Check className="size-3.5 opacity-0" />
                      <span className="sr-only">Mark task done</span>
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{task.title}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center text-xs font-medium",
                            PRIORITY_STYLES[task.priority as Priority]
                          )}
                        >
                          {task.priority}
                        </span>
                        {task.due_at ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs tabular-nums",
                              isOverdue
                                ? "font-medium text-danger"
                                : "text-muted-foreground"
                            )}
                          >
                            <CalendarDays className="size-3.5" />
                            {formatDate(task.due_at)}
                            {isOverdue ? " (overdue)" : ""}
                          </span>
                        ) : null}
                        {task.lead_id ? (
                          <Link
                            to={`/leads/${task.lead_id}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                          >
                            <ExternalLink className="size-3.5" />
                            View lead
                          </Link>
                        ) : null}
                        {task.remind_daily ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
                            <Bell className="size-3" />
                            Daily email
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "size-8",
                          task.remind_daily
                            ? "text-brand"
                            : "text-muted-foreground"
                        )}
                        disabled={remindMutation.isPending}
                        onClick={() =>
                          remindMutation.mutate({
                            id: task.id,
                            remind: !task.remind_daily,
                          })
                        }
                        title={
                          task.remind_daily
                            ? "Daily email reminders on, click to turn off"
                            : "Turn on daily email reminders"
                        }
                      >
                        {task.remind_daily ? <Bell /> : <BellOff />}
                        <span className="sr-only">Toggle daily reminders</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit reminder</DialogTitle>
            <DialogDescription>Update the details and save.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-note">Note</Label>
              <Textarea
                id="edit-note"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Optional context"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reminders-priority">Priority</Label>
                <Select
                  value={editPriority}
                  onValueChange={(value) => setEditPriority(value as ReminderPriority)}
                >
                  <SelectTrigger id="reminders-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p.charAt(0) + p.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-due">Due date</Label>
                <Input
                  id="edit-due"
                  type="date"
                  value={editDue}
                  onChange={(e) => setEditDue(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
