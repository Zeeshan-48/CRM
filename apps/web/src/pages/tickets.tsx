import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Inbox,
  LayoutGrid,
  LifeBuoy,
  List,
  Mail,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Star,
  StickyNote,
  Timer,
  Trash2,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  aiResolveTicket,
  createTicket,
  deleteTicket,
  escalateTicket,
  getTicketMetrics,
  getTicket,
  listContactOptions,
  listLeadOptions,
  listTickets,
  listUserOptions,
  replyToTicket,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  updateTicket,
  type ReplyChannel,
  type TicketFilters,
  type TicketListItem,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/api/tickets";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-provider";

const PRIORITY_BADGE: Record<TicketPriority, string> = {
  URGENT: "text-danger",
  HIGH: "text-warning",
  MEDIUM: "text-neutral",
  LOW: "border-transparent bg-muted text-muted-foreground",
};

const STATUS_BADGE: Record<TicketStatus, string> = {
  OPEN: "text-brand",
  PENDING: "text-warning",
  RESOLVED: "text-success",
  CLOSED: "border-transparent bg-muted text-muted-foreground",
};

// Column accent dot on the kanban board.
const STATUS_DOT: Record<TicketStatus, string> = {
  OPEN: "bg-brand",
  PENDING: "bg-warning",
  RESOLVED: "bg-success",
  CLOSED: "bg-muted-foreground",
};

// Slight tint on each column's header strip.
const STATUS_HEADER: Record<TicketStatus, string> = {
  OPEN: "bg-brand/[0.07]",
  PENDING: "bg-warning/[0.07]",
  RESOLVED: "bg-success/[0.07]",
  CLOSED: "bg-muted/60",
};

// Count colour matching the status.
const STATUS_COUNT: Record<TicketStatus, string> = {
  OPEN: "text-brand",
  PENDING: "text-warning",
  RESOLVED: "text-success",
  CLOSED: "text-muted-foreground",
};

const ALL = "ALL";
const UNASSIGNED = "UNASSIGNED";

// The create dialog's "Regarding" picker encodes the choice as one value so a
// ticket links to either a contact or a lead (never both).
const REGARDING_NONE = "NONE";
const encodeRegarding = (kind: "contact" | "lead", id: string) => `${kind}:${id}`;

function SlaChip({ breached }: { breached: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "",
        breached ? "text-danger" : "text-success"
      )}
    >
      {breached ? "Breached" : "On track"}
    </Badge>
  );
}

interface TicketFormState {
  subject: string;
  body: string;
  priority: TicketPriority;
  regarding: string;
  assigneeId: string;
  channel: string;
}

const EMPTY_FORM: TicketFormState = {
  subject: "",
  body: "",
  priority: "MEDIUM",
  regarding: REGARDING_NONE,
  assigneeId: UNASSIGNED,
  channel: "web",
};

export default function TicketsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [priorityFilter, setPriorityFilter] = React.useState<string>(ALL);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string>(ALL);

  const [view, setView] = React.useState<"list" | "board">(
    () => ((typeof window !== "undefined" && localStorage.getItem("tickets-view")) as
      | "list"
      | "board") || "board"
  );
  React.useEffect(() => {
    localStorage.setItem("tickets-view", view);
  }, [view]);
  const [dragOverStatus, setDragOverStatus] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState<TicketFormState>(EMPTY_FORM);

  const [activeTicketId, setActiveTicketId] = React.useState<string | null>(null);
  const [replyText, setReplyText] = React.useState("");
  // Reply delivery: an internal note by default, or sent to the customer over a
  // channel their linked contact/lead actually has.
  const [replyToCustomer, setReplyToCustomer] = React.useState(false);
  const [replyChannel, setReplyChannel] = React.useState<ReplyChannel>("email");
  const [confirmEscalate, setConfirmEscalate] = React.useState(false);

  const filters: TicketFilters = {
    // The board shows every status as a column, so the status filter only
    // narrows the list view.
    status: view === "list" && statusFilter !== ALL ? (statusFilter as TicketStatus) : undefined,
    priority: priorityFilter !== ALL ? (priorityFilter as TicketPriority) : undefined,
    assignee: assigneeFilter !== ALL ? assigneeFilter : undefined,
  };

  const metricsQuery = useQuery({
    queryKey: ["ticket-metrics"],
    queryFn: getTicketMetrics,
  });
  const ticketsQuery = useQuery({
    queryKey: ["tickets", filters],
    queryFn: () => listTickets(filters),
    placeholderData: (previous) => previous,
  });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUserOptions });
  const contactsQuery = useQuery({
    queryKey: ["contact-options"],
    queryFn: listContactOptions,
    enabled: createOpen,
  });
  const leadsQuery = useQuery({
    queryKey: ["lead-options"],
    queryFn: listLeadOptions,
    enabled: createOpen,
  });
  const detailQuery = useQuery({
    queryKey: ["ticket", activeTicketId],
    queryFn: () => getTicket(activeTicketId as string),
    enabled: activeTicketId !== null,
  });

  const usersById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const user of usersQuery.data ?? []) map.set(user.id, user.name);
    return map;
  }, [usersQuery.data]);

  const invalidateTickets = () => {
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
    queryClient.invalidateQueries({ queryKey: ["ticket-metrics"] });
    if (activeTicketId) {
      queryClient.invalidateQueries({ queryKey: ["ticket", activeTicketId] });
    }
  };

  const createMutation = useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      toast.success("Ticket created");
      invalidateTickets();
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (error: Error) => toast.error(error.message || "Could not create ticket"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      updateTicket(id, { status }),
    onSuccess: () => {
      toast.success("Ticket updated");
      invalidateTickets();
    },
    onError: (error: Error) => toast.error(error.message || "Could not update ticket"),
  });

  // Board drag-to-move: optimistically re-column the ticket, roll back on error.
  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      updateTicket(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["tickets", filters] });
      const previous = queryClient.getQueryData<TicketListItem[]>(["tickets", filters]);
      queryClient.setQueryData<TicketListItem[]>(["tickets", filters], (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status } : t))
      );
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["tickets", filters], context.previous);
      toast.error(error.message || "Could not move ticket");
    },
    onSettled: () => invalidateTickets(),
  });

  const escalateMutation = useMutation({
    mutationFn: (id: string) => escalateTicket(id),
    onSuccess: () => {
      toast.success("Ticket escalated to URGENT. Managers notified.");
      setConfirmEscalate(false);
      invalidateTickets();
    },
    onError: (error: Error) => {
      setConfirmEscalate(false);
      toast.error(error.message || "Could not escalate ticket");
    },
  });

  const replyMutation = useMutation({
    mutationFn: ({
      id,
      body,
      toCustomer,
      channel,
    }: {
      id: string;
      body: string;
      toCustomer: boolean;
      channel: ReplyChannel;
    }) => replyToTicket(id, body, toCustomer ? { toCustomer, channel } : {}),
    onSuccess: (result) => {
      toast.success(
        result.sentChannel
          ? `Reply sent to customer via ${result.sentChannel === "email" ? "email" : "WhatsApp"}`
          : "Internal note added"
      );
      setReplyText("");
      invalidateTickets();
    },
    onError: (error: Error) => toast.error(error.message || "Could not send reply"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTicket(id),
    onSuccess: () => {
      toast.success("Ticket deleted");
      setActiveTicketId(null);
      invalidateTickets();
    },
    onError: (error: Error) => toast.error(error.message || "Could not delete ticket"),
  });

  const handleDeleteTicket = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: "Delete ticket?",
      description: `"${detail.subject}" and its replies will be permanently removed. This can't be undone.`,
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) deleteMutation.mutate(detail.id);
  };

  const aiResolveMutation = useMutation({
    mutationFn: (id: string) => aiResolveTicket(id),
    onSuccess: (result) => {
      if (result.resolved) toast.success("Resolved by AI from the knowledge base");
      else toast.info("AI could not resolve this confidently");
      invalidateTickets();
    },
    onError: (error: Error) => toast.error(error.message || "AI resolve failed"),
  });

  const openTicket = (id: string) => {
    setActiveTicketId(id);
    setReplyText("");
    setReplyToCustomer(false);
    setReplyChannel("email");
    setConfirmEscalate(false);
    aiResolveMutation.reset();
  };

  const metrics = metricsQuery.data;
  const tickets = ticketsQuery.data ?? [];
  const detail = detailQuery.data;
  const aiResult = aiResolveMutation.data;

  // Who a customer reply reaches, and over which channels their record supports.
  const recipient = detail?.contact ?? detail?.lead ?? null;
  const canEmailCustomer = !!recipient?.email;
  const canWhatsAppCustomer = !!recipient?.phone;

  // Keep the chosen channel valid for this recipient; fall back sensibly.
  React.useEffect(() => {
    if (!replyToCustomer) return;
    if (replyChannel === "email" && !canEmailCustomer && canWhatsAppCustomer) {
      setReplyChannel("whatsapp");
    } else if (replyChannel === "whatsapp" && !canWhatsAppCustomer && canEmailCustomer) {
      setReplyChannel("email");
    }
  }, [replyToCustomer, replyChannel, canEmailCustomer, canWhatsAppCustomer]);
  const hasFilters = statusFilter !== ALL || priorityFilter !== ALL || assigneeFilter !== ALL;

  const handleDrop = (event: React.DragEvent, status: TicketStatus) => {
    event.preventDefault();
    setDragOverStatus(null);
    const id = event.dataTransfer.getData("text/plain");
    if (!id) return;
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket || ticket.status === status) return;
    moveMutation.mutate({ id, status });
  };

  const stats = [
    { label: "Total tickets", value: formatNumber(metrics?.total), icon: LifeBuoy },
    { label: "Open", value: formatNumber(metrics?.open), icon: Inbox },
    {
      label: "SLA breached",
      value: <span className="text-danger">{formatNumber(metrics?.breached)}</span>,
      icon: Timer,
    },
    {
      label: "CSAT",
      value: metrics?.csat != null ? metrics.csat.toFixed(1) : "N/A",
      icon: Star,
    },
  ];

  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.subject.trim()) {
      toast.error("Give the ticket a subject.");
      return;
    }
    const [kind, id] = form.regarding.split(":");
    createMutation.mutate({
      subject: form.subject.trim(),
      body: form.body.trim() || undefined,
      priority: form.priority,
      contactId: kind === "contact" ? id : undefined,
      leadId: kind === "lead" ? id : undefined,
      assigneeId: form.assigneeId !== UNASSIGNED ? form.assigneeId : undefined,
      channel: form.channel,
    });
  };

  const submitReply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeTicketId || !replyText.trim()) return;
    replyMutation.mutate({
      id: activeTicketId,
      body: replyText.trim(),
      toCustomer: replyToCustomer,
      channel: replyChannel,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets"
        description="Support tickets with SLAs and AI-suggested replies."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New Ticket
          </Button>
        }
      />

      {/* Metrics strip */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map((stat, index) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            loading={metricsQuery.isLoading}
            className="reveal"
            style={{ animationDelay: `${60 + index * 45}ms` }}
          />
        ))}
      </section>

      {/* Filter bar */}
      <section
        className="reveal flex flex-wrap items-center gap-2"
        style={{ animationDelay: "200ms" }}
      >
        {view === "list" ? (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {TICKET_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            {TICKET_PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priority}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            {(usersQuery.data ?? []).map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter(ALL);
              setPriorityFilter(ALL);
              setAssigneeFilter(ALL);
            }}
          >
            Clear filters
          </Button>
        ) : null}

        {/* List / Board view toggle */}
        <div className="ml-auto inline-flex items-center gap-4">
          <button
            type="button"
            aria-label="List view"
            onClick={() => setView("list")}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 py-1 text-xs font-medium transition-colors",
              view === "list"
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="size-3.5" />
            List
          </button>
          <button
            type="button"
            aria-label="Board view"
            onClick={() => setView("board")}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 py-1 text-xs font-medium transition-colors",
              view === "board"
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="size-3.5" />
            Board
          </button>
        </div>
      </section>

      {/* Tickets table */}
      <section className="reveal" style={{ animationDelay: "260ms" }}>
        {ticketsQuery.isLoading ? (
          view === "board" ? (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {TICKET_STATUSES.map((status) => (
                <div
                  key={status}
                  className="w-80 shrink-0 space-y-2 rounded-xl border bg-muted/30 p-2"
                >
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border bg-card p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          )
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title={hasFilters ? "No tickets match these filters" : "No tickets yet"}
            description={
              hasFilters
                ? "Try widening the status, priority or assignee filters."
                : "Raise a ticket to start tracking SLAs, replies and AI resolutions."
            }
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Create a ticket
              </Button>
            }
          />
        ) : view === "board" ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {TICKET_STATUSES.map((status) => {
              const columnTickets = tickets.filter((t) => t.status === status);
              return (
                <div
                  key={status}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverStatus !== status) setDragOverStatus(status);
                  }}
                  onDragLeave={() =>
                    setDragOverStatus((current) => (current === status ? null : current))
                  }
                  onDrop={(e) => handleDrop(e, status)}
                  className={cn(
                    "flex h-[calc(100vh-19rem)] min-h-[22rem] w-80 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/25 transition-all duration-200",
                    dragOverStatus === status
                      ? "border-brand/50 bg-brand/[0.04] ring-1 ring-brand/20"
                      : "border-border"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between gap-2 border-b px-3 py-2.5",
                      STATUS_HEADER[status]
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
                      <span className="text-sm font-semibold">{status}</span>
                    </div>
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        STATUS_COUNT[status]
                      )}
                    >
                      {columnTickets.length}
                    </span>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto p-2">
                    {columnTickets.length === 0 ? (
                      <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                        Drop tickets here
                      </p>
                    ) : (
                      columnTickets.map((ticket) => (
                        <button
                          key={ticket.id}
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", ticket.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDraggingId(ticket.id);
                          }}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setDragOverStatus(null);
                          }}
                          onClick={() => openTicket(ticket.id)}
                          className={cn(
                            "kanban-card-in block w-full cursor-grab rounded-lg border bg-card p-3 text-left transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:border-brand/40 active:cursor-grabbing",
                            draggingId === ticket.id && "scale-[0.97] opacity-40"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 text-sm font-medium">{ticket.subject}</p>
                            <Badge
                              variant="outline"
                              className={cn("shrink-0", PRIORITY_BADGE[ticket.priority])}
                            >
                              {ticket.priority}
                            </Badge>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-muted-foreground">
                              {ticket.contact ?? "Unknown"}
                            </span>
                            <SlaChip breached={ticket.breached} />
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">
                              {ticket.assignee_id
                                ? (usersById.get(ticket.assignee_id) ?? "Unknown")
                                : "Unassigned"}
                            </span>
                            <span className="shrink-0">{timeAgo(ticket.created_at)}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Subject</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer"
                    onClick={() => openTicket(ticket.id)}
                  >
                    <TableCell className="max-w-72">
                      <span className="block truncate font-medium">{ticket.subject}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ticket.contact ?? "Unknown"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={PRIORITY_BADGE[ticket.priority]}>
                        {ticket.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE[ticket.status]}>
                        {ticket.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <SlaChip breached={ticket.breached} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ticket.assignee_id
                        ? (usersById.get(ticket.assignee_id) ?? "Unknown")
                        : "Unassigned"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {timeAgo(ticket.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* New ticket dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>
              Log a support request. SLA timers start immediately.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-subject">Subject</Label>
              <Input
                id="ticket-subject"
                placeholder="Cannot sign in to my account"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-body">Description</Label>
              <Textarea
                id="ticket-body"
                rows={3}
                placeholder="What is the customer reporting?"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tickets-priority">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(priority) =>
                    setForm((f) => ({ ...f, priority: priority as TicketPriority }))
                  }
                >
                  <SelectTrigger id="tickets-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_PRIORITIES.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priority}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tickets-channel">Channel</Label>
                <Select
                  value={form.channel}
                  onValueChange={(channel) => setForm((f) => ({ ...f, channel }))}
                >
                  <SelectTrigger id="tickets-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_CHANNELS.map((channel) => (
                      <SelectItem key={channel} value={channel}>
                        {channel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tickets-regarding">Regarding</Label>
                <Select
                  value={form.regarding}
                  onValueChange={(regarding) => setForm((f) => ({ ...f, regarding }))}
                >
                  <SelectTrigger id="tickets-regarding">
                    <SelectValue placeholder="Link a contact or lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={REGARDING_NONE}>No one linked</SelectItem>
                    {(contactsQuery.data ?? []).length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Contacts</SelectLabel>
                        {(contactsQuery.data ?? []).map((contact) => (
                          <SelectItem key={`c-${contact.id}`} value={encodeRegarding("contact", contact.id)}>
                            {contact.name}
                            {contact.company ? ` (${contact.company})` : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    {(leadsQuery.data ?? []).length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Leads</SelectLabel>
                        {(leadsQuery.data ?? []).map((lead) => (
                          <SelectItem key={`l-${lead.id}`} value={encodeRegarding("lead", lead.id)}>
                            {lead.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Who this is for, enables replying to them from the ticket.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tickets-assign-to">Assign to</Label>
                <Select
                  value={form.assigneeId}
                  onValueChange={(assigneeId) => setForm((f) => ({ ...f, assigneeId }))}
                >
                  <SelectTrigger id="tickets-assign-to">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {(usersQuery.data ?? []).map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  They&apos;ll be notified they own it.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create ticket"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ticket detail sheet */}
      <Sheet
        open={activeTicketId !== null}
        onOpenChange={(open) => {
          if (!open) setActiveTicketId(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {detailQuery.isLoading || !detail ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : (
            <>
              <SheetHeader className="border-b p-6 pb-4">
                <SheetTitle className="pr-8">{detail.subject}</SheetTitle>
                <SheetDescription>
                  {detail.contact ? `${detail.contact.name} ` : ""}
                  via {detail.channel ?? "web"} &middot; opened {timeAgo(detail.created_at)}
                </SheetDescription>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="outline" className={PRIORITY_BADGE[detail.priority]}>
                    {detail.priority}
                  </Badge>
                  <Badge variant="outline" className={STATUS_BADGE[detail.status]}>
                    {detail.status}
                  </Badge>
                  <SlaChip breached={detail.breached} />
                  {detail.escalated ? (
                    <Badge
                      variant="outline"
                      className="text-danger"
                    >
                      Escalated
                    </Badge>
                  ) : null}
                </div>
              </SheetHeader>

              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-6 py-3">
                <Select
                  value={detail.status}
                  onValueChange={(status) =>
                    statusMutation.mutate({
                      id: detail.id,
                      status: status as TicketStatus,
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant={confirmEscalate ? "destructive" : "outline"}
                  size="sm"
                  disabled={escalateMutation.isPending}
                  onClick={() => {
                    if (confirmEscalate) escalateMutation.mutate(detail.id);
                    else setConfirmEscalate(true);
                  }}
                  onBlur={() => setConfirmEscalate(false)}
                >
                  <ArrowUpRight />
                  {escalateMutation.isPending
                    ? "Escalating..."
                    : confirmEscalate
                      ? "Confirm escalate?"
                      : "Escalate"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-danger"
                  disabled={deleteMutation.isPending}
                  onClick={handleDeleteTicket}
                >
                  <Trash2 />
                  Delete
                </Button>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={aiResolveMutation.isPending}
                  onClick={() => aiResolveMutation.mutate(detail.id)}
                >
                  <Sparkles />
                  {aiResolveMutation.isPending ? "Thinking..." : "AI Resolve"}
                </Button>
              </div>

              {/* AI resolve outcome */}
              {aiResult ? (
                aiResult.resolved ? (
                  <div className="mx-6 mt-4 border-l-2 border-success py-1 pl-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                      <Sparkles className="size-4" />
                      Resolved from the knowledge base
                    </p>
                    {aiResult.reply ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                        {aiResult.reply.body}
                      </p>
                    ) : null}
                    {aiResult.source ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Source: {aiResult.source.title}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mx-6 mt-4 border-l-2 border-warning py-1 pl-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
                      <AlertTriangle className="size-4" />
                      Not confident enough to auto-resolve
                    </p>
                    {aiResult.suggestion ? (
                      <>
                        <p className="mt-2 text-xs font-medium text-muted-foreground">
                          Closest article: {aiResult.suggestion.article.title} (score{" "}
                          {aiResult.suggestion.score})
                        </p>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                          {aiResult.suggestion.snippet}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No matching knowledge base article was found. Reply manually below.
                      </p>
                    )}
                  </div>
                )
              ) : null}

              {/* Conversation */}
              <div className="flex-1 space-y-3 p-6">
                {detail.body ? (
                  <div className="border-t pt-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold">
                        {detail.contact?.name ?? "Customer"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(detail.created_at)}
                      </p>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                      {detail.body}
                    </p>
                  </div>
                ) : null}

                {detail.replies.length === 0 && !detail.body ? (
                  <p className="text-sm text-muted-foreground">No conversation yet.</p>
                ) : null}

                {detail.replies.map((reply) => (
                  <div
                    key={reply.id}
                    className={cn(
                      "border-t pt-3.5",
                      reply.is_ai ? "border-brand/30 bg-brand/5" : "bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        {reply.is_ai ? (
                          <>
                            <Bot className="size-3.5 text-brand" />
                            AI Assistant
                            <Badge variant="brand" className="gap-1 text-[10px]">
                              <Sparkles className="size-2.5" />
                              AI
                            </Badge>
                          </>
                        ) : (
                          <>
                            {reply.author_user_id
                              ? (usersById.get(reply.author_user_id) ?? "Agent")
                              : "Agent"}
                            {reply.channel === "email" ? (
                              <Badge variant="outline" className="gap-1 text-[10px] font-medium">
                                <Mail className="size-2.5" />
                                Sent via email
                              </Badge>
                            ) : reply.channel === "whatsapp" ? (
                              <Badge variant="outline" className="gap-1 text-[10px] font-medium">
                                <MessageCircle className="size-2.5" />
                                Sent via WhatsApp
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-[10px] font-medium text-muted-foreground">
                                <StickyNote className="size-2.5" />
                                Internal note
                              </Badge>
                            )}
                          </>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(reply.created_at)}
                      </p>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                      {reply.body}
                    </p>
                  </div>
                ))}
              </div>

              <Separator />

              {/* Reply composer */}
              <form onSubmit={submitReply} className="space-y-2.5 p-6 pt-4">
                <Label htmlFor="ticket-reply">
                  {replyToCustomer ? "Reply to customer" : "Internal note"}
                </Label>
                <Textarea
                  id="ticket-reply"
                  rows={3}
                  placeholder={
                    replyToCustomer
                      ? "Write a reply the customer will receive…"
                      : "Add a private note for your team…"
                  }
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                />

                {/* Delivery controls: internal note by default, or send out over a
                    channel the linked contact/lead actually has. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand"
                        checked={replyToCustomer}
                        disabled={!recipient}
                        onChange={(e) => setReplyToCustomer(e.target.checked)}
                      />
                      <span className={cn(!recipient && "text-muted-foreground")}>Send to customer</span>
                    </label>
                    {replyToCustomer ? (
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => setReplyChannel("email")}
                          disabled={!canEmailCustomer}
                          className={cn(
                            "flex items-center gap-1.5 border-b-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                            replyChannel === "email"
                              ? "border-brand text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Mail className="size-3.5" />
                          Email
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplyChannel("whatsapp")}
                          disabled={!canWhatsAppCustomer}
                          className={cn(
                            "flex items-center gap-1.5 border-b-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                            replyChannel === "whatsapp"
                              ? "border-brand text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <MessageCircle className="size-3.5" />
                          WhatsApp
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!replyText.trim() || replyMutation.isPending}
                  >
                    <Send />
                    {replyMutation.isPending
                      ? "Sending..."
                      : replyToCustomer
                        ? "Send to customer"
                        : "Add note"}
                  </Button>
                </div>
                {!recipient ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserRound className="size-3.5" />
                    Link a contact or lead to this ticket to reply to the customer. Notes stay internal.
                  </p>
                ) : replyToCustomer && !canEmailCustomer && !canWhatsAppCustomer ? (
                  <p className="text-xs text-warning">
                    {recipient.name} has no email or phone on file, add one to reply to them.
                  </p>
                ) : null}
              </form>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
