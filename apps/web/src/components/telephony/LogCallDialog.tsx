import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NotebookPen } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { logManualCall, MANUAL_CALL_OUTCOMES } from "@/lib/api/telephony";

const OUTCOME_LABELS: Record<string, string> = {
  CONNECTED: "Connected",
  NOT_ANSWERED: "Not answered",
  CALLBACK_REQUESTED: "Callback requested",
  NOT_INTERESTED: "Not interested",
  QUALIFIED: "Qualified",
};

// For calls an agent dialed from their personal SIM. Those never touch the
// telephony provider, so there is no recording or metadata to capture, but
// the outcome and notes still belong on the lead's story, and logging them
// here keeps the timeline honest.
export function LogCallDialog({
  leadId,
  contactId,
  disabled,
}: {
  leadId?: string;
  contactId?: string;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [minutes, setMinutes] = React.useState("");
  const [outcome, setOutcome] = React.useState<string>("CONNECTED");
  const [notes, setNotes] = React.useState("");

  const mutation = useMutation({
    mutationFn: () =>
      logManualCall({
        leadId,
        contactId,
        durationSec: Math.max(0, Math.round(Number(minutes || 0) * 60)),
        outcome,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Call logged.");
      setOpen(false);
      setMinutes("");
      setNotes("");
      setOutcome("CONNECTED");
      if (leadId) queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      if (contactId) queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["telephony-calls"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not log the call."),
  });

  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <NotebookPen className="size-4" />
        Log call
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log a call</DialogTitle>
            <DialogDescription>
              For calls made from your own phone. No recording is attached; the outcome
              and notes land on the timeline for the next person who picks this up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="log-mins">Duration (minutes)</Label>
                <Input
                  id="log-mins"
                  type="number"
                  min="0"
                  step="1"
                  value={minutes}
                  placeholder="5"
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logcalldialog-outcome">Outcome</Label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger id="logcalldialog-outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MANUAL_CALL_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {OUTCOME_LABELS[o] ?? o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-notes">Notes</Label>
              <Textarea
                id="log-notes"
                value={notes}
                rows={3}
                placeholder="What was discussed, what was pitched, what happens next…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Log call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
