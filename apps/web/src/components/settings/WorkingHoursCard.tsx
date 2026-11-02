import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  getWorkingHours,
  updateWorkingHours,
  type WorkingHours,
} from "@/lib/api/calendar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DEFAULT_HOURS: WorkingHours = {
  timezone: "Asia/Kolkata",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
};

/**
 * Workspace-wide working hours. One source of truth (tenants.config.scheduling)
 * consumed across the CRM, meeting scheduling, public booking links and the
 * sales agent's automation all read these. Admin-only to change.
 */
export function WorkingHoursCard({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["working-hours"],
    queryFn: getWorkingHours,
  });

  const [form, setForm] = React.useState<WorkingHours>(DEFAULT_HOURS);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (!data) return;
    setForm({ ...data });
    setDirty(false);
  }, [data]);

  const save = useMutation({
    mutationFn: () => updateWorkingHours(form),
    onSuccess: () => {
      toast.success("Working hours saved");
      // Anything that reads the workspace hours should refresh.
      queryClient.invalidateQueries({ queryKey: ["working-hours"] });
      queryClient.invalidateQueries({ queryKey: ["sales-settings"] });
      setDirty(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleDay = (d: number) => {
    const days = form.days.includes(d)
      ? form.days.filter((x) => x !== d)
      : [...form.days, d].sort((a, b) => a - b);
    setForm({ ...form, days });
    setDirty(true);
  };

  const patch = (next: Partial<WorkingHours>) => {
    setForm({ ...form, ...next });
    setDirty(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4 text-brand" />
          Working hours
        </CardTitle>
        <CardDescription>
          When your workspace is open. Used across the CRM, meeting booking,
          booking links and the sales agent all respect these hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label>Working days</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_LABELS.map((label, d) => (
                  <Button
                    key={d}
                    type="button"
                    size="sm"
                    disabled={!canEdit}
                    variant={form.days.includes(d) ? "default" : "outline"}
                    onClick={() => toggleDay(d)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="wh-start">Opens</Label>
                <Input
                  id="wh-start"
                  type="time"
                  value={form.start}
                  disabled={!canEdit}
                  onChange={(e) => patch({ start: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wh-end">Closes</Label>
                <Input
                  id="wh-end"
                  type="time"
                  value={form.end}
                  disabled={!canEdit}
                  onChange={(e) => patch({ end: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wh-tz">Timezone</Label>
                <Input
                  id="wh-tz"
                  value={form.timezone}
                  disabled={!canEdit}
                  onChange={(e) => patch({ timezone: e.target.value })}
                  placeholder="Asia/Kolkata"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Timezone uses IANA names, e.g. Asia/Kolkata, America/New_York.
            </p>

            {canEdit ? (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => save.mutate()}
                  disabled={!dirty || form.days.length === 0 || save.isPending}
                  loading={save.isPending}
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Only an admin can change working hours.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
