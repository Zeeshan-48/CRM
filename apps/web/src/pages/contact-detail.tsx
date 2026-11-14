import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  Flame,
  Globe,
  LifeBuoy,
  ListTodo,
  Mail,
  MapPin,
  MessageSquare,
  Mic,
  Phone,
  Receipt,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  deleteContact,
  getContact,
  updateContact,
  type ContactLifecycle,
  type TimelineItem,
} from "@/lib/api/contacts";
import {
  listPipelines,
  moveDeal,
  loseDeal,
  type Deal,
} from "@/lib/api/deals";
import { formatDate, formatDateTime, formatINR, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LogActivityCard } from "@/components/activities/LogActivityCard";
import { TimelineTypeFilter } from "@/components/activities/TimelineTypeFilter";
import { ScheduleMeetingDialog } from "@/components/calendar/ScheduleMeetingDialog";
import { EmptyState } from "@/components/layout/EmptyState";
import { FieldRow, SectionCard } from "@/components/detail/editable-section";
import {
  cleanSocials,
  SocialLinksFields,
  SocialLinksList,
  type SocialsValue,
} from "@/components/social/social-links";
import { CallButton } from "@/components/telephony/CallButton";
import { LogCallDialog } from "@/components/telephony/LogCallDialog";
import { WhatsAppButton } from "@/components/whatsapp/WhatsAppButton";
import { EmailButton } from "@/components/email/EmailButton";
import { Badge } from "@/components/ui/badge";
import { ProductEngagementCard } from "@/components/products/ProductEngagementCard";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LIFECYCLES: ContactLifecycle[] = ["LEAD", "PROSPECT", "CUSTOMER"];

type ContactSection = "contact" | "company" | "socials" | "tags";
type ContactTextField = "name" | "email" | "phone" | "city" | "company" | "title";

const LIFECYCLE_STYLES: Record<ContactLifecycle, string> = {
  LEAD: "text-neutral",
  PROSPECT: "text-warning",
  CUSTOMER: "text-success",
};

// The "deal half" of the funnel (continues from the lead's Qualified). Lost is a
// terminal off-track state shown as a side badge rather than a step.
const DEAL_JOURNEY = [
  "Qualified",
  "Demo Scheduled",
  "Demo Completed",
  "Proposal Sent",
  "Negotiation",
  "Won",
] as const;

/** Picks the deal that best represents the contact's current funnel position:
 *  the most recently updated OPEN deal, else the most recent deal overall. */
function pickPrimaryDeal(deals: Deal[]): Deal | null {
  if (deals.length === 0) return null;
  const open = deals.filter((d) => d.status === "OPEN");
  const pool = open.length ? open : deals;
  return [...pool].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  )[0];
}

/** Deal-half funnel stepper on the contact, mirrors the lead's journey bar so
 *  the pipeline position is visible end-to-end. Shows the primary deal. */
function ContactDealJourney({
  deals,
  contactId,
}: {
  deals: Deal[];
  contactId: string;
}) {
  const deal = pickPrimaryDeal(deals);
  const queryClient = useQueryClient();

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: listPipelines,
  });

  const moveMutation = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      moveDeal(dealId, stageId),
    onSuccess: (updated) => {
      toast.success(`Deal moved to ${updated.stage_name || "new stage"}`);
      queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const lostMutation = useMutation({
    mutationFn: (dealId: string) => loseDeal(dealId),
    onSuccess: () => {
      toast.success("Deal marked as lost");
      queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!deal) {
    return (
      <div className="rounded-xl border bg-card p-4 sm:px-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Deal journey
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          No deal yet, one opens when a qualified lead is converted.
        </p>
      </div>
    );
  }

  const lost = deal.status === "LOST" || deal.stage_name === "Lost";
  const pipeline =
    pipelinesQuery.data?.find((p) => p.id === deal.pipeline_id) ||
    pipelinesQuery.data?.find((p) => p.is_default) ||
    pipelinesQuery.data?.[0];

  const pipelineStages = pipeline?.stages
    ? [...pipeline.stages].sort((a, b) => a.sort_order - b.sort_order)
    : [];

  const nonLostStages = pipelineStages.filter((s) => !s.lost);

  const displaySteps =
    nonLostStages.length > 0
      ? nonLostStages.map((s) => ({ id: s.id, name: s.name }))
      : DEAL_JOURNEY.map((name) => ({ id: name, name }));

  const activeIdx = lost
    ? -1
    : displaySteps.findIndex(
        (s) => s.name.toLowerCase() === (deal.stage_name || "").toLowerCase()
      );
  const others = deals.length - 1;
  const isPending = moveMutation.isPending || lostMutation.isPending;

  return (
    <div className="rounded-xl border bg-card p-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Deal journey
            </p>
            <span className="hidden text-xs text-muted-foreground/60 sm:inline">
              &bull; Click any stage to advance
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm font-medium">
            {deal.title}
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">
              {formatINR(deal.value)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lost ? (
            <Badge className="text-danger">Lost</Badge>
          ) : deal.status === "WON" ? (
            <Badge className="text-success">Won</Badge>
          ) : null}
          {pipelineStages.length > 0 ? (
            <Select
              value={deal.status === "LOST" ? "LOST" : deal.stage_id || ""}
              onValueChange={(val) => {
                if (val === "LOST") {
                  lostMutation.mutate(deal.id);
                } else {
                  moveMutation.mutate({ dealId: deal.id, stageId: val });
                }
              }}
              disabled={isPending}
            >
              <SelectTrigger className="h-7 w-[160px] gap-1 border-dashed px-2 text-xs">
                <SelectValue placeholder="Change stage" />
              </SelectTrigger>
              <SelectContent align="end">
                {pipelineStages.map((s) => (
                  <SelectItem key={s.id} value={s.lost ? "LOST" : s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      <ol className="mt-4 flex items-center overflow-x-auto py-2 px-1">
        {displaySteps.map((step, i) => {
          const done = activeIdx >= 0 && i < activeIdx;
          const current = i === activeIdx;
          return (
            <React.Fragment key={step.id}>
              <li className="flex shrink-0 flex-col items-center">
                <button
                  type="button"
                  onClick={() => {
                    const targetStage = pipelineStages.find(
                      (s) => s.name.toLowerCase() === step.name.toLowerCase()
                    );
                    if (targetStage) {
                      moveMutation.mutate({ dealId: deal.id, stageId: targetStage.id });
                    }
                  }}
                  disabled={isPending || current}
                  className={cn(
                    "group flex flex-col items-center focus:outline-none disabled:pointer-events-none",
                    current ? "cursor-default" : "cursor-pointer"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-all shadow-sm",
                      current
                        ? "border-brand bg-brand text-brand-foreground ring-4 ring-brand/20 shadow-sm"
                        : done
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-border bg-muted/60 text-muted-foreground group-hover:border-brand/70 group-hover:bg-brand/10 group-hover:text-brand group-hover:ring-4 group-hover:ring-brand/15"
                    )}
                  >
                    {done ? <Check className="size-3.5 stroke-[2.5]" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 max-w-[85px] text-center text-[11px] leading-tight transition-colors sm:max-w-[110px]",
                      current
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {step.name}
                  </span>
                </button>
              </li>
              {i < displaySteps.length - 1 ? (
                <div
                  className={cn(
                    "mx-2 mb-[22px] h-[2px] min-w-6 flex-1 transition-colors rounded-full",
                    activeIdx >= 0 && i < activeIdx ? "bg-emerald-600" : "bg-border"
                  )}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {lost
          ? "This deal was lost. Click any stage above to reopen the deal."
          : deal.status === "WON"
            ? "Deal won, contact is now a customer."
            : deal.stage_name
              ? `In pipeline at ${deal.stage_name}.`
              : "In pipeline."}
        {others > 0
          ? ` +${others} other deal${others === 1 ? "" : "s"} (see Deals tab).`
          : ""}
      </p>
    </div>
  );
}

// Tint a call's sentiment badge (mirrors lead-detail's Calls tab).
const sentimentStyle = (label: string | null): string => {
  if (!label) return "bg-muted text-muted-foreground";
  const l = label.toLowerCase();
  if (l.includes("pos")) return "bg-success/10 text-success";
  if (l.includes("neg")) return "bg-danger/10 text-danger";
  return "bg-neutral/10 text-neutral";
};

const TIMELINE_ICONS: Record<TimelineItem["kind"], LucideIcon> = {
  activity: ListTodo,
  message: MessageSquare,
  call: Phone,
  meeting: CalendarDays,
  ticket: LifeBuoy,
  product: Globe,
};

const TICKET_STATUS_STYLES: Record<string, string> = {
  OPEN: "text-brand",
  PENDING: "text-warning",
  RESOLVED: "text-success",
  CLOSED: "text-neutral",
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  PAID: "text-success",
  SENT: "text-brand",
  OVERDUE: "text-danger",
  DRAFT: "text-neutral",
  REFUNDED: "text-info",
};

/** A compact identity chip (email / phone / company / location) shown in the
 *  hero. When `href` is set it becomes a mailto:/tel: link. */
function InfoChip({
  icon: Icon,
  children,
  href,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  href?: string;
}) {
  const body = (
    <span className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground/80 transition-colors duration-120 hover:border-brand/40 hover:text-foreground">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </span>
  );
  return href ? (
    <a href={href} className="min-w-0">
      {body}
    </a>
  ) : (
    body
  );
}

export default function ContactDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  // Timeline type filter ("ALL" or a specific interaction kind).
  const [timelineFilter, setTimelineFilter] = React.useState<string>("ALL");

  // Which Overview section is currently in edit mode (null = all read-only).
  const [editing, setEditing] = React.useState<ContactSection | null>(null);
  const [form, setForm] = React.useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    company: "",
    title: "",
    lifecycle: "LEAD" as ContactLifecycle,
  });
  const [socials, setSocials] = React.useState<SocialsValue>({});
  const [tags, setTags] = React.useState("");

  const contactQuery = useQuery({
    queryKey: ["contact", id],
    queryFn: () => getContact(id),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteContact(id),
    onSuccess: () => {
      toast.success("Contact deleted");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate("/contacts");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateContact>[1]) =>
      updateContact(id, patch),
    onSuccess: () => {
      toast.success("Contact updated");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["contact", id] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const contact = contactQuery.data;

  // Open a section from a clean copy of the saved values, so a previously
  // cancelled edit never leaks into the next one.
  const openEdit = (section: ContactSection) => {
    if (!contact) return;
    setForm({
      name: contact.name ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      city: contact.city ?? "",
      company: contact.company ?? "",
      title: contact.title ?? "",
      lifecycle: contact.lifecycle,
    });
    setSocials((contact.socials as SocialsValue | null) ?? {});
    setTags((contact.tags ?? []).join(", "));
    setEditing(section);
  };
  const cancelEdit = () => setEditing(null);
  const savingFor = (section: ContactSection) =>
    saveMutation.isPending && editing === section;

  const input = (key: ContactTextField, label: string, placeholder = "") => (
    <div className="grid gap-1.5">
      <Label htmlFor={`f-${key}`}>{label}</Label>
      <Input
        id={`f-${key}`}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  if (contactQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!contact) {
    return (
      <EmptyState
        icon={Users}
        title="Contact not found"
        description="It may have been deleted."
        action={
          <Button asChild variant="outline">
            <Link to="/contacts">Back to contacts</Link>
          </Button>
        }
      />
    );
  }

  const socialsCount = Object.values(contact.socials ?? {}).filter(
    (value) => typeof value === "string" && value
  ).length;
  const purchases = contact.invoices.length;
  const roleLine = [contact.title, contact.company].filter(Boolean).join(" at ");
  const hasTags = Array.isArray(contact.tags) && contact.tags.length > 0;

  // Timeline type filter (by interaction kind: activity / message / call / …).
  const timelineKindCounts = contact.timeline.reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const timelineKinds = Array.from(
    new Set(contact.timeline.map((i) => i.kind))
  );
  const filteredTimeline =
    timelineFilter === "ALL"
      ? contact.timeline
      : contact.timeline.filter((i) => i.kind === timelineFilter);

  return (
    <div className="space-y-5">
      {/* Header, premium gradient hero with identity + surfaced contact info */}
      <div className="reveal">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
          <Link to="/contacts">
            <ArrowLeft className="size-4" />
            Contacts
          </Link>
        </Button>
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-brand/10 blur-3xl"
          />
          <div className="relative flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-2xl font-semibold tracking-tight">
                    {contact.name}
                  </h1>
                  <Badge
                    className={cn(
                      "",
                      LIFECYCLE_STYLES[contact.lifecycle]
                    )}
                  >
                    {contact.lifecycle}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {roleLine ? (
                    <>
                      {roleLine}
                      <span className="px-1.5">&middot;</span>
                    </>
                  ) : null}
                  Added {formatDate(contact.created_at)}
                  <span className="px-1.5">&middot;</span>
                  {contact.last_activity_at ? (
                    <>
                      last activity{" "}
                      {/* Exact date + time; hover shows the relative "x ago". */}
                      <span
                        className="text-foreground"
                        title={timeAgo(contact.last_activity_at)}
                      >
                        {formatDateTime(contact.last_activity_at)}
                      </span>
                    </>
                  ) : (
                    "no activity yet"
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {contact.email ? (
                    <InfoChip icon={Mail} href={`mailto:${contact.email}`}>
                      {contact.email}
                    </InfoChip>
                  ) : null}
                  {contact.phone ? (
                    <InfoChip icon={Phone} href={`tel:${contact.phone}`}>
                      {contact.phone}
                    </InfoChip>
                  ) : null}
                  {contact.company ? (
                    <InfoChip icon={Building2}>{contact.company}</InfoChip>
                  ) : null}
                  {contact.city ? (
                    <InfoChip icon={MapPin}>{contact.city}</InfoChip>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Action bar, comms on the left, lifecycle on the right */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
              <CallButton contactId={contact.id} />
              <LogCallDialog contactId={contact.id} />
              <WhatsAppButton contactId={contact.id} />
              <EmailButton
                contactId={contact.id}
                recipientName={contact.name}
                recipientEmail={contact.email}
                recipientCompany={contact.company}
              />
              <span
                aria-hidden
                className="mx-1 hidden h-6 w-px bg-border sm:block"
              />
              <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
                <CalendarDays className="size-4" />
                Schedule
              </Button>
              <Button aria-label="Delete contact"
                variant="outline"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Deal journey (funnel position, the deal half continues here) */}
      <div className="reveal" style={{ animationDelay: "50ms" }}>
        <ContactDealJourney deals={contact.deals} contactId={contact.id} />
      </div>

      <div className="reveal" style={{ animationDelay: "60ms" }}>
        <Tabs defaultValue="overview">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timeline">
                Timeline
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {contact.timeline.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="activities">
                Activities
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {contact.activities.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="tickets">
                Tickets
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {contact.tickets.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="platform">Product</TabsTrigger>
              <TabsTrigger value="deals">
                Deals
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {contact.deals.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="purchases">
                Purchases
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {purchases}
                </span>
              </TabsTrigger>
              <TabsTrigger value="meetings">
                Meetings
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {contact.meetings.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="calls">
                Calls
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {contact.calls.length}
                </span>
              </TabsTrigger>
            </TabsList>

            {/* Overview, read-only details, editable section by section */}
            <TabsContent value="overview">
              <div className="space-y-4">
                {/* Contact information */}
                <SectionCard
                  title="Contact information"
                  editing={editing === "contact"}
                  saving={savingFor("contact")}
                  onEdit={() => openEdit("contact")}
                  onCancel={cancelEdit}
                  onSave={() =>
                    saveMutation.mutate({
                      name: form.name,
                      email: form.email,
                      phone: form.phone,
                      city: form.city,
                    })
                  }
                >
                  {editing === "contact" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {input("name", "Name")}
                      {input("email", "Email", "name@company.example.com")}
                      {input("phone", "Phone", "+91…")}
                      {input("city", "City")}
                    </div>
                  ) : (
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <FieldRow label="Name" value={contact.name} />
                      <FieldRow label="Email" value={contact.email} />
                      <FieldRow label="Phone" value={contact.phone} />
                      <FieldRow label="City" value={contact.city} />
                    </dl>
                  )}
                </SectionCard>

                {/* Company & role */}
                <SectionCard
                  title="Company & role"
                  editing={editing === "company"}
                  saving={savingFor("company")}
                  onEdit={() => openEdit("company")}
                  onCancel={cancelEdit}
                  onSave={() =>
                    saveMutation.mutate({
                      company: form.company,
                      title: form.title,
                      lifecycle: form.lifecycle,
                    })
                  }
                >
                  {editing === "company" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {input("company", "Company")}
                      {input("title", "Title")}
                      <div className="grid gap-1.5">
                        <Label htmlFor="contact-detail-lifecycle">Lifecycle</Label>
                        <Select
                          value={form.lifecycle}
                          onValueChange={(v) =>
                            setForm({ ...form, lifecycle: v as ContactLifecycle })
                          }
                        >
                          <SelectTrigger id="contact-detail-lifecycle">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LIFECYCLES.map((l) => (
                              <SelectItem key={l} value={l}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <FieldRow label="Company" value={contact.company} />
                      <FieldRow label="Title" value={contact.title} />
                      <FieldRow
                        label="Lifecycle"
                        value={
                          <Badge
                            className={cn(
                              "",
                              LIFECYCLE_STYLES[contact.lifecycle]
                            )}
                          >
                            {contact.lifecycle}
                          </Badge>
                        }
                      />
                    </dl>
                  )}
                </SectionCard>

                {/* Website & social links */}
                <SectionCard
                  title="Website & social links"
                  description={
                    editing === "socials"
                      ? "Bare domains are fine, we add https:// for you."
                      : undefined
                  }
                  editing={editing === "socials"}
                  saving={savingFor("socials")}
                  onEdit={() => openEdit("socials")}
                  onCancel={cancelEdit}
                  onSave={() => saveMutation.mutate({ socials: cleanSocials(socials) })}
                >
                  {editing === "socials" ? (
                    <SocialLinksFields value={socials} onChange={setSocials} />
                  ) : socialsCount > 0 ? (
                    <SocialLinksList socials={contact.socials} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No links yet.</p>
                  )}
                </SectionCard>

                {/* Tags */}
                <SectionCard
                  title="Tags"
                  description={
                    editing === "tags" ? "Separate tags with commas." : undefined
                  }
                  editing={editing === "tags"}
                  saving={savingFor("tags")}
                  onEdit={() => openEdit("tags")}
                  onCancel={cancelEdit}
                  onSave={() =>
                    saveMutation.mutate({
                      tags: tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                >
                  {editing === "tags" ? (
                    <Input
                      value={tags}
                      placeholder="vip, enterprise, referral"
                      onChange={(e) => setTags(e.target.value)}
                    />
                  ) : hasTags ? (
                    <div className="flex flex-wrap gap-1.5">
                      {contact.tags!.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No tags yet.</p>
                  )}
                </SectionCard>
              </div>
            </TabsContent>

            {/* Timeline */}
            <TabsContent value="timeline">
              <Card>
                <CardContent className="pt-5">
                  {contact.timeline.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nothing on the timeline yet.
                    </p>
                  ) : (
                    <>
                      <TimelineTypeFilter
                        total={contact.timeline.length}
                        value={timelineFilter}
                        onChange={setTimelineFilter}
                        options={timelineKinds.map((kind) => ({
                          value: kind,
                          label: kind.charAt(0).toUpperCase() + kind.slice(1),
                          count: timelineKindCounts[kind],
                        }))}
                      />
                      <ul className="space-y-4">
                      {filteredTimeline.map((item, index) => {
                        const Icon = TIMELINE_ICONS[item.kind] ?? ListTodo;
                        const isProduct = item.kind === "product";
                        return (
                          <li key={`${item.kind}-${index}`} className="flex gap-3">
                            <span
                              className={cn(
                                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                                isProduct
                                  ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                                  : "bg-brand/10 text-brand",
                              )}
                            >
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="font-normal capitalize">
                                  {item.kind}
                                </Badge>
                                {item.type ? (
                                  <span className="text-xs text-muted-foreground">
                                    {item.type}
                                  </span>
                                ) : null}
                                {item.highIntent ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                    <Flame className="size-3" />
                                    Buying signal
                                  </span>
                                ) : null}
                                <span className="text-xs text-muted-foreground">
                                  {timeAgo(item.at)}
                                </span>
                              </div>
                              <p className="mt-1 text-sm">{item.label || "(no detail)"}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Activities */}
            <TabsContent value="activities" className="space-y-4">
              <LogActivityCard
                contactId={contact.id}
                onLogged={() =>
                  queryClient.invalidateQueries({ queryKey: ["contact", id] })
                }
              />
              <Card>
                <CardContent className="pt-5">
                  {contact.activities.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No activities logged.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {contact.activities.map((activity) => (
                        <li key={activity.id} className="py-3">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className="font-normal">
                              {activity.type}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {timeAgo(activity.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-medium">
                            {activity.subject || activity.type}
                          </p>
                          {activity.notes ? (
                            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                              {activity.notes}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tickets */}
            <TabsContent value="tickets">
              <Card>
                <CardContent className="pt-5">
                  {contact.tickets.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No support tickets.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {contact.tickets.map((ticket) => (
                        <li
                          key={ticket.id}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{ticket.subject}</p>
                            <p className="text-xs text-muted-foreground">
                              {ticket.priority}
                              <span className="px-1">&middot;</span>
                              {timeAgo(ticket.created_at)}
                            </p>
                          </div>
                          <Badge
                            className={cn(
                              "shrink-0",
                              TICKET_STATUS_STYLES[ticket.status] ??
                                "text-muted-foreground"
                            )}
                          >
                            {ticket.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Deals */}
            <TabsContent value="platform">
              {/* Product history follows the person through conversion, so a
                  contact keeps everything it built up as a lead. */}
              <ProductEngagementCard contactId={contact.id} />
            </TabsContent>

            <TabsContent value="deals">
              <Card>
                <CardContent className="pt-5">
                  {contact.deals.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No deals for this contact.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {contact.deals.map((deal) => (
                        <li
                          key={deal.id}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium">{deal.title}</p>
                            <p className="text-xs text-muted-foreground">
                              created {timeAgo(deal.created_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <span className="text-sm font-medium tabular-nums">
                              {formatINR(deal.value)}
                            </span>
                            {deal.stage_name ? (
                              <Badge variant="outline" className="font-normal">
                                {deal.stage_name}
                              </Badge>
                            ) : null}
                            <Badge
                              className={cn(
                                "",
                                deal.status === "WON"
                                  ? "text-success"
                                  : deal.status === "LOST"
                                    ? "text-danger"
                                    : "text-brand"
                              )}
                            >
                              {deal.status}
                            </Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Purchases */}
            <TabsContent value="purchases">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Receipt className="size-4 text-brand" />
                      Invoices
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {contact.invoices.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No invoices.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {contact.invoices.map((invoice) => (
                          <li
                            key={invoice.id}
                            className="flex items-center justify-between gap-3 py-3"
                          >
                            <div>
                              <p className="text-sm font-medium tabular-nums">
                                {invoice.number}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                issued {formatDate(invoice.issued_at)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <span className="text-sm font-medium tabular-nums">
                                {formatINR(invoice.amount)}
                              </span>
                              <Badge
                                className={cn(
                                  "",
                                  INVOICE_STATUS_STYLES[invoice.status] ??
                                    "text-muted-foreground"
                                )}
                              >
                                {invoice.status}
                              </Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

              </div>
            </TabsContent>

            {/* Meetings */}
            <TabsContent value="meetings">
              <Card>
                <CardContent className="pt-5">
                  {contact.meetings.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No meetings scheduled.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {contact.meetings.map((meeting) => (
                        <li
                          key={meeting.id}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium">{meeting.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(meeting.start_at)}
                              <span className="px-1">&middot;</span>
                              {meeting.duration_min} min
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {meeting.external_provider === "GOOGLE" ? (
                              <Badge className="font-normal text-success">
                                {meeting.mode === "ONLINE" ? "Google Meet" : "Google Calendar"}
                              </Badge>
                            ) : null}
                            <Badge variant="secondary" className="font-normal">
                              {meeting.mode}
                            </Badge>
                            <Badge
                              className={cn(
                                "border-transparent",
                                meeting.status === "SCHEDULED"
                                  ? "bg-brand/10 text-brand"
                                  : meeting.status === "CANCELLED"
                                    ? "bg-danger/10 text-danger"
                                    : "bg-success/10 text-success"
                              )}
                            >
                              {meeting.status}
                            </Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="calls">
              <Card>
                <CardContent className="pt-5">
                  {contact.calls.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No calls recorded for this contact.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {contact.calls.map((call) => (
                        <li key={call.id} className="flex gap-3">
                          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                            <Mic className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {call.outcome ? <Badge variant="brand">{call.outcome}</Badge> : null}
                              {call.sentiment_label ? (
                                <Badge
                                  className={cn(
                                    "",
                                    sentimentStyle(call.sentiment_label)
                                  )}
                                >
                                  {call.sentiment_label}
                                </Badge>
                              ) : null}
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {Math.round(call.duration_sec / 60)} min
                                <span className="px-1">&middot;</span>
                                {timeAgo(call.created_at)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {call.summary || "Voice call"}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
      </div>

      {/* Schedule meeting (linked to this contact → sends an invite) */}
      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        contactId={contact.id}
        defaultTitle={`Meeting with ${contact.name}`}
      />

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this contact?</DialogTitle>
            <DialogDescription>
              {contact.name} and their associations will be removed permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
