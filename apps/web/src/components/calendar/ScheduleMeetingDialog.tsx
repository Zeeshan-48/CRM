import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Video, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  connectGoogleCalendar,
  getGoogleCalendarStatus,
  scheduleMeeting,
} from "@/lib/api/calendar";
import { listContacts } from "@/lib/api/contacts";
import { listLeads } from "@/lib/api/leads";
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
import { cn } from "@/lib/utils";

const CONFLICT_RE = /can't schedule then|working day|past the|already has a meeting/i;

// All meetings are online (a Google Meet / video link is generated). Mode and a
// manual join-link field were removed, the link is always created for you.
const DURATIONS = [15, 30, 45, 60] as const;
const DATE_CHIPS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// A friendly pre-fill: about an hour out, rounded up to the next :00 / :30 slot,
// so the common case is "open → adjust time → Schedule".
const defaultStart = (): Date => {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m !== 0 && m !== 30) d.setMinutes(m < 30 ? 30 : 60); // 60 rolls to next hour
  return d;
};

interface FormState {
  title: string;
  date: string;
  time: string;
  duration_min: number;
}
const EMPTY: FormState = { title: "", date: "", time: "", duration_min: 30 };

const chipClass = (active: boolean) =>
  cn(
    "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-brand bg-brand/10 text-brand"
      : "border-border text-muted-foreground hover:bg-muted",
  );

/**
 * One schedule-meeting dialog used everywhere (the calendar page + lead/contact
 * detail). When `leadId`/`contactId` are passed, the meeting is LINKED to that
 * record and the backend sends an invite (email + WhatsApp) on save.
 */
export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  leadId,
  contactId,
  defaultTitle,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string;
  contactId?: string;
  defaultTitle?: string;
  onScheduled?: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [conflict, setConflict] = React.useState<string | null>(null);
  // When the dialog isn't opened from a lead/contact page, let the user link one
  // here so the meeting still sends an invite. `prelinked` hides the picker.
  const prelinked = !!(leadId || contactId);
  const [search, setSearch] = React.useState("");
  const [picked, setPicked] = React.useState<{ type: "lead" | "contact"; id: string; name: string } | null>(null);

  const effLeadId = leadId ?? (picked?.type === "lead" ? picked.id : undefined);
  const effContactId = contactId ?? (picked?.type === "contact" ? picked.id : undefined);
  const isLinked = !!(effLeadId || effContactId);

  // Whether THIS user has connected Google Calendar. Drives the "connect for a
  // real Meet link" prompt and the auto-generate hint.
  const googleStatusQuery = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: getGoogleCalendarStatus,
    enabled: open,
    staleTime: 60_000,
  });
  const google = googleStatusQuery.data;
  const googleConnected = !!google?.connected;
  // Server has the integration configured but this user hasn't linked their account.
  const canConnectMeet = !!google?.available && !googleConnected;

  const [connecting, setConnecting] = React.useState(false);
  const startConnect = async () => {
    try {
      setConnecting(true);
      const { url } = await connectGoogleCalendar();
      // Full redirect to Google's consent screen; returns to the calendar page.
      window.location.href = url;
    } catch {
      setConnecting(false);
      toast.error("Couldn't start the Google Calendar connection.");
    }
  };

  // Reset (with a friendly default date/time) whenever the dialog opens.
  React.useEffect(() => {
    if (open) {
      const d = defaultStart();
      setForm({ title: defaultTitle ?? "", date: toDateValue(d), time: toTimeValue(d), duration_min: 30 });
      setConflict(null);
      setSearch("");
      setPicked(null);
    }
  }, [open, defaultTitle]);

  const applyQuickDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setForm((f) => ({ ...f, date: toDateValue(d) }));
  };
  const isQuickDateActive = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return form.date === toDateValue(d);
  };

  // Search leads + contacts to link (only on the calendar page, when not pre-linked).
  const searchQuery = useQuery({
    queryKey: ["meeting-link-search", search],
    queryFn: async () => {
      const [leadsRes, contacts] = await Promise.all([
        listLeads({ q: search, limit: 5 }),
        listContacts({ q: search }),
      ]);
      return { leads: leadsRes.leads.slice(0, 5), contacts: contacts.slice(0, 5) };
    },
    enabled: open && !prelinked && !picked && search.trim().length >= 2,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (force: boolean) =>
      scheduleMeeting({
        title: form.title.trim(),
        start_at: new Date(`${form.date}T${form.time}`).toISOString(),
        duration_min: form.duration_min,
        lead_id: effLeadId,
        contact_id: effContactId,
        force,
      }),
    onSuccess: (meeting) => {
      // Report what actually happened with the video link so the user knows
      // whether a real Meet link was created.
      const linkedSuffix = isLinked ? ", invite sent" : "";
      const sync = meeting.googleSync;
      if (sync === "MEET_CREATED") {
        toast.success(
          `"${meeting.title}" scheduled, Google Meet link ${isLinked ? "sent" : "ready"}`
        );
      } else if (sync === "NOT_CONNECTED" || sync === "DISABLED") {
        toast.success(`"${meeting.title}" scheduled${linkedSuffix}`, {
          description: "Used a fallback video link. Connect Google Calendar for a real Meet link.",
        });
      } else if (sync === "FAILED") {
        toast.success(`"${meeting.title}" scheduled${linkedSuffix}`, {
          description: "Couldn't reach Google Calendar, used a fallback link.",
        });
      } else {
        toast.success(`"${meeting.title}" scheduled${linkedSuffix}`);
      }
      onOpenChange(false);
      setConflict(null);
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-reminders"] });
      if (effLeadId) queryClient.invalidateQueries({ queryKey: ["lead", effLeadId] });
      if (effContactId) queryClient.invalidateQueries({ queryKey: ["contact", effContactId] });
      onScheduled?.();
    },
    onError: (error: Error) => {
      // Availability guardrail → surface inline with a "Book anyway" override.
      if (CONFLICT_RE.test(error.message)) setConflict(error.message);
      else toast.error(error.message);
    },
  });

  const canSubmit = !!form.title.trim() && !!form.date && !!form.time;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setConflict(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-brand" />
            Schedule meeting
          </DialogTitle>
          <DialogDescription>
            {isLinked
              ? "Creates the meeting, blocks your calendar, and emails/WhatsApps the invite with a video link."
              : "Link a lead or contact to also send them the invite."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="sm-title">Title</Label>
            <Input
              id="sm-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Demo with Acme"
            />
          </div>

          {/* Link to a lead/contact (calendar page only) → enables the invite. */}
          {!prelinked ? (
            <div className="grid gap-1.5">
              <Label>
                Link to lead/contact{" "}
                {!isLinked ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    (optional, enables the invite)
                  </span>
                ) : null}
              </Label>
              {picked ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="capitalize text-muted-foreground">{picked.type}:</span>{" "}
                    {picked.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPicked(null)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Clear link"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search a lead or contact by name…"
                  />
                  {search.trim().length >= 2 ? (
                    <div className="max-h-40 overflow-y-auto rounded-md border">
                      {searchQuery.isLoading ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                      ) : searchQuery.data &&
                        (searchQuery.data.leads.length > 0 ||
                          searchQuery.data.contacts.length > 0) ? (
                        <ul className="text-sm">
                          {searchQuery.data.leads.map((l) => (
                            <li key={`l-${l.id}`}>
                              <button
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted"
                                onClick={() => setPicked({ type: "lead", id: l.id, name: l.name })}
                              >
                                <span className="min-w-0 truncate">{l.name}</span>
                                <span className="ml-2 shrink-0 text-xs text-muted-foreground">Lead</span>
                              </button>
                            </li>
                          ))}
                          {searchQuery.data.contacts.map((c) => (
                            <li key={`c-${c.id}`}>
                              <button
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted"
                                onClick={() => setPicked({ type: "contact", id: c.id, name: c.name })}
                              >
                                <span className="min-w-0 truncate">{c.name}</span>
                                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                                  Contact
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-3 py-2 text-xs text-muted-foreground">No matches.</p>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {/* When, quick day chips + native date/time pickers. */}
          <div className="grid gap-2">
            <Label>When</Label>
            <div className="flex flex-wrap gap-1.5">
              {DATE_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className={chipClass(isQuickDateActive(c.days))}
                  onClick={() => applyQuickDate(c.days)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="sm-date"
                type="date"
                aria-label="Date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
              <Input
                id="sm-time"
                type="time"
                aria-label="Time"
                step={300}
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </div>
          </div>

          {/* Duration, quick chips. */}
          <div className="grid gap-2">
            <Label>Duration</Label>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={chipClass(form.duration_min === d)}
                  onClick={() => setForm((f) => ({ ...f, duration_min: d }))}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {/* Video-link status: reassurance when connected, prompt when not. */}
          {googleConnected ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Video className="size-3.5 shrink-0 text-success" />
              A Google Meet link will be created automatically and added to your calendar.
            </p>
          ) : canConnectMeet ? (
            <div className="rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Connect Google Calendar to auto-create a real{" "}
                <span className="font-medium text-foreground">Google Meet</span> link and block your
                calendar. Otherwise a fallback video link is used.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                loading={connecting}
                onClick={startConnect}
              >
                Connect Google Calendar
              </Button>
            </div>
          ) : null}

          {conflict ? (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              {conflict} You can book it anyway.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {conflict ? (
            <Button
              variant="outline"
              loading={mutation.isPending}
              onClick={() => mutation.mutate(true)}
            >
              Book anyway
            </Button>
          ) : null}
          <Button
            loading={mutation.isPending}
            disabled={!canSubmit}
            onClick={() => {
              setConflict(null);
              mutation.mutate(false);
            }}
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
