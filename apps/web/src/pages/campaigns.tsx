import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  IndianRupee,
  Megaphone,
  Plus,
  Send,
  TrendingUp,
  UserPlus,
  Wallet,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
  createCampaign,
  listCampaigns,
  sendCampaign,
  type CampaignStatus,
} from "@/lib/api/campaigns";
import { listWaTemplates } from "@/lib/api/whatsapp";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<CampaignStatus, string> = {
  ACTIVE: "text-success",
  PAUSED: "text-warning",
  COMPLETED: "border-transparent bg-muted text-muted-foreground",
};

interface CampaignFormState {
  name: string;
  channel: string;
  cost: string;
  revenue: string;
  status: CampaignStatus;
  audienceTag: string;
  subject: string;
  body: string;
  // WhatsApp campaigns must use a pre-approved template (Meta rule); this holds
  // the chosen template key.
  templateKey: string;
  // One value per template {{1}}..{{n}} variable; each may contain the {name}
  // token, replaced with the recipient's first name at send.
  templateParams: string[];
}

const EMPTY_FORM: CampaignFormState = {
  name: "",
  channel: "Email",
  cost: "",
  revenue: "",
  status: "ACTIVE",
  audienceTag: "",
  subject: "",
  body: "",
  templateKey: "",
  templateParams: [],
};

// Channels the CRM can actually bulk-send (the others are ad/record channels).
const isSendableChannel = (channel: string): boolean =>
  ["email", "whatsapp"].includes(channel.trim().toLowerCase());

const isWhatsAppChannel = (channel: string): boolean =>
  channel.trim().toLowerCase() === "whatsapp";

// Distinct {{1}}, {{2}}, … variable indices present in a template body, sorted.
const templateVarIndices = (body: string | undefined | null): number[] => {
  const nums = new Set<number>();
  for (const m of (body ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    nums.add(Number(m[1]));
  }
  return [...nums].sort((a, b) => a - b);
};

export default function CampaignsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState<CampaignFormState>(EMPTY_FORM);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: listCampaigns,
  });

  // Approved WhatsApp templates for the template picker (loaded lazily once a
  // WhatsApp campaign is being composed).
  const waTemplatesQuery = useQuery({
    queryKey: ["wa-templates"],
    queryFn: listWaTemplates,
    enabled: dialogOpen && isWhatsAppChannel(form.channel),
  });
  // Only genuinely Meta-approved templates (have a meta_id) can be sent as a
  // WhatsApp campaign, local drafts would be rejected by Meta.
  const approvedTemplates = (waTemplatesQuery.data ?? []).filter(
    (t) => t.status === "APPROVED" && !!t.meta_id,
  );

  const selectedTemplate = approvedTemplates.find(
    (t) => t.key === form.templateKey,
  );
  const templateVarInputs = templateVarIndices(selectedTemplate?.body);
  // Live preview: substitute each {{n}} with its value ({name} → a sample name).
  let templatePreview = "";
  if (selectedTemplate?.body) {
    templatePreview = selectedTemplate.body;
    templateVarInputs.forEach((varNum, i) => {
      const val =
        (form.templateParams[i] ?? "").replace(/\{name\}/g, "Riya") ||
        `{{${varNum}}}`;
      templatePreview = templatePreview.replace(
        new RegExp(`\\{\\{\\s*${varNum}\\s*\\}\\}`, "g"),
        val,
      );
    });
  }

  const createMutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: (campaign) => {
      toast.success(`Campaign "${campaign.name}" created`);
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not create campaign"),
  });

  const sendMutation = useMutation({
    mutationFn: sendCampaign,
    onSuccess: (result) => {
      const whatsApp = isWhatsAppChannel(result.channel);
      const notes: string[] = [];
      if (whatsApp)
        notes.push(
          "Accepted ≠ delivered, final delivery is confirmed by Meta and shown per campaign once it arrives.",
        );
      if (result.simulated > 0)
        notes.push(
          `${result.simulated} not sent (no marketing sender / WhatsApp not connected).`,
        );
      if (result.skipped > 0)
        notes.push(`${result.skipped} skipped (no email/phone).`);
      if (result.recipients === 0) notes.push("No leads matched the audience.");
      toast.success(
        whatsApp
          ? `Campaign: ${result.sent} of ${result.recipients} accepted by Meta.`
          : `Campaign: ${result.sent} sent of ${result.recipients} recipient(s).`,
        {
          description: notes.join(" ") || undefined,
        },
      );
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not send campaign"),
  });

  const handleSend = (id: string, name: string) => {
    if (
      window.confirm(
        `Send "${name}" to its audience now? This can't be undone.`,
      )
    ) {
      sendMutation.mutate(id);
    }
  };

  const campaigns = campaignsQuery.data?.campaigns ?? [];
  const totals = campaignsQuery.data?.totals;
  const loading = campaignsQuery.isLoading;

  const stats = [
    { label: "Total spend", value: formatINR(totals?.cost), icon: Wallet },
    { label: "Revenue", value: formatINR(totals?.revenue), icon: IndianRupee },
    {
      label: "ROI",
      value: (
        <span
          className={(totals?.roi ?? 0) < 0 ? "text-danger" : "text-success"}
        >
          {formatNumber(totals?.roi)}%
        </span>
      ),
      icon: TrendingUp,
    },
    {
      label: "Leads generated",
      value: formatNumber(totals?.leadsGenerated),
      icon: UserPlus,
    },
  ];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Give the campaign a name.");
      return;
    }
    const whatsApp = isWhatsAppChannel(form.channel);
    if (whatsApp && !form.templateKey) {
      toast.error("Pick an approved WhatsApp template.");
      return;
    }
    // Every template variable must have a value, Meta rejects blanks and a
    // missing value would otherwise be silently filled with the recipient name.
    if (whatsApp && templateVarInputs.length > 0) {
      const values = templateVarInputs.map((_, i) =>
        (form.templateParams[i] ?? "").trim(),
      );
      if (values.some((v) => !v)) {
        toast.error(
          "Fill every template variable before creating the campaign.",
        );
        return;
      }
    }
    createMutation.mutate({
      name: form.name.trim(),
      channel: form.channel,
      cost: Number(form.cost) || 0,
      revenue: Number(form.revenue) || 0,
      status: form.status,
      audienceTag: form.audienceTag.trim() || undefined,
      // WhatsApp carries the template key in `subject`; `body` holds the
      // template copy (for the record + preview).
      subject: whatsApp ? form.templateKey : form.subject.trim() || undefined,
      body: form.body.trim() || undefined,
      templateParams:
        whatsApp && templateVarInputs.length > 0
          ? templateVarInputs.map((_, i) => form.templateParams[i] ?? "")
          : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Multichannel campaigns with performance tracking."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            New Campaign
          </Button>
        }
      />

      {/* Totals strip */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map((stat, index) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            loading={loading}
            className="reveal"
            style={{ animationDelay: `${60 + index * 45}ms` }}
          />
        ))}
      </section>

      {/* Campaign table */}
      <section className="reveal" style={{ animationDelay: "240ms" }}>
        {loading ? (
          <div className="space-y-2 rounded-lg border bg-card p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="Launch your first campaign to start tracking spend, revenue and leads in one place."
            action={
              <Button onClick={() => setDialogOpen(true)}>
                <Plus />
                Create your first campaign
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Campaign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead
                    className="text-right"
                    title="For WhatsApp: how many messages Meta accepted, and how many it later confirmed delivered/failed via webhook. Accepted is not the same as delivered."
                  >
                    Accepted
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">
                      {campaign.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="brand">{campaign.channel}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINR(campaign.cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINR(campaign.revenue)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        campaign.roi < 0 ? "text-danger" : "text-success",
                      )}
                    >
                      {formatNumber(campaign.roi)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign.roas.toFixed(2)}x
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(campaign.leads_generated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {campaign.sent_at ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span title="Accepted by the provider at send time">
                            {campaign.sent}/{campaign.recipients}
                          </span>
                          {campaign.delivery ? (
                            <span className="text-[11px] leading-tight">
                              {campaign.delivery.delivered > 0 ? (
                                <span className="text-success">
                                  {campaign.delivery.delivered} delivered
                                </span>
                              ) : null}
                              {campaign.delivery.failed > 0 ? (
                                <span className="text-danger">
                                  {campaign.delivery.delivered > 0 ? " · " : ""}
                                  {campaign.delivery.failed} failed
                                </span>
                              ) : null}
                              {campaign.delivery.delivered === 0 &&
                              campaign.delivery.failed === 0 ? (
                                <span title="Meta accepted these but hasn't reported delivery yet. If this never updates, wire the WhatsApp status webhook.">
                                  awaiting delivery
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_BADGE[campaign.status]}
                      >
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(campaign.start_at) || "Not started"}
                    </TableCell>
                    <TableCell className="text-right">
                      {campaign.sent_at ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <CheckCircle2 className="size-3.5" /> Sent
                        </span>
                      ) : isSendableChannel(campaign.channel) &&
                        campaign.body ? (
                        <Button
                          size="sm"
                          loading={
                            sendMutation.isPending &&
                            sendMutation.variables === campaign.id
                          }
                          onClick={() => handleSend(campaign.id, campaign.name)}
                        >
                          {sendMutation.isPending &&
                          sendMutation.variables === campaign.id ? null : (
                            <Send className="size-3.5" />
                          )}
                          Send
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* New campaign dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>
              Track spend, revenue and lead generation for a new campaign.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Name</Label>
              <Input
                id="campaign-name"
                placeholder="Spring product launch"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="campaigns-channel">Channel</Label>
                <Select
                  value={form.channel}
                  onValueChange={(channel) =>
                    setForm((f) => ({ ...f, channel }))
                  }
                >
                  <SelectTrigger id="campaigns-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_CHANNELS.map((channel) => (
                      <SelectItem key={channel} value={channel}>
                        {channel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaigns-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(status) =>
                    setForm((f) => ({ ...f, status: status as CampaignStatus }))
                  }
                >
                  <SelectTrigger id="campaigns-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-cost">Cost (INR)</Label>
                <Input
                  id="campaign-cost"
                  type="number"
                  min="0"
                  placeholder="50000"
                  value={form.cost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cost: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-revenue">Revenue (INR)</Label>
                <Input
                  id="campaign-revenue"
                  type="number"
                  min="0"
                  placeholder="120000"
                  value={form.revenue}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, revenue: e.target.value }))
                  }
                />
              </div>
            </div>

            {isSendableChannel(form.channel) ? (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Audience &amp; message, this campaign can be sent to leads.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-audience">
                    Audience tag (optional)
                  </Label>
                  <Input
                    id="campaign-audience"
                    placeholder="e.g. webinar-june, blank = all leads"
                    value={form.audienceTag}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, audienceTag: e.target.value }))
                    }
                  />
                </div>
                {isWhatsAppChannel(form.channel) ? (
                  <div className="space-y-2.5">
                    <div className="space-y-1.5">
                      <Label>Approved template</Label>
                      <Select
                        value={form.templateKey || undefined}
                        onValueChange={(key) => {
                          const tpl = approvedTemplates.find(
                            (t) => t.key === key,
                          );
                          const vars = templateVarIndices(tpl?.body);
                          setForm((f) => ({
                            ...f,
                            templateKey: key,
                            body: tpl?.body ?? f.body,
                            // First variable defaults to the recipient's name;
                            // the rest start blank for the sender to fill.
                            templateParams: vars.map((_, i) =>
                              i === 0 ? "{name}" : "",
                            ),
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              waTemplatesQuery.isLoading
                                ? "Loading templates…"
                                : approvedTemplates.length
                                  ? "Select a template"
                                  : "No approved templates"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {approvedTemplates.map((t) => (
                            <SelectItem key={t.id} value={t.key}>
                              {t.key}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {approvedTemplates.length === 0 &&
                    !waTemplatesQuery.isLoading ? (
                      <p className="text-xs text-warning">
                        No approved WhatsApp templates yet. Create and sync one
                        in WhatsApp settings, Meta requires a pre-approved
                        template for campaigns.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        WhatsApp requires a pre-approved template. Use{" "}
                        <code className="rounded bg-muted px-1">
                          {"{name}"}
                        </code>{" "}
                        in any variable to insert each lead&apos;s first name.
                      </p>
                    )}

                    {/* Raw template body (with {{n}} placeholders) for reference */}
                    {form.body ? (
                      <div className="border-t pt-2.5 text-xs text-muted-foreground">
                        {form.body}
                      </div>
                    ) : null}

                    {/* One input per {{n}} variable the template declares */}
                    {templateVarInputs.length > 0 ? (
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium">
                          Template variables, fill each placeholder
                        </p>
                        {templateVarInputs.map((varNum, i) => (
                          <div key={varNum} className="space-y-1">
                            <Label
                              htmlFor={`tpl-var-${varNum}`}
                              className="text-xs text-muted-foreground"
                            >
                              {`{{${varNum}}}`}
                            </Label>
                            <Input
                              id={`tpl-var-${varNum}`}
                              value={form.templateParams[i] ?? ""}
                              placeholder={
                                i === 0
                                  ? "{name}"
                                  : "e.g. Pro plan"
                              }
                              onChange={(e) =>
                                setForm((f) => {
                                  const next = [...f.templateParams];
                                  next[i] = e.target.value;
                                  return { ...f, templateParams: next };
                                })
                              }
                            />
                          </div>
                        ))}
                        {templatePreview ? (
                          <div className="border-t pt-2.5 text-sm">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Preview
                            </span>
                            <p className="mt-1 whitespace-pre-wrap">
                              {templatePreview}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="campaign-subject">Subject</Label>
                      <Input
                        id="campaign-subject"
                        placeholder="Hi {name}, a special offer for you"
                        value={form.subject}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, subject: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="campaign-body">Message</Label>
                      <Textarea
                        id="campaign-body"
                        rows={4}
                        placeholder="Hi {name}, … ({name} is replaced with each lead's first name)"
                        value={form.body}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, body: e.target.value }))
                        }
                      />
                    </div>
                  </>
                )}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createMutation.isPending}>
                Create campaign
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
