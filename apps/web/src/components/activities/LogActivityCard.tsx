import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createTask, logActivity, type ActivityType } from "@/lib/api/activities";

const ACTIVITY_TYPES: ActivityType[] = [
  "CALL",
  "MEETING",
  "DEMO",
  "NOTE",
  "EMAIL",
  "TASK",
];

/**
 * The one "Log activity" control shared by the lead, contact and deal detail
 * views, so the behaviour (including TASK → a real task with optional daily
 * email reminders) stays identical everywhere. Exactly one of leadId / contactId
 * / dealId identifies the record the activity/task is linked to. `onLogged` lets
 * the host refresh its own queries after a successful write.
 */
export function LogActivityCard({
  leadId,
  contactId,
  dealId,
  onLogged,
}: {
  leadId?: string;
  contactId?: string;
  dealId?: string;
  onLogged?: () => void;
}) {
  const queryClient = useQueryClient();
  const dueId = React.useId();
  const remindId = React.useId();
  const [form, setForm] = React.useState({
    type: "CALL" as ActivityType,
    subject: "",
    notes: "",
    dueDate: "",
    remindDaily: false,
  });

  // The record link is passed through verbatim to both createTask and
  // logActivity, so the write lands on the right lead/contact/deal.
  const link = leadId
    ? { lead_id: leadId }
    : contactId
      ? { contact_id: contactId }
      : dealId
        ? { deal_id: dealId }
        : {};

  const logMutation = useMutation({
    mutationFn: async () => {
      // A TASK becomes a real, actionable task (owned by the current agent, with
      // an optional due date + daily email reminders), and still drops a
      // timeline entry so the activity feed reflects it.
      if (form.type === "TASK") {
        const title = form.subject.trim();
        if (!title) throw new Error("Give the task a title in the Subject field.");
        await createTask({
          title,
          ...link,
          ...(form.dueDate ? { due_at: form.dueDate } : {}),
          remind_daily: form.remindDaily,
        });
      }
      return logActivity({
        type: form.type,
        subject: form.subject || undefined,
        notes: form.notes || undefined,
        ...link,
      });
    },
    onSuccess: () => {
      toast.success(form.type === "TASK" ? "Task created" : "Activity logged");
      setForm({ type: "CALL", subject: "", notes: "", dueDate: "", remindDaily: false });
      onLogged?.();
      // Refresh the My Work tasks list so a new reminder task shows up there.
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log activity</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2.5">
        <Select
          value={form.type}
          onValueChange={(v) => setForm({ ...form, type: v as ActivityType })}
        >
          <SelectTrigger>
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
        <Input
          placeholder={form.type === "TASK" ? "Task title" : "Subject"}
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />
        <Textarea
          placeholder="Notes (optional)"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        {form.type === "TASK" ? (
          <div className="space-y-2.5 border-t pt-3">
            <div className="space-y-1.5">
              <Label htmlFor={dueId} className="text-xs">
                Due date (optional)
              </Label>
              <Input
                id={dueId}
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <label
              htmlFor={remindId}
              className="flex items-start justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium">
                  Email me daily until done
                </span>
                <span className="block text-xs text-muted-foreground">
                  A reminder lands in your inbox each day while this task is open.
                </span>
              </span>
              <Switch
                id={remindId}
                checked={form.remindDaily}
                onCheckedChange={(v) => setForm({ ...form, remindDaily: v })}
              />
            </label>
          </div>
        ) : null}
        <Button
          size="sm"
          loading={logMutation.isPending}
          onClick={() => logMutation.mutate()}
        >
          {form.type === "TASK" ? "Create task" : "Log activity"}
        </Button>
      </CardContent>
    </Card>
  );
}
