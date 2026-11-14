import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  Flame,
  Globe,
  LifeBuoy,
  Lightbulb,
  Mail,
  MapPin,
  MessageCircle,
  Mic,
  Monitor,
  NotebookPen,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  ShoppingCart,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { LogActivityCard } from "@/components/activities/LogActivityCard";
import { TimelineTypeFilter } from "@/components/activities/TimelineTypeFilter";
import { PlatformActivityCard } from "@/components/leads/PlatformActivityCard";
import { ProductEngagementCard } from "@/components/products/ProductEngagementCard";
import { LogCallDialog } from "@/components/telephony/LogCallDialog";
import { RecordingPlayer } from "@/components/telephony/RecordingPlayer";
import type { VoiceCall } from "@/lib/api/contacts";
import {
  addLeadDocument,
  assignLead,
  convertLead,
  deleteLead,
  getAssignmentStrategies,
  getLead,
  getLeadInsight,
  getLeadPlatformEvents,
  updateLead,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type LeadDetail,
  type LeadGrade,
  type PlatformEvent,
} from "@/lib/api/leads";
import { listUsers } from "@/lib/api/users";
import { formatDateTime, formatINR, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/layout/EmptyState";
import { FieldRow, SectionCard } from "@/components/detail/editable-section";
import {
  cleanSocials,
  SocialLinksFields,
  SocialLinksList,
  type SocialsValue,
} from "@/components/social/social-links";
import { ScheduleMeetingDialog } from "@/components/calendar/ScheduleMeetingDialog";
import { CallButton } from "@/components/telephony/CallButton";
import { WhatsAppButton } from "@/components/whatsapp/WhatsAppButton";
import { EmailButton } from "@/components/email/EmailButton";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const GRADE_STYLES: Record<LeadGrade, string> = {
  HOT: "text-danger",
  WARM: "text-warning",
  COLD: "text-neutral",
};

const STATUS_STYLES: Record<string, string> = {
  NEW: "text-brand",
  ATTEMPTED: "text-warning",
  CONNECTED: "text-info",
  QUALIFIED: "text-success",
  NURTURE: "text-neutral",
  NOT_INTERESTED: "text-neutral",
  DISQUALIFIED: "text-danger",
  CONVERTED: "text-success",
};

// The "lead half" of the funnel, in order. The deal pipeline continues from
// Qualified (tracked separately under Deals); Nurture / Unqualified are
// off-track states shown as a side badge rather than a step.
const LEAD_JOURNEY = [
  "NEW",
  "ATTEMPTED",
  "CONNECTED",
  "QUALIFIED",
  "CONVERTED",
] as const;
const JOURNEY_LABELS: Record<string, string> = {
  NEW: "New",
  ATTEMPTED: "Attempted",
  CONNECTED: "Connected",
  QUALIFIED: "Qualified",
  CONVERTED: "Converted",
};

/** Horizontal stepper for the lead's own funnel position. After Converted the
 *  journey continues in the deal pipeline (see the Deals section). */
function LeadJourney({
  status,
  dealsCount,
  convertedContactId,
  onViewContact,
  onSelectStatus,
  isUpdating,
}: {
  status: string;
  dealsCount: number;
  convertedContactId?: string | null;
  onViewContact?: () => void;
  onSelectStatus?: (status: string) => void;
  isUpdating?: boolean;
}) {
  const offTrack =
    status === "NURTURE" || status === "NOT_INTERESTED" || status === "DISQUALIFIED";
  const activeIdx = offTrack
    ? -1
    : LEAD_JOURNEY.indexOf(status as (typeof LEAD_JOURNEY)[number]);

  return (
    <div className="rounded-xl border bg-card p-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lead journey
          </p>
          <span className="hidden text-xs text-muted-foreground/60 sm:inline">
            &bull; Click any stage to advance
          </span>
        </div>
        <div className="flex items-center gap-2">
          {offTrack ? (
            <Badge
              className={cn(
                "",
                STATUS_STYLES[status] ?? "text-muted-foreground"
              )}
            >
              {status === "NURTURE"
                ? "Nurturing"
                : status === "NOT_INTERESTED"
                  ? "Not interested"
                  : "Disqualified"}
            </Badge>
          ) : null}
          {onSelectStatus ? (
            <Select
              value={status}
              onValueChange={(val) => onSelectStatus(val)}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-7 w-[160px] gap-1 border-dashed px-2 text-xs">
                <SelectValue placeholder="Change status" />
              </SelectTrigger>
              <SelectContent align="end">
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {LEAD_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      <ol className="mt-4 flex items-center overflow-x-auto py-2 px-1">
        {LEAD_JOURNEY.map((step, i) => {
          const done = activeIdx >= 0 && i < activeIdx;
          const current = i === activeIdx;
          return (
            <React.Fragment key={step}>
              <li className="flex shrink-0 flex-col items-center">
                <button
                  type="button"
                  onClick={() => onSelectStatus?.(step)}
                  disabled={isUpdating}
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
                    {JOURNEY_LABELS[step]}
                  </span>
                </button>
              </li>
              {i < LEAD_JOURNEY.length - 1 ? (
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
        {status === "CONVERTED" ? (
          <span>
            {dealsCount > 0
              ? `Converted, now tracked as ${dealsCount} deal${dealsCount === 1 ? "" : "s"} in the pipeline.`
              : "Converted to contact."}
            {convertedContactId && onViewContact ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onViewContact}
                  className="font-medium text-brand underline underline-offset-2 hover:opacity-80"
                >
                  View contact &rarr;
                </button>
              </>
            ) : null}
          </span>
        ) : offTrack ? (
          "Off the active funnel. Click any stage above to move back to the active funnel."
        ) : (
          "Reach Qualified, then Convert to open a deal and continue in the pipeline."
        )}
      </p>
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  CALL: Phone,
  MEETING: Users,
  DEMO: Monitor,
  NOTE: NotebookPen,
  EMAIL: Mail,
  TASK: FileText,
};


const sentimentStyle = (label: string | null): string => {
  if (!label) return "bg-muted text-muted-foreground";
  const l = label.toLowerCase();
  if (l.includes("pos")) return "bg-success/10 text-success";
  if (l.includes("neg")) return "bg-danger/10 text-danger";
  return "bg-neutral/10 text-neutral";
};

// Colour for a timeline node, keyed by the item's channel/activity type so each
// interaction type reads at a glance (WhatsApp green, email blue, calls violet…).
const timelineTint = (badge: string): string => {
  switch (badge) {
    case "WHATSAPP":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "EMAIL":
      return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "CALL":
      return "bg-violet-500/10 text-violet-600 dark:text-violet-400";
    case "MEETING":
    case "DEMO":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    // Product events get their own hue so a glance down the rail separates what
    // the lead did in the product from what an agent did to them.
    case "PRODUCT":
      return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400";
    default:
      return "bg-brand/10 text-brand";
  }
};

// Icon for a product event, chosen from the event definition's `category` so a
// product the CRM has never seen still gets a sensible glyph. The categories are
// the ones in EVENT_CATEGORIES (PAGE / ACTION / LIFECYCLE / COMMERCE / SUPPORT);
// anything unrecognised falls back to the generic globe.
const PRODUCT_EVENT_ICONS: Record<string, LucideIcon> = {
  PAGE: Eye,
  COMMERCE: ShoppingCart,
  LIFECYCLE: Sparkles,
  SUPPORT: LifeBuoy,
  ACTION: Globe,
};
const productEventIcon = (e: PlatformEvent): LucideIcon =>
  PRODUCT_EVENT_ICONS[e.category ?? ""] ?? Globe;

// Turn a raw enum ("WHATSAPP", "MEETING") into a readable label.
const BADGE_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  SMS: "SMS",
  CALL: "Call",
  MEETING: "Meeting",
  DEMO: "Demo",
  NOTE: "Note",
  TASK: "Task",
  PRODUCT: "Product",
};
const prettyBadge = (badge: string): string =>
  BADGE_LABELS[badge] ??
  badge.charAt(0) + badge.slice(1).toLowerCase().replaceAll("_", " ");

// Inbound = the lead reached out (green); outbound = we did.
function DirectionPill({ direction }: { direction: string }) {
  const inbound = direction === "INBOUND";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium",
        inbound ? "text-success" : "text-muted-foreground",
      )}
    >
      {inbound ? (
        <ArrowDownLeft className="size-3" />
      ) : (
        <ArrowUpRight className="size-3" />
      )}
      {inbound ? "Received" : "Sent"}
    </span>
  );
}

// A call-transcript turn is either the agent (our AI/rep) or the lead. Providers
// label the agent side variously (agent / assistant / bot / ai); anything else
// is the lead.
const isAgentTurn = (speaker: string): boolean =>
  /agent|assistant|bot|\bai\b/i.test(speaker);

function ScoreBar({
  label,
  value,
  tone = "brand",
}: {
  label: string;
  value: number;
  tone?: "brand" | "risk";
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", tone === "risk" ? "bg-danger" : "bg-brand")}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function TotalDial({ total, grade }: { total: number; grade: LeadGrade }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, total)) / 100) * circumference;
  return (
    <div className="relative size-20 shrink-0">
      <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="6"
          className="stroke-muted"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className="stroke-brand"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-lg font-semibold tabular-nums leading-none">
          {total}
        </span>
        <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">{grade}</span>
      </div>
    </div>
  );
}

/** A single real-data metric tile. All values are derived from the lead's
 *  actual records (activities, messages, calls, deals), never placeholders. */
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 transition-colors duration-120 hover:border-brand/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="flex size-7 shrink-0 items-center justify-center text-brand">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2.5 font-display text-2xl font-semibold leading-none tabular-nums tracking-tight">
        {value}
      </p>
      {sub ? (
        <p className="mt-1.5 truncate text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

/** A compact identity chip (email / phone / location) shown in the hero. When
 *  `href` is set it becomes a mailto:/tel: link. */
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

/** One voice call with an expandable, real transcript + extracted action items. */
function CallRow({ call }: { call: VoiceCall }) {
  const [open, setOpen] = React.useState(false);
  const turns = call.transcript ?? [];
  const actionItems = call.action_items ?? [];
  const minutes =
    call.duration_sec > 0 ? Math.max(1, Math.round(call.duration_sec / 60)) : 0;

  // Human telephony calls get direction icons; the Mic stays for AI-agent
  // calls, whose "direction" is really the bot's, not a person's.
  const humanCall = ["twilio", "exotel", "manual"].includes(call.provider);
  const missed = call.outcome === "MISSED";
  const inbound = call.direction === "INBOUND";
  const CallIcon = !humanCall ? Mic : missed ? PhoneMissed : inbound ? PhoneIncoming : PhoneOutgoing;

  return (
    <li className="overflow-hidden rounded-xl border bg-card">
      <div className="flex gap-3 p-4">
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
            missed
              ? "bg-danger/10 text-danger"
              : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
          )}
        >
          <CallIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {/* Header: outcome + sentiment, meta on the right */}
          <div className="flex flex-wrap items-center gap-1.5">
            {missed ? (
              <Badge variant="danger">Missed call</Badge>
            ) : call.outcome ? (
              <Badge variant="brand">{call.outcome.replaceAll("_", " ")}</Badge>
            ) : (
              <Badge variant="secondary">{humanCall ? "Phone call" : "Voice call"}</Badge>
            )}
            {humanCall && inbound && !missed ? <Badge variant="info">Inbound</Badge> : null}
            {call.provider === "manual" ? <Badge variant="neutral">Logged</Badge> : null}
            {call.sentiment_label ? (
              <Badge
                className={cn(
                  "",
                  sentimentStyle(call.sentiment_label),
                )}
              >
                {call.sentiment_label}
              </Badge>
            ) : null}
            <span className="ml-auto flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
              {minutes > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" />
                  {minutes} min
                </span>
              ) : null}
              <span>{timeAgo(call.created_at)}</span>
            </span>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {call.summary || (humanCall ? (missed ? "The caller hung up before anyone answered." : "Phone call") : "Voice call")}
          </p>

          {call.recording_url ? (
            <div className="mt-2">
              <RecordingPlayer callId={call.id} />
            </div>
          ) : null}

          {actionItems.length > 0 ? (
            <div className="mt-3 rounded-lg bg-muted/50 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Action items
              </p>
              <ul className="space-y-1.5">
                {actionItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {turns.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  open && "rotate-180",
                )}
              />
              {open ? "Hide transcript" : `View transcript · ${turns.length} turns`}
            </button>
          ) : null}
        </div>
      </div>

      {/* Transcript: a real two-sided chat, agent on the right (brand), lead on
          the left (muted), mirroring the inbox. */}
      {turns.length > 0 && open ? (
        <div className="border-t bg-muted/20 px-4 py-4">
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {turns.map((t, i) => {
              const agent = isAgentTurn(t.speaker);
              return (
                <div
                  key={i}
                  className={cn(
                    "flex flex-col gap-1",
                    agent ? "items-end" : "items-start",
                  )}
                >
                  <span className="px-1 text-[11px] font-medium text-muted-foreground">
                    {agent ? "Agent" : "Lead"}
                  </span>
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                      agent
                        ? "rounded-br-sm bg-brand text-brand-foreground"
                        : "rounded-bl-sm bg-card text-foreground",
                    )}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </li>
  );
}

type LeadSection = "contact" | "details" | "notes" | "socials";
type TextField = "name" | "email" | "phone" | "city" | "source" | "campaign";

/** Lead overview: clean, read-only sections that each flip to an editable form
 *  via their own Edit button. Remounts (via key) whenever the lead is saved. */
function OverviewForm({ lead }: { lead: LeadDetail }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<LeadSection | null>(null);

  const seedForm = () => ({
    name: lead.name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    city: lead.city ?? "",
    source: lead.source ?? "",
    campaign: lead.campaign ?? "",
    status: lead.status,
    notes: lead.notes ?? "",
    budget: lead.budget,
  });
  const seedSocials = (): SocialsValue => (lead.socials as SocialsValue | null) ?? {};
  const [form, setForm] = React.useState(seedForm);
  const [socials, setSocials] = React.useState<SocialsValue>(seedSocials);

  const saveMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateLead>[1]) => updateLead(lead.id, patch),
    onSuccess: () => {
      toast.success("Lead updated");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["lead", lead.id] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Open a section from a clean copy of the saved values, so a previously
  // cancelled edit never leaks into the next one.
  const openEdit = (section: LeadSection) => {
    setForm(seedForm());
    setSocials(seedSocials());
    setEditing(section);
  };
  const cancelEdit = () => {
    setForm(seedForm());
    setSocials(seedSocials());
    setEditing(null);
  };
  const savingFor = (section: LeadSection) =>
    saveMutation.isPending && editing === section;

  const input = (key: TextField, label: string, placeholder = "") => (
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

  const hasSocials = !!lead.socials && Object.values(lead.socials).some((v) => v);

  return (
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
            <FieldRow label="Name" value={lead.name} />
            <FieldRow label="Email" value={lead.email} />
            <FieldRow label="Phone" value={lead.phone} />
            <FieldRow label="City" value={lead.city} />
          </dl>
        )}
      </SectionCard>

      {/* Lead details */}
      <SectionCard
        title="Lead details"
        editing={editing === "details"}
        saving={savingFor("details")}
        onEdit={() => openEdit("details")}
        onCancel={cancelEdit}
        onSave={() =>
          saveMutation.mutate({
            source: form.source,
            campaign: form.campaign,
            status: form.status,
            budget: form.budget,
          })
        }
      >
        {editing === "details" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {input("source", "Source")}
            {input("campaign", "Campaign")}
            <div className="grid gap-1.5">
              <Label htmlFor="lead-detail-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as LeadDetail["status"] })}
              >
                <SelectTrigger id="lead-detail-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {LEAD_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Budget confirmed</Label>
              <div className="flex h-9 items-center">
                <Switch
                  checked={form.budget}
                  onCheckedChange={(checked) => setForm({ ...form, budget: checked })}
                />
              </div>
            </div>
          </div>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Source" value={lead.source} />
            <FieldRow label="Campaign" value={lead.campaign} />
            <FieldRow
              label="Status"
              value={
                <Badge
                  className={cn(
                    "",
                    STATUS_STYLES[lead.status] ?? "text-muted-foreground"
                  )}
                >
                  {lead.status}
                </Badge>
              }
            />
            <FieldRow label="Budget confirmed" value={lead.budget ? "Yes" : "No"} />
          </dl>
        )}
      </SectionCard>

      {/* Notes */}
      <SectionCard
        title="Notes"
        editing={editing === "notes"}
        saving={savingFor("notes")}
        onEdit={() => openEdit("notes")}
        onCancel={cancelEdit}
        onSave={() => saveMutation.mutate({ notes: form.notes })}
      >
        {editing === "notes" ? (
          <Textarea
            rows={5}
            value={form.notes}
            placeholder="Add context about this lead…"
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        ) : lead.notes ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">{lead.notes}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
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
        ) : hasSocials ? (
          <SocialLinksList socials={lead.socials} />
        ) : (
          <p className="text-sm text-muted-foreground">No links yet.</p>
        )}
      </SectionCard>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  // Return to the exact leads list URL we came from (preserves ?page=N); fall
  // back to the bare list when this page was opened directly.
  const backToLeads = (location.state as { from?: string } | null)?.from ?? "/leads";

  const leadQuery = useQuery({
    queryKey: ["lead", id],
    queryFn: () => getLead(id),
    enabled: !!id,
  });
  // Product events are folded into the CRM timeline below, so an agent reads one
  // chronological story ("we emailed Tuesday, they hit pricing three times
  // Wednesday, abandoned checkout Thursday") instead of correlating two lists by
  // hand. Same query key as PlatformActivityCard, so the Product tab and the
  // timeline share one cache entry rather than fetching twice.
  const platformEventsQuery = useQuery({
    queryKey: ["lead-platform-events", id],
    queryFn: () => getLeadPlatformEvents(id),
    enabled: !!id,
  });
  const strategiesQuery = useQuery({
    queryKey: ["assignment-strategies"],
    queryFn: getAssignmentStrategies,
  });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const insightQuery = useQuery({
    queryKey: ["lead-insight", id],
    queryFn: () => getLeadInsight(id),
    enabled: !!id,
  });
  const insight = insightQuery.data?.insight;

  const lead = leadQuery.data;
  const users = usersQuery.data ?? [];
  const ownerName = (ownerId: string | null) =>
    ownerId ? (users.find((u) => u.id === ownerId)?.name ?? "Unknown") : "Unassigned";

  // ---- Dialogs ----
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [convertOpen, setConvertOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [docOpen, setDocOpen] = React.useState(false);
  const [strategy, setStrategy] = React.useState("ROUND_ROBIN");
  const [manualOwner, setManualOwner] = React.useState("");
  const [createDeal, setCreateDeal] = React.useState(true);
  const [dealValue, setDealValue] = React.useState("50000");
  const [doc, setDoc] = React.useState({ name: "", doc_type: "file", url: "" });

  // Timeline type filter ("ALL" or a specific activity/channel badge).
  const [timelineFilter, setTimelineFilter] = React.useState<string>("ALL");

  const invalidateLead = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", id] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  };

  const assignMutation = useMutation({
    mutationFn: () =>
      assignLead(id, {
        strategy,
        ownerId: strategy === "MANUAL" ? manualOwner || undefined : undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Assigned to ${result.owner.name} via ${result.strategy}`, {
        description: result.reason ? result.reason : undefined,
      });
      setAssignOpen(false);
      invalidateLead();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const convertMutation = useMutation({
    mutationFn: () =>
      convertLead(id, {
        createDeal,
        value: createDeal ? Number(dealValue) || undefined : undefined,
      }),
    onSuccess: (result) => {
      toast.success(
        result.deal
          ? `Converted to contact with a ${formatINR(result.deal.value)} deal`
          : "Converted to contact"
      );
      setConvertOpen(false);
      invalidateLead();
      navigate(`/contacts/${result.contact.id}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLead(id),
    onSuccess: () => {
      toast.success("Lead deleted");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      navigate("/leads");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const docMutation = useMutation({
    mutationFn: () =>
      addLeadDocument(id, {
        name: doc.name.trim(),
        doc_type: doc.doc_type || undefined,
        url: doc.url || undefined,
      }),
    onSuccess: () => {
      toast.success("Document added");
      setDocOpen(false);
      setDoc({ name: "", doc_type: "file", url: "" });
      invalidateLead();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (newStatus: string) =>
      updateLead(id, { status: newStatus as LeadDetail["status"] }),
    onSuccess: (_, newStatus) => {
      toast.success(
        `Lead moved to ${LEAD_STATUS_LABELS[newStatus as keyof typeof LEAD_STATUS_LABELS] || newStatus}`
      );
      invalidateLead();
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (leadQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <EmptyState
        icon={Users}
        title="Lead not found"
        description="It may have been deleted or converted."
        action={
          <Button asChild variant="outline">
            <Link to={backToLeads}>Back to leads</Link>
          </Button>
        }
      />
    );
  }

  // Merge CRM activities, messages and product events into one timeline, newest
  // first. Product events carry NO direction pill: "Received" is language about
  // messages, and reading "Received" beside "Viewed pricing" suggests the lead
  // sent us something. The PRODUCT badge and its tint already say these are
  // things the lead did rather than things an agent did.
  const timeline = [
    ...lead.activities.map((a) => ({
      key: `a-${a.id}`,
      kind: "activity" as const,
      at: a.created_at,
      icon: ACTIVITY_ICONS[a.type] ?? FileText,
      title: a.subject || a.type,
      sub: a.notes || "",
      direction: a.direction,
      badge: a.type,
      highIntent: false,
    })),
    ...lead.messages.map((m) => ({
      key: `m-${m.id}`,
      kind: "message" as const,
      at: m.at,
      icon: m.channel === "EMAIL" ? Mail : MessageCircle,
      title: m.body,
      sub: "",
      direction: m.direction,
      badge: m.channel,
      highIntent: false,
    })),
    ...(platformEventsQuery.data ?? []).map((e: PlatformEvent) => ({
      key: `p-${e.id}`,
      kind: "product" as const,
      at: e.occurred_at,
      icon: productEventIcon(e),
      title: e.label || e.title || e.event,
      // The page they were on is the detail an agent actually opens with, so it
      // becomes the subtitle. Falls back to the event's own title (a product
      // name, an order id) when the product reported no URL.
      sub: e.page_url || (e.label && e.title ? e.title : "") || "",
      direction: null,
      badge: "PRODUCT",
      highIntent: e.is_high_intent === true,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // Filter chips are built from the badge types actually present, so we never
  // show a filter that would yield nothing. Order follows first appearance.
  const timelineCounts = timeline.reduce<Record<string, number>>((acc, item) => {
    acc[item.badge] = (acc[item.badge] ?? 0) + 1;
    return acc;
  }, {});
  const timelineTypes = Array.from(new Set(timeline.map((i) => i.badge)));
  const filteredTimeline =
    timelineFilter === "ALL"
      ? timeline
      : timeline.filter((i) => i.badge === timelineFilter);

  // ---- Real-data metrics (all derived from this lead's own records) ----
  const interactions = lead.activities.length + lead.messages.length + lead.calls.length;
  const openDeals = lead.deals.filter((d) => d.status === "OPEN");
  const wonDeals = lead.deals.filter((d) => d.status === "WON");
  const openPipeline = openDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const meetingsBooked = lead.calls.filter((c) => c.outcome === "MEETING_BOOKED").length;
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86_400_000)
  );

  return (
    <div className="space-y-5">
      {/* Header, premium gradient hero with identity + surfaced contact info */}
      <div className="reveal">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
          <Link to={backToLeads}>
            <ArrowLeft className="size-4" />
            Leads
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
                    {lead.name}
                  </h1>
                  <Badge
                    className={cn(
                      "gap-1 tabular-nums",
                      GRADE_STYLES[lead.score_grade]
                    )}
                  >
                    {lead.score_grade}
                    <span className="opacity-60">&middot;</span>
                    {lead.score_total}
                  </Badge>
                  <Badge
                    className={cn(
                      "",
                      STATUS_STYLES[lead.status] ?? "text-muted-foreground"
                    )}
                  >
                    {lead.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {lead.source || "Unknown source"}
                  <span className="px-1.5">&middot;</span>
                  owned by {ownerName(lead.owner_id)}
                  <span className="px-1.5">&middot;</span>
                  {lead.last_activity_at ? (
                    <>
                      last activity{" "}
                      {/* Exact date + time; hover shows the relative "x ago". */}
                      <span
                        className="text-foreground"
                        title={timeAgo(lead.last_activity_at)}
                      >
                        {formatDateTime(lead.last_activity_at)}
                      </span>
                    </>
                  ) : (
                    "no activity yet"
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {lead.email ? (
                    <InfoChip icon={Mail} href={`mailto:${lead.email}`}>
                      {lead.email}
                    </InfoChip>
                  ) : null}
                  {lead.phone ? (
                    <InfoChip icon={Phone} href={`tel:${lead.phone}`}>
                      {lead.phone}
                    </InfoChip>
                  ) : null}
                  {lead.city || lead.country ? (
                    <InfoChip icon={MapPin}>
                      {[lead.city, lead.country].filter(Boolean).join(", ")}
                    </InfoChip>
                  ) : null}
                  {lead.budget ? (
                    <InfoChip icon={Wallet}>Budget confirmed</InfoChip>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Action bar, comms on the left, lifecycle on the right */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
              <CallButton leadId={lead.id} />
              <LogCallDialog leadId={lead.id} />
              <WhatsAppButton leadId={lead.id} />
              <EmailButton
                leadId={lead.id}
                recipientName={lead.name}
                recipientEmail={lead.email}
              />
              <span
                aria-hidden
                className="mx-1 hidden h-6 w-px bg-border sm:block"
              />
              <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
                <CalendarClock className="size-4" />
                Schedule
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                <UserCheck className="size-4" />
                Assign
              </Button>
              {lead.converted_contact_id ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                  onClick={() => navigate(`/contacts/${lead.converted_contact_id}`)}
                >
                  <ArrowUpRight className="size-4" />
                  View Contact
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={lead.status === "CONVERTED"}
                  onClick={() => setConvertOpen(true)}
                >
                  <ArrowUpRight className="size-4" />
                  Convert
                </Button>
              )}
              <Button aria-label="Delete lead"
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

      {/* Lead journey (funnel position) */}
      <div className="reveal" style={{ animationDelay: "30ms" }}>
        <LeadJourney
          status={lead.status}
          dealsCount={lead.deals.length}
          convertedContactId={lead.converted_contact_id}
          onViewContact={() => {
            if (lead.converted_contact_id) {
              navigate(`/contacts/${lead.converted_contact_id}`);
            }
          }}
          onSelectStatus={(s) => {
            if (s === "CONVERTED") {
              if (lead.converted_contact_id) {
                navigate(`/contacts/${lead.converted_contact_id}`);
              } else {
                setConvertOpen(true);
              }
            } else {
              updateStatusMutation.mutate(s);
            }
          }}
          isUpdating={updateStatusMutation.isPending}
        />
      </div>

      {/* Real-data metrics */}
      <div
        className="reveal grid grid-cols-2 gap-3 sm:grid-cols-4"
        style={{ animationDelay: "40ms" }}
      >
        <StatCard
          label="Engagement"
          value={interactions}
          sub={`${lead.calls.length} call${lead.calls.length === 1 ? "" : "s"} · ${lead.messages.length} message${lead.messages.length === 1 ? "" : "s"}`}
          icon={Activity}
        />
        <StatCard
          label="Open pipeline"
          value={formatINR(openPipeline)}
          sub={
            openDeals.length
              ? `${openDeals.length} open · ${wonDeals.length} won`
              : wonDeals.length
                ? `${wonDeals.length} won`
                : "No deals yet"
          }
          icon={Wallet}
        />
        <StatCard
          label="Voice calls"
          value={lead.calls.length}
          sub={`${meetingsBooked} meeting${meetingsBooked === 1 ? "" : "s"} booked`}
          icon={Phone}
        />
        <StatCard
          label="Lead age"
          value={ageDays === 0 ? "Today" : `${ageDays}d`}
          sub={`since ${new Date(lead.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
          icon={CalendarClock}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Tabs */}
        <div className="reveal lg:col-span-2" style={{ animationDelay: "60ms" }}>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timeline">
                Timeline
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {timeline.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="platform">Product</TabsTrigger>
              <TabsTrigger value="deals">
                Deals
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {lead.deals.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="calls">
                Calls
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {lead.calls.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="documents">
                Documents
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {lead.documents.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <OverviewForm key={lead.updated_at} lead={lead} />
            </TabsContent>

            <TabsContent value="timeline">
              <Card>
                <CardContent className="pt-5">
                  {timeline.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No activity yet. Log a call or note to get started.
                    </p>
                  ) : (
                    <>
                      {/* Filter by activity/channel type */}
                      <TimelineTypeFilter
                        total={timeline.length}
                        value={timelineFilter}
                        onChange={setTimelineFilter}
                        options={timelineTypes.map((type) => ({
                          value: type,
                          label: prettyBadge(type),
                          count: timelineCounts[type],
                        }))}
                      />

                      {filteredTimeline.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No {prettyBadge(timelineFilter)} activity for this lead.
                        </p>
                      ) : (
                    <ul className="relative max-h-[30rem] overflow-y-auto pr-1">
                      {filteredTimeline.map((item, idx) => {
                        const Icon = item.icon;
                        const last = idx === filteredTimeline.length - 1;
                        return (
                          <li
                            key={item.key}
                            className="relative flex gap-3 pb-5 last:pb-0"
                          >
                            {/* Connector rail linking one node to the next. */}
                            {!last ? (
                              <span
                                aria-hidden
                                className="absolute left-4 top-9 bottom-0 w-px -translate-x-1/2 bg-border"
                              />
                            ) : null}
                            <span
                              className={cn(
                                "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                                timelineTint(item.badge),
                              )}
                            >
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-semibold">
                                  {prettyBadge(item.badge)}
                                </span>
                                {item.direction ? (
                                  <DirectionPill direction={item.direction} />
                                ) : null}
                                {item.highIntent ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                    <Flame className="size-3" />
                                    Buying signal
                                  </span>
                                ) : null}
                                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {timeAgo(item.at)}
                                </span>
                              </div>
                              <p
                                className={cn(
                                  "mt-1 line-clamp-3 whitespace-pre-wrap text-sm",
                                  item.kind === "message"
                                    ? "text-foreground"
                                    : "font-medium",
                                )}
                              >
                                {item.title}
                              </p>
                              {item.sub ? (
                                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                                  {item.sub}
                                </p>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="platform">
              {/* Rollup first (what this person IS, and how close to buying),
                  then the raw stream (what they DID). An agent picking up the
                  phone needs the summary before the log. */}
              <div className="space-y-4">
                <ProductEngagementCard leadId={lead.id} />
                <PlatformActivityCard leadId={lead.id} snapshot={lead.custom_fields} />
              </div>
            </TabsContent>

            <TabsContent value="deals">
              <Card>
                <CardContent className="pt-5">
                  {lead.deals.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No deals yet. Convert the lead to open one.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {lead.deals.map((deal) => (
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

            <TabsContent value="calls">
              <Card>
                <CardContent className="pt-5">
                  {lead.calls.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No calls recorded for this lead.
                    </p>
                  ) : (
                    <ul className="max-h-[32rem] space-y-2.5 overflow-y-auto pr-1">
                      {lead.calls.map((call) => (
                        <CallRow key={call.id} call={call} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Documents</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setDocOpen(true)}>
                    <Plus className="size-3.5" />
                    Add document
                  </Button>
                </CardHeader>
                <CardContent>
                  {lead.documents.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No documents attached to this lead.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {lead.documents.map((document) => (
                        <li
                          key={document.id}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <FileText className="size-4 shrink-0 text-brand" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{document.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {document.doc_type || "file"}
                                <span className="px-1">&middot;</span>
                                {timeAgo(document.created_at)}
                              </p>
                            </div>
                          </div>
                          {document.url ? (
                            <Button asChild variant="ghost" size="sm" className="text-brand">
                              <a href={document.url} target="_blank" rel="noreferrer">
                                Open
                              </a>
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <section className="reveal" style={{ animationDelay: "120ms" }}>
            <Card>
              <CardHeader>
                <CardTitle>Score breakdown</CardTitle>
              </CardHeader>
              <CardContent className="flex items-start gap-4">
                <TotalDial total={lead.score.total} grade={lead.score.grade} />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <ScoreBar label="Interest" value={lead.score.interest} />
                  <ScoreBar label="Intent" value={lead.score.intent} />
                  <ScoreBar label="Engagement" value={lead.score.engagement} />
                  <ScoreBar label="Risk" value={lead.score.risk} tone="risk" />
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="reveal" style={{ animationDelay: "150ms" }}>
            <Card>
              <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-brand">
                  <Sparkles className="size-4" />
                </span>
                <CardTitle>AI assessment</CardTitle>
                {insightQuery.isFetching ? (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                    analyzing…
                  </span>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {insightQuery.isLoading || !insight ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{insight.summary}</p>
                    {insight.reasons.length ? (
                      <ul className="space-y-1">
                        {insight.reasons.map((reason, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-xs text-muted-foreground"
                          >
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-700" />
                            <span className="min-w-0">{reason}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="border-l-2 border-brand pl-3 py-1">
                      <div className="flex items-center gap-1.5">
                        <Lightbulb className="size-3.5 text-brand" />
                        <p className="text-xs font-medium">Recommended next step</p>
                      </div>
                      <p className="mt-1 text-sm">{insight.recommendedAction}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="reveal" style={{ animationDelay: "180ms" }}>
            <LogActivityCard leadId={id} onLogged={invalidateLead} />
          </section>
        </div>
      </div>

      {/* Schedule meeting (linked to this lead → sends an invite) */}
      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        leadId={lead.id}
        defaultTitle={`Meeting with ${lead.name}`}
      />

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign lead</DialogTitle>
            <DialogDescription>
              Pick a routing strategy; MANUAL lets you choose the owner directly.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-detail-strategy">Strategy</Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger id="lead-detail-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(strategiesQuery.data ?? ["ROUND_ROBIN", "MANUAL"]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {strategy === "MANUAL" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="lead-detail-owner">Owner</Label>
                <Select value={manualOwner || undefined} onValueChange={setManualOwner}>
                  <SelectTrigger id="lead-detail-owner">
                    <SelectValue placeholder="Pick a teammate" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={assignMutation.isPending}
              disabled={strategy === "MANUAL" && !manualOwner}
              onClick={() => assignMutation.mutate()}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert dialog */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convert to contact</DialogTitle>
            <DialogDescription>
              Creates a customer contact from this lead, optionally with an open deal.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex items-center justify-between border-t pt-3">
              <div>
                <p className="text-sm font-medium">Create a deal</p>
                <p className="text-xs text-muted-foreground">
                  Opens a deal in the default pipeline.
                </p>
              </div>
              <Switch checked={createDeal} onCheckedChange={setCreateDeal} />
            </div>
            {createDeal ? (
              <div className="grid gap-1.5">
                <Label htmlFor="deal-value">Deal value (INR)</Label>
                <Input
                  id="deal-value"
                  type="number"
                  min="0"
                  value={dealValue}
                  onChange={(e) => setDealValue(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button loading={convertMutation.isPending} onClick={() => convertMutation.mutate()}>
              Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this lead?</DialogTitle>
            <DialogDescription>
              {lead.name} and their documents will be removed permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add document dialog */}
      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add document</DialogTitle>
            <DialogDescription>Attach a link to a proposal, quote or note.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-name">Name</Label>
              <Input
                id="doc-name"
                value={doc.name}
                onChange={(e) => setDoc({ ...doc, name: e.target.value })}
                placeholder="Proposal v2"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-type">Type</Label>
              <Input
                id="doc-type"
                value={doc.doc_type}
                onChange={(e) => setDoc({ ...doc, doc_type: e.target.value })}
                placeholder="proposal"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-url">URL</Label>
              <Input
                id="doc-url"
                value={doc.url}
                onChange={(e) => setDoc({ ...doc, url: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={docMutation.isPending}
              disabled={!doc.name.trim()}
              onClick={() => docMutation.mutate()}
            >
              Add document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
