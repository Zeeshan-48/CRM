import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, Inbox, Play, TrendingUp } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  approveAllOutreach,
  approveOutreach,
  getSalesMetrics,
  getSalesSettings,
  listAgentRuns,
  listAgents,
  listOutreach,
  rejectOutreach,
  runAgent,
  updateSalesSettings,
  type AgentOutreach,
  type AgentRunResult,
  type SalesSettingsPatch,
} from "@/lib/api/agents";
import { formatNumber, timeAgo } from "@/lib/format";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// Everything the sales agent needs lives on this page: generate drafts, review
// them, configure the automation, and see how it is performing.

/** Refresh every sales-scoped query after an action changes agent state. */
const useSalesRefresh = () => {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    for (const key of ["agents", "agent-runs", "sales-outreach", "sales-metrics", "sales-settings"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [queryClient]);
};

// ---- Run control ----

function SalesRunCard() {
  const refresh = useSalesRefresh();
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: listAgents });
  const sales = agents?.find((a) => a.key === "sales");

  const [limit, setLimit] = React.useState("5");
  const [result, setResult] = React.useState<AgentRunResult | null>(null);

  const run = useMutation({
    mutationFn: () => {
      const parsed = parseInt(limit, 10);
      return runAgent("sales", { limit: Number.isNaN(parsed) ? undefined : parsed });
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(data.summary || "Sales agent run completed");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="reveal" style={{ animationDelay: "60ms" }}>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center text-brand">
              <TrendingUp className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-sm font-semibold tracking-tight">
                {sales?.name ?? "Sales Agent"}
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Reads each hot lead's history and drafts a personalised message for you to review.
              </p>
              {sales ? (
                <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                  {formatNumber(sales.runCount)} runs
                  <span className="px-1.5">&middot;</span>
                  last run {timeAgo(sales.lastRunAt)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="sales-agent-how-many-leads" className="text-xs text-muted-foreground">How many leads</Label>
              <Input id="sales-agent-how-many-leads"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="h-8 w-24"
              />
            </div>
            <Button
              size="sm"
              className="h-8"
              onClick={() => run.mutate()}
              disabled={run.isPending}
              loading={run.isPending}
            >
              {run.isPending ? null : <Play className="size-3.5" />}
              {run.isPending ? "Generating..." : "Generate drafts"}
            </Button>
          </div>

          {result ? (
            <div className="mt-4 rounded-md border border-brand/30 bg-brand/5 p-3">
              <p className="text-sm font-medium">{result.summary}</p>
              {result.actions.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {result.actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Check className="mt-0.5 size-3 shrink-0 text-brand" />
                      <span className="min-w-0">{action}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No new drafts were needed this run.
                </p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

// ---- Effectiveness (closed-loop outcomes) ----

function SalesEffectivenessPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["sales-metrics"],
    queryFn: () => getSalesMetrics(30),
  });

  const stats = [
    { label: "Drafted", value: data?.drafted ?? 0 },
    { label: "Sent", value: data?.sent ?? 0 },
    { label: "Replied", value: data?.replied ?? 0 },
    { label: "Reply rate", value: `${data?.replyRate ?? 0}%` },
    { label: "Meetings", value: data?.meetings ?? 0 },
    { label: "Awaiting review", value: data?.pending ?? 0 },
  ];

  return (
    <section className="reveal" style={{ animationDelay: "90ms" }}>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Effectiveness</CardTitle>
          <span className="text-xs text-muted-foreground">last {data?.windowDays ?? 30} days</span>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {stats.map((s) => (
                <div key={s.label} className="border-t pt-3">
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {typeof s.value === "number" ? formatNumber(s.value) : s.value}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---- Automation settings ----

function SalesAutomationCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["sales-settings"],
    queryFn: getSalesSettings,
  });

  const [enabled, setEnabled] = React.useState(false);
  const [autoSend, setAutoSend] = React.useState(false);
  const [escalateToCall, setEscalateToCall] = React.useState(false);
  const [threshold, setThreshold] = React.useState("65");
  const [dailyCap, setDailyCap] = React.useState("20");
  const [tone, setTone] = React.useState("");
  const [prefer, setPrefer] = React.useState("WHATSAPP");
  const [dirty, setDirty] = React.useState(false);

  // Hydrate local form state whenever the server settings load/refresh.
  React.useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setAutoSend(data.autoSend);
    setEscalateToCall(data.escalateToCall);
    setThreshold(String(data.scoreThreshold));
    setDailyCap(String(data.dailyCap));
    setTone(data.tone ?? "");
    setPrefer(data.channels?.[0] === "EMAIL" ? "EMAIL" : "WHATSAPP");
    setDirty(false);
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: SalesSettingsPatch) => updateSalesSettings(patch),
    onSuccess: () => {
      toast.success("Sales automation settings saved");
      void queryClient.invalidateQueries({ queryKey: ["sales-settings"] });
      setDirty(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleSave = () => {
    const t = parseInt(threshold, 10);
    const c = parseInt(dailyCap, 10);
    save.mutate({
      enabled,
      autoSend,
      escalateToCall,
      scoreThreshold: Number.isNaN(t) ? undefined : t,
      dailyCap: Number.isNaN(c) ? undefined : c,
      tone: tone.trim() ? tone.trim() : null,
      channels: prefer === "EMAIL" ? ["EMAIL", "WHATSAPP"] : ["WHATSAPP", "EMAIL"],
    });
  };

  return (
    <section className="reveal" style={{ animationDelay: "120ms" }}>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            Automation
            <Badge variant={enabled ? "brand" : "secondary"}>{enabled ? "On" : "Off"}</Badge>
          </CardTitle>
          {typeof data?.activeEnrollments === "number" ? (
            <span className="text-xs text-muted-foreground">
              {formatNumber(data.activeEnrollments)} in sequence
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 border-t pt-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Run automatically</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Enrol hot, recently-active leads and draft a multi-touch sequence on a schedule.
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => {
                    setEnabled(v);
                    setDirty(true);
                  }}
                />
              </div>

              {/* Working hours are workspace-wide (Settings), shown read-only
                  so it's clear when the automation is allowed to run. */}
              {data?.workingHours ? (
                <p className="text-xs text-muted-foreground">
                  Runs only during working hours,{" "}
                  <span className="tabular-nums">
                    {data.workingHours.start}-{data.workingHours.end}
                  </span>{" "}
                  {data.workingHours.days
                    .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d])
                    .join(", ")}{" "}
                  ({data.workingHours.timezone}).{" "}
                  <Link to="/settings" className="text-brand hover:underline">
                    Change in Settings
                  </Link>
                </p>
              ) : null}

              <div className="flex items-start justify-between gap-4 border-t pt-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Auto-send drafts</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Off (recommended): every message waits in the review queue for a human. On:
                    sequence touches send immediately. Replies are always reviewed.
                  </p>
                </div>
                <Switch
                  checked={autoSend}
                  onCheckedChange={(v) => {
                    setAutoSend(v);
                    setDirty(true);
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Finish with a call</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    After the last message, add a call task for the lead's owner, due the next day.
                  </p>
                </div>
                <Switch
                  checked={escalateToCall}
                  onCheckedChange={(v) => {
                    setEscalateToCall(v);
                    setDirty(true);
                  }}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="sales-agent-minimum-lead-score" className="text-xs text-muted-foreground">Minimum lead score</Label>
                  <Input id="sales-agent-minimum-lead-score"
                    type="number"
                    min={0}
                    max={100}
                    value={threshold}
                    onChange={(e) => {
                      setThreshold(e.target.value);
                      setDirty(true);
                    }}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sales-agent-daily-draft-cap" className="text-xs text-muted-foreground">Daily draft cap</Label>
                  <Input id="sales-agent-daily-draft-cap"
                    type="number"
                    min={1}
                    max={500}
                    value={dailyCap}
                    onChange={(e) => {
                      setDailyCap(e.target.value);
                      setDirty(true);
                    }}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sales-agent-preferred-channel" className="text-xs text-muted-foreground">Preferred channel</Label>
                  <Select
                    value={prefer}
                    onValueChange={(v) => {
                      setPrefer(v);
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger id="sales-agent-preferred-channel" className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WHATSAPP">WhatsApp first</SelectItem>
                      <SelectItem value="EMAIL">Email first</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sales-agent-tone-optional" className="text-xs text-muted-foreground">Tone (optional)</Label>
                  <Input id="sales-agent-tone-optional"
                    value={tone}
                    onChange={(e) => {
                      setTone(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="warm, concise, consultative…"
                    className="h-8"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleSave}
                  disabled={!dirty || save.isPending}
                  loading={save.isPending}
                >
                  Save
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---- Approval queue (human-in-the-loop) ----

function DraftRow({ draft }: { draft: AgentOutreach }) {
  const refresh = useSalesRefresh();
  const [body, setBody] = React.useState(draft.body);

  const approve = useMutation({
    mutationFn: () =>
      approveOutreach(draft.id, body.trim() !== draft.body ? { body: body.trim() } : undefined),
    onSuccess: (r) => {
      toast.success(`Sent via ${r.channel === "EMAIL" ? "email" : "WhatsApp"}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reject = useMutation({
    mutationFn: () => rejectOutreach(draft.id),
    onSuccess: () => {
      toast.success("Draft rejected");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <div className="border-t pt-3">
      {/* Who this is going to, and exactly where it will land. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold uppercase text-brand">
            {(draft.recipientName ?? "?").charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {draft.recipientName ?? "Unknown recipient"}
              {draft.recipientCompany ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  &middot; {draft.recipientCompany}
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {draft.recipientAddress ?? "No address on file"}
              {draft.recipientCity ? ` · ${draft.recipientCity}` : ""}
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {draft.channel === "EMAIL" ? "Email" : "WhatsApp"}
        </Badge>
      </div>

      {draft.reason ? (
        <p className="mt-2 text-xs text-muted-foreground">{draft.reason}</p>
      ) : null}
      {draft.channel === "EMAIL" && draft.subject ? (
        <p className="mt-2 text-sm font-medium">{draft.subject}</p>
      ) : null}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={busy}
        className="mt-2 min-h-[84px] text-sm"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => reject.mutate()}
          disabled={busy}
          loading={reject.isPending}
        >
          Reject
        </Button>
        <Button
          size="sm"
          className="h-8"
          onClick={() => approve.mutate()}
          disabled={busy || !body.trim()}
          loading={approve.isPending}
        >
          <Check className="size-3.5" />
          Approve &amp; send
        </Button>
      </div>
    </div>
  );
}

function SalesApprovalQueue() {
  const refresh = useSalesRefresh();
  const { data, isLoading } = useQuery({
    queryKey: ["sales-outreach"],
    queryFn: () => listOutreach("DRAFT"),
  });
  const drafts = data ?? [];
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const approveAll = useMutation({
    mutationFn: approveAllOutreach,
    onSuccess: (r) => {
      if (r.failed > 0) {
        toast.warning(`Sent ${r.sent} of ${r.total}, ${r.failed} could not be sent`);
      } else {
        toast.success(`Sent all ${r.sent} draft${r.sent === 1 ? "" : "s"}`);
      }
      setConfirmOpen(false);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="reveal" style={{ animationDelay: "180ms" }}>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2">
            Drafts to review
            {drafts.length > 0 ? (
              <Badge variant="brand" className="tabular-nums">
                {drafts.length}
              </Badge>
            ) : null}
          </CardTitle>
          {drafts.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setConfirmOpen(true)}
              disabled={approveAll.isPending}
              loading={approveAll.isPending}
            >
              <CheckCheck className="size-3.5" />
              Approve all
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32" />)
          ) : drafts.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nothing to review"
              description="Generate drafts above, or turn on automation to have them created for you."
            />
          ) : (
            // Cap the queue height so a long backlog scrolls inside the card
            // instead of stretching the page.
            <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
              {drafts.map((draft) => (
                <DraftRow key={draft.id} draft={draft} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Approve all drafts?</DialogTitle>
            <DialogDescription>
              This sends all {drafts.length} draft{drafts.length === 1 ? "" : "s"} as-is over
              their channels. Drafts you edited but didn't save here are sent as originally
              written. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={approveAll.isPending}
            >
              Cancel
            </Button>
            <Button onClick={() => approveAll.mutate()} loading={approveAll.isPending}>
              <CheckCheck className="size-3.5" />
              Send all {drafts.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---- Sales-only run history ----

function SalesRunHistory() {
  const { data, isLoading } = useQuery({ queryKey: ["agent-runs"], queryFn: listAgentRuns });
  const runs = (data ?? []).filter((run) => run.agent === "sales");

  return (
    <section className="reveal" style={{ animationDelay: "240ms" }}>
      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No runs yet. Hit "Generate drafts" above.
            </p>
          ) : (
            // Cap the history height so it scrolls in place; the header stays
            // pinned while the rows move.
            <div className="max-h-[22rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Summary</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="max-w-md">
                        <span className="line-clamp-1 text-sm text-muted-foreground">
                          {run.summary ?? ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="brand" className="tabular-nums">
                          {formatNumber(run.actions.length)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                        {timeAgo(run.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---- Page ----

export default function SalesAgentPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Agent"
        description="Draft, review and automate outreach to your hottest leads."
      />
      <SalesRunCard />
      <SalesEffectivenessPanel />
      <SalesAutomationCard />
      <SalesApprovalQueue />
      <SalesRunHistory />
    </div>
  );
}
