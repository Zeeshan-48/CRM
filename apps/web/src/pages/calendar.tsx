import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  CalendarCheck2,
  CalendarPlus,
  CalendarDays,
  CalendarRange,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Send,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  cancelMeeting,
  connectGoogleCalendar,
  createMyBookingLink,
  deleteMeeting,
  disconnectGoogleCalendar,
  getMyBookingLink,
  getWorkingHours,
  listMeetings,
  listProviders,
  listReminders,
  resyncMeeting,
  shareMyBookingLink,
  updateMyBookingLink,
  type MeetingWithName,
} from "@/lib/api/calendar";
import { Link } from "react-router-dom";

import { listContacts } from "@/lib/api/contacts";
import { listLeads } from "@/lib/api/leads";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BrandLogo, hasBrandLogo } from "@/components/brand/BrandLogo";
import { ScheduleMeetingDialog } from "@/components/calendar/ScheduleMeetingDialog";
import { useConfirm } from "@/components/confirm-provider";
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
import { Spinner, SpinnerOverlay } from "@/components/ui/spinner";
import { listUsers } from "@/lib/api/users";
import { useAuthStore } from "@/stores/auth-store";

const OWNER_ALL = "__all__";

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "text-brand",
  CANCELLED: "text-danger",
  COMPLETED: "text-success",
};

interface MeetingGroups {
  today: MeetingWithName[];
  thisWeek: MeetingWithName[];
  later: MeetingWithName[];
  past: MeetingWithName[];
}

const groupMeetings = (meetings: MeetingWithName[]): MeetingGroups => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const groups: MeetingGroups = {
    today: [],
    thisWeek: [],
    later: [],
    past: [],
  };
  for (const meeting of meetings) {
    const start = new Date(meeting.start_at);
    if (start < startOfToday) groups.past.push(meeting);
    else if (start < endOfToday) groups.today.push(meeting);
    else if (start < endOfWeek) groups.thisWeek.push(meeting);
    else groups.later.push(meeting);
  }
  // Most recent past meetings first.
  groups.past.sort(
    (a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime(),
  );
  return groups;
};

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center text-brand">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold leading-none tabular-nums">
            {value}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MeetingRow({
  meeting,
  onCancel,
  onDelete,
  onCopyLink,
  onSync,
  busy,
}: {
  meeting: MeetingWithName;
  onCancel: (id: string) => void;
  onDelete: (meeting: MeetingWithName) => void;
  onCopyLink: (url: string) => void;
  onSync: (id: string) => void;
  busy: boolean;
}) {
  const cancelled = meeting.status === "CANCELLED";
  // The joinable video URL (Google Meet / Jitsi) for online meetings.
  const joinLink =
    !cancelled &&
    meeting.mode === "ONLINE" &&
    /^https?:\/\//.test(meeting.location ?? "")
      ? (meeting.location as string)
      : null;
  return (
    <li className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            cancelled
              ? "bg-muted text-muted-foreground"
              : "bg-brand/10 text-brand",
          )}
        >
          {meeting.mode === "ONLINE" ? (
            <Video className="size-4" />
          ) : (
            <MapPin className="size-4" />
          )}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-sm font-medium",
              cancelled && "text-muted-foreground line-through",
            )}
          >
            {meeting.title}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
            <span>{formatDateTime(meeting.start_at)}</span>
            <span className="text-muted-foreground">&middot;</span>
            <span>{meeting.duration_min} min</span>
            {meeting.with_name ? (
              <>
                <span className="text-muted-foreground">&middot;</span>
                <span className="truncate">with {meeting.with_name}</span>
              </>
            ) : null}
            {meeting.external_provider === "GOOGLE" ? (
              <>
                <span className="text-muted-foreground">&middot;</span>
                <span className="inline-flex items-center gap-1 text-success">
                  <CalendarCheck2 className="size-3" />
                  {meeting.mode === "ONLINE" ? "Google Meet" : "Google Calendar"}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Join / copy live in a fixed-width slot so the status badges below
            line up in a single column across every row. */}
        <div className="flex w-[104px] items-center justify-end gap-1">
          {joinLink ? (
            <>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-brand hover:text-brand"
              >
                <a href={joinLink} target="_blank" rel="noreferrer">
                  <Video className="size-3.5" />
                  Join
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-brand"
                aria-label={`Copy meeting link for ${meeting.title}`}
                title="Copy meeting link"
                onClick={() => onCopyLink(joinLink)}
              >
                <Copy className="size-3.5" />
              </Button>
            </>
          ) : null}
        </div>
        <Badge
          className={cn(
            "w-[96px] justify-center",
            STATUS_STYLES[meeting.status] ?? "text-muted-foreground",
          )}
        >
          {meeting.status}
        </Badge>
        {/* Actions stay subtle until the row is hovered/focused. */}
        <div className="flex w-[88px] items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {/* Retroactively create a Google Meet link, only for online meetings
              that haven't been synced yet. */}
          {meeting.status === "SCHEDULED" &&
          meeting.mode === "ONLINE" &&
          meeting.external_provider !== "GOOGLE" ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-brand"
              aria-label={`Create a Google Meet link for ${meeting.title}`}
              title="Create Google Meet link"
              disabled={busy}
              onClick={() => onSync(meeting.id)}
            >
              <CalendarPlus className="size-4" />
            </Button>
          ) : null}
          {meeting.status === "SCHEDULED" ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label={`Cancel ${meeting.title}`}
              title="Cancel (keep record)"
              disabled={busy}
              onClick={() => onCancel(meeting.id)}
            >
              <X className="size-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${meeting.title}`}
            title="Delete permanently"
            disabled={busy}
            onClick={() => onDelete(meeting)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Working hours are a WORKSPACE-WIDE setting owned by the Settings page. Shown
// here read-only because they gate what can be booked on this page.
function WorkingHoursCard() {
  const query = useQuery({
    queryKey: ["working-hours"],
    queryFn: getWorkingHours,
  });
  const wh = query.data;

  return (
    <section className="reveal" style={{ animationDelay: "260ms" }}>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-brand" />
            Working hours
          </CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings">Change in Settings</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {query.isLoading || !wh ? (
            <div className="flex justify-center py-3">
              <Spinner
                size="md"
                className="text-brand"
                label="Loading working hours"
              />
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="font-medium tabular-nums">
                {wh.start}-{wh.end}
              </p>
              <p className="text-xs text-muted-foreground">
                {wh.days.map((d) => DAY_LABELS[d]).join(", ")} · {wh.timezone}
              </p>
              <p className="text-xs text-muted-foreground">
                Applies to booking, booking links and the sales agent.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  // Single per-agent booking link: create / edit / share dialogs.
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [linkForm, setLinkForm] = React.useState({ name: "", duration_min: "30" });

  // Share dialog: search leads/contacts and collect a multi-select audience.
  const [shareSearch, setShareSearch] = React.useState("");
  const [sharePicked, setSharePicked] = React.useState<
    { type: "lead" | "contact"; id: string; name: string }[]
  >([]);

  const shareSearchQuery = useQuery({
    queryKey: ["booking-share-search", shareSearch],
    queryFn: async () => {
      const [leadsRes, contacts] = await Promise.all([
        listLeads({ q: shareSearch, limit: 6 }),
        listContacts({ q: shareSearch }),
      ]);
      return {
        leads: leadsRes.leads.slice(0, 6),
        contacts: contacts.slice(0, 6),
      };
    },
    enabled: shareOpen && shareSearch.trim().length >= 2,
    staleTime: 30_000,
  });

  const currentUserId = useAuthStore((s) => s.user?.id);
  const [ownerFilter, setOwnerFilter] = React.useState<string>("");
  const meetingsQuery = useQuery({
    queryKey: ["meetings", ownerFilter],
    queryFn: () => listMeetings({ owner: ownerFilter || undefined }),
  });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const remindersQuery = useQuery({
    queryKey: ["calendar-reminders"],
    queryFn: listReminders,
  });
  const myLinkQuery = useQuery({
    queryKey: ["my-booking-link"],
    queryFn: getMyBookingLink,
  });
  const myLink = myLinkQuery.data ?? null;
  const providersQuery = useQuery({
    queryKey: ["calendar-providers"],
    queryFn: listProviders,
  });

  // Kick off the Google OAuth consent flow: the server returns a consent URL and
  // we hand the browser off to Google. It redirects back to ?calendar=connected.
  const connectGoogleMutation = useMutation({
    mutationFn: connectGoogleCalendar,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: disconnectGoogleCalendar,
    onSuccess: () => {
      toast.success("Google Calendar disconnected");
      queryClient.invalidateQueries({ queryKey: ["calendar-providers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Toast + refresh after returning from Google's consent screen, then strip the
  // query param so a refresh doesn't re-toast.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (result === "connected") {
      toast.success("Google Calendar connected");
      queryClient.invalidateQueries({ queryKey: ["calendar-providers"] });
    } else if (result === "error") {
      toast.error("Couldn't connect Google Calendar. Please try again.");
    }
    if (result) {
      params.delete("calendar");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`,
      );
    }
  }, [queryClient]);

  const cancelMutation = useMutation({
    mutationFn: cancelMeeting,
    onSuccess: (meeting) => {
      toast.success(`"${meeting.title}" cancelled`);
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-reminders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMeeting(id),
    onSuccess: () => {
      toast.success("Meeting deleted");
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-reminders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleDelete = async (meeting: MeetingWithName) => {
    const ok = await confirm({
      title: "Delete meeting?",
      description: `"${meeting.title}" will be removed permanently. This can't be undone.`,
      confirmText: "Delete",
      destructive: true,
    });
    if (ok) deleteMutation.mutate(meeting.id);
  };

  // Retroactively create the Google event + Meet link for a meeting booked
  // before the owner connected Google. The backend reports the outcome so we
  // can distinguish "connect first" from a genuine failure.
  const syncMutation = useMutation({
    mutationFn: (id: string) => resyncMeeting(id),
    onSuccess: (meeting) => {
      if (meeting.googleSync === "MEET_CREATED") {
        toast.success(`Google Meet link created for "${meeting.title}"`);
      } else if (meeting.googleSync === "EVENT_CREATED") {
        toast.success(`"${meeting.title}" added to Google Calendar`);
      } else if (meeting.googleSync === "NOT_CONNECTED" || meeting.googleSync === "DISABLED") {
        toast.warning("Connect Google Calendar first to create a Meet link.");
      } else {
        toast.error("Couldn't sync to Google Calendar. Please try again.");
      }
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-reminders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const handleSync = (id: string) => syncMutation.mutate(id);

  const createMutation = useMutation({
    mutationFn: () =>
      createMyBookingLink({
        name: linkForm.name.trim() || undefined,
        duration_min: Number(linkForm.duration_min) || 30,
      }),
    onSuccess: (link) => {
      toast.success(
        link.alreadyExisted
          ? "You already have a booking link"
          : "Booking link created",
      );
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["my-booking-link"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      updateMyBookingLink({
        name: linkForm.name.trim(),
        duration_min: Number(linkForm.duration_min) || 30,
      }),
    onSuccess: () => {
      toast.success("Booking link updated");
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: ["my-booking-link"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const shareMutation = useMutation({
    mutationFn: () =>
      shareMyBookingLink({
        leadIds: sharePicked.filter((p) => p.type === "lead").map((p) => p.id),
        contactIds: sharePicked
          .filter((p) => p.type === "contact")
          .map((p) => p.id),
      }),
    onSuccess: (res) => {
      if (res.sent === res.total) {
        toast.success(
          `Booking link sent to ${res.sent} ${res.total === 1 ? "person" : "people"}`,
        );
      } else {
        toast.warning(
          `Sent to ${res.sent} of ${res.total}, ${res.total - res.sent} had no email on file`,
        );
      }
      setShareOpen(false);
      setSharePicked([]);
      setShareSearch("");
      queryClient.invalidateQueries({ queryKey: ["my-booking-link"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Open the create dialog with fresh defaults.
  const openCreate = () => {
    setLinkForm({ name: "", duration_min: "30" });
    setCreateOpen(true);
  };
  // Open the edit dialog seeded from the existing link.
  const openEdit = () => {
    if (!myLink) return;
    setLinkForm({ name: myLink.name, duration_min: String(myLink.duration_min) });
    setEditOpen(true);
  };

  const isPicked = (type: "lead" | "contact", id: string) =>
    sharePicked.some((x) => x.type === type && x.id === id);
  const togglePick = (p: { type: "lead" | "contact"; id: string; name: string }) =>
    setSharePicked((prev) =>
      prev.some((x) => x.type === p.type && x.id === p.id)
        ? prev.filter((x) => !(x.type === p.type && x.id === p.id))
        : [...prev, p],
    );

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const meetings = meetingsQuery.data ?? [];
  const groups = groupMeetings(meetings);
  const upcomingCount = meetings.filter(
    (m) =>
      m.status === "SCHEDULED" && new Date(m.start_at).getTime() >= Date.now(),
  ).length;
  const handleCancel = (id: string) => cancelMutation.mutate(id);

  const groupSections: Array<{ label: string; items: MeetingWithName[] }> = [
    { label: "Today", items: groups.today },
    { label: "This week", items: groups.thisWeek },
    { label: "Later", items: groups.later },
    { label: "Past", items: groups.past.slice(0, 8) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        description="Meetings, follow-ups and scheduled work in one view."
        actions={
          <Button size="sm" onClick={() => setScheduleOpen(true)}>
            <Plus className="size-4" />
            Schedule meeting
          </Button>
        }
      />

      {/* At-a-glance stats (real counts) */}
      <div
        className="reveal grid grid-cols-2 gap-3 sm:grid-cols-4"
        style={{ animationDelay: "30ms" }}
      >
        <StatTile
          label="Today"
          value={groups.today.length}
          icon={CalendarDays}
        />
        <StatTile
          label="This week"
          value={groups.thisWeek.length}
          icon={CalendarRange}
        />
        <StatTile label="Upcoming" value={upcomingCount} icon={Clock} />
        <StatTile
          label="Total meetings"
          value={meetings.length}
          icon={CalendarCheck2}
        />
      </div>

      {/* Set-up row, connect a calendar and create a booking link first.
          These two configure how meetings are created, so they lead the page. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        {/* Google Calendar sync, highlighted; connect this first so meetings
            auto-create a Google Meet link and land on your calendar. */}
        <section className="reveal" style={{ animationDelay: "60ms" }}>
          <Card className="h-full">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <CalendarCheck2 className="size-4 text-brand" />
                Calendar sync
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Connect Google to auto-create Meet links and push meetings to
                your calendar.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {providersQuery.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner
                    size="md"
                    className="text-brand"
                    label="Loading providers"
                  />
                </div>
              ) : (
                (providersQuery.data ?? []).map((provider) => {
                  const isGoogle = provider.key === "google";
                  const canConnect = isGoogle && provider.available;
                  return (
                    <div
                      key={provider.key}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {hasBrandLogo(provider.key) ? (
                          <BrandLogo brand={provider.key} size={32} />
                        ) : (
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              provider.connected
                                ? "bg-success"
                                : "bg-muted-foreground/40",
                            )}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            {provider.name}
                            {hasBrandLogo(provider.key) ? (
                              <span
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full",
                                  provider.connected
                                    ? "bg-success"
                                    : "bg-muted-foreground/40",
                                )}
                              />
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {provider.connected
                              ? (provider.email ?? "Connected")
                              : provider.note}
                          </p>
                        </div>
                      </div>
                      {canConnect ? (
                        provider.connected ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            loading={disconnectGoogleMutation.isPending}
                            onClick={() => disconnectGoogleMutation.mutate()}
                          >
                            Disconnect
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="shrink-0"
                            loading={connectGoogleMutation.isPending}
                            onClick={() => connectGoogleMutation.mutate()}
                          >
                            Connect
                          </Button>
                        )
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {provider.connected ? "Connected" : provider.note}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>

        {/* My booking link, one reusable link the agent shares with everyone */}
        <section className="reveal" style={{ animationDelay: "120ms" }}>
          <Card className="h-full">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <Link2 className="size-4 text-brand" />
                My booking link
              </CardTitle>
              {myLink ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-muted-foreground"
                  onClick={openEdit}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {myLinkQuery.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner
                    size="md"
                    className="text-brand"
                    label="Loading booking link"
                  />
                </div>
              ) : !myLink ? (
                <div className="rounded-lg border border-dashed py-8 text-center">
                  <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                    Create one reusable link and share it with any lead or
                    contact. They pick an open slot; once a slot is taken,
                    nobody else can book it.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    loading={createMutation.isPending}
                    onClick={openCreate}
                  >
                    <Plus className="size-4" />
                    Create my booking link
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center text-brand">
                      <Link2 className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {myLink.name}
                      </p>
                      <p className="truncate text-xs tabular-nums text-muted-foreground">
                        {myLink.duration_min} min
                        <span className="px-1">&middot;</span>
                        {formatNumber(myLink.bookings)} bookings
                      </p>
                    </div>
                  </div>

                  {/* The shareable URL, with quick copy + open. */}
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {myLink.url.replace(/^https?:\/\//, "")}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-brand"
                      aria-label="Copy booking link"
                      title="Copy link"
                      onClick={() => copyUrl(myLink.url)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-brand"
                      title="Open booking page"
                    >
                      <a
                        href={myLink.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open booking page"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => setShareOpen(true)}
                  >
                    <Send className="size-4" />
                    Share with leads / contacts
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* Main column, the meetings list */}
        <div className="space-y-4 lg:col-span-2">
          {/* Meetings list */}
          <section className="reveal" style={{ animationDelay: "160ms" }}>
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck2 className="size-4 text-brand" />
                  Meetings
                </CardTitle>
                <div className="flex items-center gap-2">
                  {upcomingCount > 0 ? (
                    <Badge variant="secondary" className="font-normal">
                      {upcomingCount} upcoming
                    </Badge>
                  ) : null}
                  <Select
                    value={ownerFilter || OWNER_ALL}
                    onValueChange={(v) =>
                      setOwnerFilter(v === OWNER_ALL ? "" : v)
                    }
                  >
                    <SelectTrigger className="h-8 w-[150px]">
                      <SelectValue placeholder="All owners" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OWNER_ALL}>All owners</SelectItem>
                      {currentUserId ? (
                        <SelectItem value={currentUserId}>My meetings</SelectItem>
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
                </div>
              </CardHeader>
              <CardContent>
                {meetingsQuery.isLoading ? (
                  <SpinnerOverlay label="Loading meetings" className="py-16" />
                ) : meetings.length === 0 ? (
                  <EmptyState
                    icon={CalendarDays}
                    title="No meetings yet"
                    description="Schedule your first meeting or share a booking link."
                    className="border-0 py-10"
                    action={
                      <Button size="sm" onClick={() => setScheduleOpen(true)}>
                        <Plus className="size-4" />
                        Schedule meeting
                      </Button>
                    }
                  />
                ) : (
                  <div className="max-h-[30rem] space-y-5 overflow-y-auto pr-1">
                    {groupSections.map((group) =>
                      group.items.length === 0 ? null : (
                        <div key={group.label}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.label}
                            <span className="ml-1.5 tabular-nums">
                              {group.items.length}
                            </span>
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {group.items.map((meeting) => (
                              <MeetingRow
                                key={meeting.id}
                                meeting={meeting}
                                onCancel={handleCancel}
                                onDelete={handleDelete}
                                onCopyLink={copyUrl}
                                onSync={handleSync}
                                busy={
                                  cancelMutation.isPending ||
                                  deleteMutation.isPending ||
                                  syncMutation.isPending
                                }
                              />
                            ))}
                          </ul>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Reminders */}
          <section className="reveal" style={{ animationDelay: "120ms" }}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlarmClock className="size-4 text-brand" />
                  Reminders (next 7 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {remindersQuery.isLoading ? (
                  <div className="flex justify-center py-6">
                    <Spinner
                      size="md"
                      className="text-brand"
                      label="Loading reminders"
                    />
                  </div>
                ) : (remindersQuery.data ?? []).length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Nothing coming up this week.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {(remindersQuery.data ?? []).map((reminder) => (
                      <li key={reminder.id} className="py-2.5">
                        <p className="text-sm font-medium">{reminder.title}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {formatDateTime(
                            reminder.reminder_at ?? reminder.start_at,
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Working hours */}
          <WorkingHoursCard />
        </div>
      </div>

      {/* Schedule dialog (shared with lead/contact pages) */}
      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
      />

      {/* Create booking link dialog (one-time) */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create your booking link</DialogTitle>
            <DialogDescription>
              One reusable link you share with any lead or contact. You can
              rename it or change the duration later, the link URL never
              changes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bl-name">Name</Label>
              <Input
                id="bl-name"
                value={linkForm.name}
                onChange={(e) =>
                  setLinkForm({ ...linkForm, name: e.target.value })
                }
                placeholder="Book a meeting"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bl-duration">Duration (min)</Label>
              <Input
                id="bl-duration"
                type="number"
                min="5"
                step="5"
                value={linkForm.duration_min}
                onChange={(e) =>
                  setLinkForm({ ...linkForm, duration_min: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit booking link dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit booking link</DialogTitle>
            <DialogDescription>
              The public URL stays the same, so anything you've already shared
              keeps working.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bl-edit-name">Name</Label>
              <Input
                id="bl-edit-name"
                value={linkForm.name}
                onChange={(e) =>
                  setLinkForm({ ...linkForm, name: e.target.value })
                }
                placeholder="Book a meeting"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bl-edit-duration">Duration (min)</Label>
              <Input
                id="bl-edit-duration"
                type="number"
                min="5"
                step="5"
                value={linkForm.duration_min}
                onChange={(e) =>
                  setLinkForm({ ...linkForm, duration_min: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={editMutation.isPending}
              disabled={!linkForm.name.trim()}
              onClick={() => editMutation.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share booking link dialog, multi-select leads/contacts */}
      <Dialog
        open={shareOpen}
        onOpenChange={(o) => {
          setShareOpen(o);
          if (!o) {
            setShareSearch("");
            setSharePicked([]);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Share your booking link</DialogTitle>
            <DialogDescription>
              Send your link by email (and WhatsApp) to everyone you pick. Each
              gets a personalised invite to grab a time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {/* Selected audience chips */}
            {sharePicked.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {sharePicked.map((p) => (
                  <span
                    key={`${p.type}-${p.id}`}
                    className="inline-flex items-center gap-1 text-xs text-brand"
                  >
                    {p.name}
                    <button
                      type="button"
                      onClick={() => togglePick(p)}
                      className="rounded-sm p-0.5 hover:bg-muted"
                      aria-label={`Remove ${p.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Input
                value={shareSearch}
                onChange={(e) => setShareSearch(e.target.value)}
                placeholder="Search leads or contacts by name…"
              />
              {shareSearch.trim().length >= 2 ? (
                <div className="max-h-52 overflow-y-auto rounded-md border">
                  {shareSearchQuery.isLoading ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Searching…
                    </p>
                  ) : shareSearchQuery.data &&
                    (shareSearchQuery.data.leads.length > 0 ||
                      shareSearchQuery.data.contacts.length > 0) ? (
                    <ul className="text-sm">
                      {[
                        ...shareSearchQuery.data.leads.map((l) => ({
                          type: "lead" as const,
                          id: l.id,
                          name: l.name,
                        })),
                        ...shareSearchQuery.data.contacts.map((c) => ({
                          type: "contact" as const,
                          id: c.id,
                          name: c.name,
                        })),
                      ].map((item) => {
                        const picked = isPicked(item.type, item.id);
                        return (
                          <li key={`${item.type}-${item.id}`}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted"
                              onClick={() => togglePick(item)}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className={cn(
                                    "flex size-4 shrink-0 items-center justify-center rounded border",
                                    picked
                                      ? "border-brand bg-brand text-brand-foreground"
                                      : "border-muted-foreground/40",
                                  )}
                                >
                                  {picked ? <Check className="size-3" /> : null}
                                </span>
                                <span className="min-w-0 truncate">
                                  {item.name}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs capitalize text-muted-foreground">
                                {item.type}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      No matches.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={shareMutation.isPending}
              disabled={sharePicked.length === 0}
              onClick={() => shareMutation.mutate()}
            >
              <Send className="size-4" />
              Send to {sharePicked.length || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
