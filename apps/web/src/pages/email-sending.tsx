import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  Copy,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addSuppression,
  checkSendingDomain,
  createSenderIdentity,
  deleteSendingDomain,
  deleteSenderIdentity,
  getEmailReputation,
  listEmailSendMessages,
  listSenderIdentities,
  listSendingDomains,
  listSuppressions,
  onboardSendingDomain,
  removeSuppression,
  updateSenderIdentity,
  type EmailCategory,
  type SenderIdentity,
  type SendingDomain,
  type SendingStatus,
} from "@/lib/api/email-domains";
import { formatDateTime } from "@/lib/format";

const CATEGORIES: EmailCategory[] = [
  "TRANSACTIONAL",
  "NOTIFICATION",
  "MARKETING",
];

const statusBadge = (status: SendingDomain["status"]) => {
  if (status === "VERIFIED") return <Badge variant="success">Verified</Badge>;
  if (status === "FAILED") return <Badge variant="danger">Failed</Badge>;
  if (status === "DISABLED") return <Badge variant="neutral">Disabled</Badge>;
  return <Badge variant="warning">Pending</Badge>;
};

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  } catch {
    toast.error("Could not copy.");
  }
};

function CopyButton({ value }: { value: string }) {
  return (
    <button aria-label="Copy"
      type="button"
      onClick={() => copy(value)}
      className="ml-1.5 inline-flex text-muted-foreground hover:text-brand"
      title="Copy"
    >
      <Copy className="size-3.5" />
    </button>
  );
}

function DnsTable({ domain }: { domain: SendingDomain }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Purpose</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Name (host)</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="text-right">Priority</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {domain.dns_records.map((r, i) => (
            <TableRow key={`${r.purpose}-${i}`}>
              <TableCell className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                {r.purpose.replace(/_/g, " ")}
              </TableCell>
              <TableCell className="text-xs font-semibold">{r.type}</TableCell>
              <TableCell className="font-mono text-xs">
                <span className="break-all">{r.name}</span>
                <CopyButton value={r.name} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                <span className="break-all">{r.value}</span>
                <CopyButton value={r.value} />
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {r.priority ?? "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---- Onboard form (none / form state) ----
function OnboardCard({ onCreated }: { onCreated: () => void }) {
  const [subdomain, setSubdomain] = React.useState("");
  const isApex =
    subdomain.trim().split(".").length === 2 && subdomain.trim().length > 0;

  const mutation = useMutation({
    mutationFn: () => onboardSendingDomain(subdomain.trim()),
    onSuccess: () => {
      toast.success("Domain added. Publish the DNS records to verify it.");
      onCreated();
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not add the domain."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add your sending domain</CardTitle>
        <CardDescription>
          A dedicated subdomain is recommended (for example mail.yourbrand.com).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!subdomain.trim()) return;
            mutation.mutate();
          }}
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="subdomain">Domain</Label>
            <Input
              id="subdomain"
              placeholder="mail.yourbrand.com"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
            {isApex ? (
              <p className="text-xs text-amber-700">
                This looks like a root domain. A subdomain (mail.yourbrand.com)
                is recommended.
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={!subdomain.trim()}
          >
            Get started
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---- Sender identities (verified state) ----
function defaultsOf(identity: SenderIdentity): EmailCategory[] {
  const out: EmailCategory[] = [];
  if (identity.is_default_transactional) out.push("TRANSACTIONAL");
  if (identity.is_default_notification) out.push("NOTIFICATION");
  if (identity.is_default_marketing) out.push("MARKETING");
  return out;
}

function IdentitiesCard({ domain }: { domain: SendingDomain }) {
  const queryClient = useQueryClient();
  const identitiesQuery = useQuery({
    queryKey: ["sender-identities"],
    queryFn: listSenderIdentities,
  });
  const identities = (identitiesQuery.data ?? []).filter(
    (i) => i.sending_domain_id === domain.id && i.status === "ACTIVE",
  );

  const [open, setOpen] = React.useState(false);
  const [localPart, setLocalPart] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [replyTo, setReplyTo] = React.useState("");
  const [defaults, setDefaults] = React.useState<EmailCategory[]>([
    "NOTIFICATION",
  ]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["sender-identities"] });

  const createMutation = useMutation({
    mutationFn: () =>
      createSenderIdentity({
        sendingDomainId: domain.id,
        emailAddress: `${localPart.trim()}@${domain.subdomain}`,
        displayName: displayName.trim() || undefined,
        replyTo: replyTo.trim() || undefined,
        defaultFor: defaults,
      }),
    onSuccess: () => {
      toast.success("Sender added.");
      setOpen(false);
      setLocalPart("");
      setDisplayName("");
      setReplyTo("");
      setDefaults(["NOTIFICATION"]);
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not add the sender."),
  });

  const toggleMutation = useMutation({
    mutationFn: ({
      identity,
      category,
    }: {
      identity: SenderIdentity;
      category: EmailCategory;
    }) => {
      const current = new Set(defaultsOf(identity));
      if (current.has(category)) current.delete(category);
      else current.add(category);
      return updateSenderIdentity(identity.id, { defaultFor: [...current] });
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast.error(e.message || "Could not update defaults."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSenderIdentity(id),
    onSuccess: () => {
      toast.success("Sender removed.");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not remove the sender."),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Sender addresses</CardTitle>
          <CardDescription>
            Pick which address is the default for each email type.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Add sender
        </Button>
      </CardHeader>
      <CardContent>
        {identitiesQuery.isLoading ? (
          <SpinnerOverlay label="Loading senders" size="md" />
        ) : identities.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No sender addresses yet"
            description={`Add an address on ${domain.subdomain}, then mark it default for each email type, until then, email goes from the platform default.`}
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" /> Add sender
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {identities.map((identity) => (
              <div
                key={identity.id}
                className="flex flex-col gap-2.5 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {identity.display_name
                      ? `${identity.display_name} <${identity.email_address}>`
                      : identity.email_address}
                  </p>
                  {identity.reply_to ? (
                    <p className="truncate text-xs text-muted-foreground">
                      Reply-To: {identity.reply_to}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {CATEGORIES.map((category) => {
                    const active = defaultsOf(identity).includes(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() =>
                          toggleMutation.mutate({ identity, category })
                        }
                        disabled={toggleMutation.isPending}
                        className={
                          "rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors " +
                          (active
                            ? "border-transparent bg-brand text-brand-foreground"
                            : "text-muted-foreground hover:border-brand hover:text-brand")
                        }
                        title={
                          active
                            ? `Default for ${category}`
                            : `Make default for ${category}`
                        }
                      >
                        {active ? (
                          <Check className="mr-0.5 inline size-3" />
                        ) : null}
                        {category.charAt(0) + category.slice(1).toLowerCase()}
                      </button>
                    );
                  })}
                  <Button aria-label="Remove sender"
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(identity.id)}
                    loading={
                      deleteMutation.isPending &&
                      deleteMutation.variables === identity.id
                    }
                    title="Remove sender"
                  >
                    {deleteMutation.isPending &&
                    deleteMutation.variables === identity.id ? null : (
                      <Trash2 className="size-4 text-red-600" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a sender address</DialogTitle>
            <DialogDescription>
              The address must be on {domain.subdomain}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="localPart">Address</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="localPart"
                  placeholder="crm"
                  value={localPart}
                  onChange={(e) => setLocalPart(e.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <span className="whitespace-nowrap text-sm text-muted-foreground">
                  @{domain.subdomain}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Display name (optional)</Label>
              <Input
                id="displayName"
                placeholder="Acme Inc."
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="replyTo">Reply-To (optional)</Label>
              <Input
                id="replyTo"
                type="email"
                placeholder="support@yourbrand.example.com"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Where replies go if different from the sending address.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Default for</Label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((category) => {
                  const active = defaults.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() =>
                        setDefaults((prev) =>
                          prev.includes(category)
                            ? prev.filter((c) => c !== category)
                            : [...prev, category],
                        )
                      }
                      className={
                        "rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors " +
                        (active
                          ? "border-transparent bg-brand text-brand-foreground"
                          : "text-muted-foreground hover:border-brand hover:text-brand")
                      }
                    >
                      {category.charAt(0) + category.slice(1).toLowerCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={!localPart.trim()}
            >
              Add sender
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---- Sending health (verified state) ----
const STATUS_BADGE: Record<
  SendingStatus,
  { variant: "success" | "warning" | "danger"; label: string }
> = {
  ACTIVE: { variant: "success", label: "Healthy" },
  WARNING: { variant: "warning", label: "Warning" },
  THROTTLED: { variant: "warning", label: "Throttled" },
  PAUSED: { variant: "danger", label: "Paused" },
};

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_STYLES: Record<Tone, { value: string; dot: string }> = {
  neutral: { value: "text-foreground", dot: "bg-muted-foreground/40" },
  good: { value: "text-emerald-700", dot: "bg-emerald-500" },
  warn: { value: "text-amber-700", dot: "bg-amber-500" },
  bad: { value: "text-red-600", dot: "bg-red-500" },
};

// SES guard rails: bounce >5% review / >10% critical; complaint >0.1% review.
const bounceTone = (rate: number): Tone =>
  rate >= 0.1 ? "bad" : rate >= 0.05 ? "warn" : "good";
const complaintTone = (rate: number): Tone =>
  rate >= 0.005 ? "bad" : rate >= 0.001 ? "warn" : "good";

function HealthStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className="rounded-lg border bg-card p-3.5 transition-colors hover:border-brand/30">
      <div className="flex items-center gap-1.5">
        <span className={"size-1.5 rounded-full " + t.dot} />
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className={"mt-1 text-2xl font-semibold tabular-nums " + t.value}>
        {value}
      </p>
    </div>
  );
}

function SendingHealthCard() {
  const query = useQuery({
    queryKey: ["email-reputation"],
    queryFn: getEmailReputation,
  });
  const data = query.data;
  const status = data?.status ?? "ACTIVE";
  const badge = STATUS_BADGE[status];
  const rates = data?.rates;
  const events = (data?.events ?? []).slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            Sending health
          </CardTitle>
          <CardDescription>Rolling 14-day delivery reputation.</CardDescription>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "PAUSED" ? (
          <p className="text-sm text-danger">
            Sending is paused for this domain. Transactional email still goes
            out; marketing and notifications are held until reputation recovers.
          </p>
        ) : null}
        {query.isLoading ? (
          <SpinnerOverlay label="Loading reputation" size="md" />
        ) : !rates ? (
          <p className="text-sm text-muted-foreground">
            Reputation metrics are not available yet (they appear once sends are
            tracked).
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <HealthStat
              label="Sent (14d)"
              value={rates.sends.toLocaleString()}
            />
            <HealthStat
              label="Bounce rate"
              value={pct(rates.bounceRate)}
              tone={rates.sends > 0 ? bounceTone(rates.bounceRate) : "neutral"}
            />
            <HealthStat
              label="Complaint rate"
              value={pct(rates.complaintRate)}
              tone={
                rates.sends > 0 ? complaintTone(rates.complaintRate) : "neutral"
              }
            />
          </div>
        )}
        {events.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              Recent status changes
            </p>
            <ul className="space-y-1">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-muted-foreground">
                    {e.from_status} {"->"}{" "}
                    <span className="font-medium text-foreground">
                      {e.to_status}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateTime(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---- Suppressions (verified state) ----
function SuppressionsCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["email-suppressions"],
    queryFn: listSuppressions,
  });
  const rows = query.data ?? [];
  const [email, setEmail] = React.useState("");
  const [filter, setFilter] = React.useState("");

  const fq = filter.trim().toLowerCase();
  const filtered = fq
    ? rows.filter((s) => `${s.email} ${s.reason}`.toLowerCase().includes(fq))
    : rows;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["email-suppressions"] });

  const addMutation = useMutation({
    mutationFn: () => addSuppression(email.trim()),
    onSuccess: () => {
      toast.success("Address suppressed.");
      setEmail("");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not add the suppression."),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeSuppression(id),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast.error(e.message || "Could not remove the suppression."),
  });

  return (
    <Card className="flex max-h-[520px] flex-col">
      <CardHeader>
        <CardTitle>Suppressions</CardTitle>
        <CardDescription>
          Addresses that hard-bounced or complained are blocked automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3 overflow-hidden">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) addMutation.mutate();
          }}
        >
          <Input
            placeholder="block@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
          <Button
            type="submit"
            variant="outline"
            loading={addMutation.isPending}
            disabled={!email.trim()}
          >
            Block
          </Button>
        </form>
        {query.isLoading ? (
          <SpinnerOverlay label="Loading suppressions" size="md" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No suppressed addresses.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search suppressed addresses..."
                className="h-8 pl-8 text-xs"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matches.</p>
            ) : (
              <div className="-mr-1 flex-1 space-y-1.5 overflow-y-auto pr-1">
                {filtered.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate font-mono text-xs">
                      {s.email}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="neutral">
                        {s.reason.replace(/_/g, " ")}
                      </Badge>
                      <button aria-label="Remove"
                        type="button"
                        onClick={() => removeMutation.mutate(s.id)}
                        disabled={
                          removeMutation.isPending &&
                          removeMutation.variables === s.id
                        }
                        className="text-muted-foreground hover:text-red-600 disabled:opacity-50"
                        title="Remove"
                      >
                        {removeMutation.isPending &&
                        removeMutation.variables === s.id ? (
                          <Spinner size="xs" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Message log (verified state) ----
const MSG_STATUSES = [
  "SENT",
  "DELIVERED",
  "BOUNCED",
  "COMPLAINED",
  "FAILED",
  "SUPPRESSED",
  "QUEUED",
  "REJECTED",
];

function MessageLogCard() {
  const query = useQuery({
    queryKey: ["email-send-messages"],
    queryFn: listEmailSendMessages,
  });
  const rows = query.data ?? [];

  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [category, setCategory] = React.useState("ALL");

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((m) => {
    if (status !== "ALL" && m.status !== status) return false;
    if (category !== "ALL" && m.category !== category) return false;
    if (q && !`${m.to_address} ${m.subject ?? ""}`.toLowerCase().includes(q))
      return false;
    return true;
  });

  return (
    <Card className="flex max-h-[520px] flex-col">
      <CardHeader>
        <CardTitle>Recent sends</CardTitle>
        <CardDescription>
          Delivery status of the latest emails from your domain.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3 overflow-hidden">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search recipient or subject..."
              className="h-8 pl-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-full text-xs sm:w-[130px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {MSG_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 w-full text-xs sm:w-[140px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {query.isLoading ? (
          <SpinnerOverlay label="Loading sends" size="md" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sends yet.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sends match these filters.
          </p>
        ) : (
          <div className="flex-1 overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 50).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">
                      {m.to_address}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {m.subject ?? "-"}
                    </TableCell>
                    <TableCell className="text-xs">{m.category}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          m.status === "DELIVERED"
                            ? "success"
                            : m.status === "BOUNCED" ||
                                m.status === "COMPLAINED"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Page ----
export default function EmailSendingPage() {
  const queryClient = useQueryClient();
  const domainsQuery = useQuery({
    queryKey: ["sending-domains"],
    queryFn: listSendingDomains,
  });
  const domain = domainsQuery.data?.[0];

  const invalidateDomains = () =>
    queryClient.invalidateQueries({ queryKey: ["sending-domains"] });

  const checkMutation = useMutation({
    mutationFn: (id: string) => checkSendingDomain(id),
    onSuccess: (d) => {
      if (d.status === "VERIFIED") toast.success("Domain verified.");
      else
        toast.message(
          "Still pending. DNS can take a few minutes to propagate.",
        );
      invalidateDomains();
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not check verification."),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteSendingDomain(id),
    onSuccess: () => {
      toast.success("Domain removed.");
      invalidateDomains();
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not remove the domain."),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Email Sending"
        description="Send platform emails (welcome, OTP, transactional, campaigns) from your own brand domain instead of contact@acme.example.com."
      />

      {domainsQuery.isLoading ? (
        <Card>
          <CardContent className="py-4">
            <SpinnerOverlay label="Loading sending domain" />
          </CardContent>
        </Card>
      ) : !domain ? (
        <OnboardCard onCreated={invalidateDomains} />
      ) : (
        <>
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" />
                  {domain.subdomain}
                </CardTitle>
                {statusBadge(domain.status)}
              </div>
              <CardDescription>
                MAIL FROM: {domain.mail_from_subdomain ?? "-"}
                {domain.ses_configuration_set
                  ? ` . Config set: ${domain.ses_configuration_set}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {domain.status === "VERIFIED" ? (
                <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
                    <ShieldCheck className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Your domain is verified and ready to send.
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Add a sender address below and set it as default for each
                      email type to send from your domain.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
                    <RefreshCw className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                      Awaiting DNS verification
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Publish the records below in your DNS, then check
                      verification. This can take a few minutes to propagate.
                    </p>
                  </div>
                </div>
              )}
              <DnsTable domain={domain} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => checkMutation.mutate(domain.id)}
                    loading={checkMutation.isPending}
                  >
                    {checkMutation.isPending ? null : (
                      <RefreshCw className="size-4" />
                    )}{" "}
                    Check verification
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${domain.subdomain}? Sends revert to the platform default.`,
                        )
                      )
                        removeMutation.mutate(domain.id);
                    }}
                    loading={removeMutation.isPending}
                  >
                    {removeMutation.isPending ? null : (
                      <Trash2 className="size-4 text-red-600" />
                    )}{" "}
                    Remove domain
                  </Button>
                </div>
                {domain.last_checked_at ? (
                  <p className="text-xs text-muted-foreground">
                    Last checked: {formatDateTime(domain.last_checked_at)}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {domain.status === "VERIFIED" ? (
            <>
              <SendingHealthCard />
              <IdentitiesCard domain={domain} />
              <div className="space-y-5">
                <SuppressionsCard />
                <MessageLogCard />
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
