import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  FileText,
  Loader2,
  Mail,
  MailOpen,
  Maximize2,
  Minimize2,
  Minus,
  MousePointerClick,
  Pencil,
  PenLine,
  Plus,
  Reply,
  RotateCcw,
  Send,
  Settings2,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { LeadCombobox } from "@/components/leads/LeadCombobox";
import type { LeadOption } from "@/lib/api/lead-options";
import {
  addDraftType,
  createEmailTemplate,
  deleteDraftType,
  deleteEmailTemplate,
  getEmailMetrics,
  listDraftTypes,
  listEmailTemplates,
  restoreDraftType,
  sendEmail,
  updateEmailTemplate,
  writeEmail,
  type EmailDraft,
  type EmailDraftType,
  type EmailTemplate,
} from "@/lib/api/email";
import { formatNumber } from "@/lib/format";

// The AI Email Writer's type dropdown. Add a row here (with a matching key in
// EmailDraftType) and wire the same key into the backend's EMAIL_INTENT
// (provider.ts) + EMAIL_BLUEPRINTS (heuristics.ts) to make it generate properly.
const DRAFT_TYPES: Array<{ value: EmailDraftType; label: string }> = [
  { value: "sales", label: "Sales outreach" },
  { value: "followup", label: "Follow-up" },
  { value: "response", label: "Response" },
  { value: "referral", label: "Referral intro" },
  { value: "meeting", label: "Meeting request" },
  { value: "proposal", label: "Proposal & pricing" },
  { value: "reengage", label: "Re-engagement" },
  { value: "thankyou", label: "Thank you" },
  { value: "renewal", label: "Renewal & upsell" },
];

/**
 * Personalise a template by substituting merge tokens with the chosen lead's
 * details. Templates are authored inconsistently, some use `{name}`, some
 * `{{name}}`, `{{ first_name }}`, `{lead_name}`, etc., so we match all of those
 * shapes case-insensitively. Called when a recipient is picked, which is why a
 * template that just says "{name}" turns into the real name on selection.
 */
function fillPlaceholders(text: string, lead: LeadOption | null): string {
  if (!lead) return text;
  const name = (lead.name ?? "").trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  const token = (key: string) =>
    new RegExp(`\\{\\{?\\s*${key}\\s*\\}?\\}`, "gi");
  return text
    .replace(token("first[_ ]?name"), firstName)
    .replace(token("(?:full[_ ]?name|lead[_ ]?name|contact[_ ]?name|name)"), name)
    .replace(token("email"), lead.email ?? "")
    .replace(token("phone"), lead.phone ?? "");
}

export default function EmailPage() {
  const queryClient = useQueryClient();

  const metricsQuery = useQuery({ queryKey: ["email-metrics"], queryFn: getEmailMetrics });
  const templatesQuery = useQuery({
    queryKey: ["email-templates"],
    queryFn: listEmailTemplates,
  });
  const draftTypesQuery = useQuery({
    queryKey: ["email-draft-types"],
    queryFn: listDraftTypes,
  });

  const metrics = metricsQuery.data;
  const templates = templatesQuery.data ?? [];
  const customTypes = draftTypesQuery.data?.custom ?? [];
  const hiddenBuiltins = draftTypesQuery.data?.hidden ?? [];

  // Built-in types the workspace hasn't hidden, plus its custom ones, this is
  // the effective type list everywhere (dropdown + manager).
  const visibleBuiltins = DRAFT_TYPES.filter((t) => !hiddenBuiltins.includes(t.value));
  const typeOptions: Array<{ value: string; label: string }> = [
    ...visibleBuiltins,
    ...customTypes.map((t) => ({ value: t.key, label: t.label })),
  ];
  const hiddenBuiltinTypes = DRAFT_TYPES.filter((t) => hiddenBuiltins.includes(t.value));

  const invalidateTemplates = () =>
    queryClient.invalidateQueries({ queryKey: ["email-templates"] });

  // ---- AI writer ----
  const [draftType, setDraftType] = React.useState<string>("sales");
  const [recipientName, setRecipientName] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [draft, setDraft] = React.useState<EmailDraft | null>(null);
  // The generated subject/body are editable in place, so keep them in their own
  // state (seeded from the draft) rather than reading straight off `draft`.
  const [draftSubject, setDraftSubject] = React.useState("");
  const [draftBody, setDraftBody] = React.useState("");
  const [sendLead, setSendLead] = React.useState<LeadOption | null>(null);

  const writeMutation = useMutation({
    mutationFn: writeEmail,
    onSuccess: (result) => {
      setDraft(result);
      setDraftSubject(result.subject);
      setDraftBody(result.body);
      toast.success("Draft ready. Edit it, then save or send.");
    },
    onError: (error: Error) => toast.error(error.message || "Could not generate the email."),
  });

  const sendMutation = useMutation({
    mutationFn: sendEmail,
    onSuccess: (result) => {
      if (result.provider === "SES") {
        toast.success("Email sent.", {
          description: "Opens and clicks will appear in your metrics as they happen.",
        });
      } else {
        toast.success("Email sent (simulated).", {
          description: "No email provider is configured, so nothing left the server.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["email-metrics"] });
    },
    onError: (error: Error) => toast.error(error.message || "Could not send the email."),
  });

  const handleGenerate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!recipientName.trim()) {
      toast.error("Who is this email for? Add a name.");
      return;
    }
    writeMutation.mutate({
      type: draftType,
      name: recipientName.trim(),
      company: company.trim() || undefined,
    });
  };

  const handleSendDraft = () => {
    if (!draft || sendMutation.isPending) return;
    if (!sendLead) {
      toast.error("Pick a lead to send this draft to.");
      return;
    }
    if (!draftBody.trim()) {
      toast.error("The email body is empty.");
      return;
    }
    sendMutation.mutate({
      leadId: sendLead.id,
      subject: draftSubject.trim() || undefined,
      body: draftBody,
    });
  };

  // ---- Custom draft types manager ----
  const [typesOpen, setTypesOpen] = React.useState(false);
  const [newTypeLabel, setNewTypeLabel] = React.useState("");
  const [newTypeIntent, setNewTypeIntent] = React.useState("");
  const [newTypeSubject, setNewTypeSubject] = React.useState("");
  const [newTypeBody, setNewTypeBody] = React.useState("");

  const invalidateDraftTypes = () =>
    queryClient.invalidateQueries({ queryKey: ["email-draft-types"] });

  const addTypeMutation = useMutation({
    mutationFn: addDraftType,
    onSuccess: (created) => {
      toast.success(`Type "${created.label}" added.`);
      setNewTypeLabel("");
      setNewTypeIntent("");
      setNewTypeSubject("");
      setNewTypeBody("");
      invalidateDraftTypes();
    },
    onError: (error: Error) => toast.error(error.message || "Could not add the type."),
  });

  const deleteTypeMutation = useMutation({
    mutationFn: deleteDraftType,
    onSuccess: (_result, key) => {
      toast.success("Type removed.");
      // If the removed/hidden type was selected, fall back to another visible one.
      const fallback = typeOptions.find((o) => o.value !== key)?.value ?? "sales";
      setDraftType((current) => (current === key ? fallback : current));
      invalidateDraftTypes();
    },
    onError: (error: Error) => toast.error(error.message || "Could not remove the type."),
  });

  const restoreTypeMutation = useMutation({
    mutationFn: restoreDraftType,
    onSuccess: () => {
      toast.success("Type restored.");
      invalidateDraftTypes();
    },
    onError: (error: Error) => toast.error(error.message || "Could not restore the type."),
  });

  const handleAddType = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTypeLabel.trim() || !newTypeIntent.trim()) {
      toast.error("Add a name and a short description of the email's goal.");
      return;
    }
    addTypeMutation.mutate({
      label: newTypeLabel.trim(),
      intent: newTypeIntent.trim(),
      subject: newTypeSubject.trim() || undefined,
      body: newTypeBody.trim() || undefined,
    });
  };

  // ---- Composer (used by "Use template" and "Compose") ----
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeContext, setComposeContext] = React.useState<string | null>(null);
  const [composeLead, setComposeLead] = React.useState<LeadOption | null>(null);
  const [composeSubject, setComposeSubject] = React.useState("");
  const [composeBody, setComposeBody] = React.useState("");
  // The template as authored (merge tokens intact). Picking a recipient
  // re-derives the visible subject/body from these, so switching leads always
  // re-personalises from the original rather than from an already-filled copy.
  const [composeRawSubject, setComposeRawSubject] = React.useState("");
  const [composeRawBody, setComposeRawBody] = React.useState("");
  // Gmail compose-window chrome state: collapsed to just the title bar, or
  // popped out to a centred full-size window.
  const [composeMin, setComposeMin] = React.useState(false);
  const [composeExpanded, setComposeExpanded] = React.useState(false);

  const openComposer = (opts?: { subject?: string; body?: string; context?: string }) => {
    const subject = opts?.subject ?? "";
    const body = opts?.body ?? "";
    setComposeContext(opts?.context ?? null);
    setComposeLead(null);
    setComposeRawSubject(subject);
    setComposeRawBody(body);
    setComposeSubject(subject);
    setComposeBody(body);
    setComposeMin(false);
    setComposeExpanded(false);
    setComposeOpen(true);
  };

  const applyTemplate = (template: EmailTemplate) =>
    openComposer({ subject: template.subject, body: template.body, context: template.name });

  // Picking (or switching) the recipient personalises the template: fill merge
  // tokens from the raw template so the name/email land accurately every time.
  const handleComposeRecipient = (lead: LeadOption) => {
    setComposeLead(lead);
    setComposeSubject(fillPlaceholders(composeRawSubject, lead));
    setComposeBody(fillPlaceholders(composeRawBody, lead));
  };

  const handleComposeSend = () => {
    if (sendMutation.isPending) return;
    if (!composeLead) {
      toast.error("Pick a lead to send this to.");
      return;
    }
    if (!composeBody.trim()) {
      toast.error("Write a message before sending.");
      return;
    }
    sendMutation.mutate(
      {
        leadId: composeLead.id,
        subject: composeSubject.trim() || undefined,
        body: composeBody,
      },
      { onSuccess: () => setComposeOpen(false) }
    );
  };

  // ---- Template editor (create + edit) ----
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [tplName, setTplName] = React.useState("");
  const [tplSubject, setTplSubject] = React.useState("");
  const [tplCategory, setTplCategory] = React.useState("");
  const [tplBody, setTplBody] = React.useState("");

  const openCreateTemplate = (preset?: { subject?: string; body?: string; category?: string }) => {
    setEditingId(null);
    setTplName("");
    setTplSubject(preset?.subject ?? "");
    setTplCategory(preset?.category ?? "");
    setTplBody(preset?.body ?? "");
    setEditorOpen(true);
  };

  const openEditTemplate = (template: EmailTemplate) => {
    setEditingId(template.id);
    setTplName(template.name);
    setTplSubject(template.subject);
    setTplCategory(template.category ?? "");
    setTplBody(template.body);
    setEditorOpen(true);
  };

  const onTemplateSaved = (verb: "created" | "updated", name: string) => {
    toast.success(`Template "${name}" ${verb}.`);
    setEditorOpen(false);
    invalidateTemplates();
  };

  const createMutation = useMutation({
    mutationFn: createEmailTemplate,
    onSuccess: (template) => onTemplateSaved("created", template.name),
    onError: (error: Error) => toast.error(error.message || "Could not create template."),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; input: Parameters<typeof createEmailTemplate>[0] }) =>
      updateEmailTemplate(vars.id, vars.input),
    onSuccess: (template) => onTemplateSaved("updated", template.name),
    onError: (error: Error) => toast.error(error.message || "Could not update template."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteEmailTemplate,
    onSuccess: () => {
      toast.success("Template deleted.");
      invalidateTemplates();
    },
    onError: (error: Error) => toast.error(error.message || "Could not delete template."),
  });

  const savingTemplate = createMutation.isPending || updateMutation.isPending;

  const handleSaveTemplate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tplName.trim() || !tplSubject.trim()) {
      toast.error("Template name and subject are required.");
      return;
    }
    const input = {
      name: tplName.trim(),
      subject: tplSubject.trim(),
      body: tplBody.trim(),
      category: tplCategory.trim() || undefined,
    };
    if (editingId) updateMutation.mutate({ id: editingId, input });
    else createMutation.mutate(input);
  };

  const handleDeleteTemplate = (template: EmailTemplate) => {
    if (window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(template.id);
    }
  };

  const statCards = [
    { label: "Emails sent", value: formatNumber(metrics?.sent), icon: Send },
    { label: "Open rate", value: `${metrics?.openRate ?? 0}%`, icon: MailOpen },
    { label: "Click rate", value: `${metrics?.clickRate ?? 0}%`, icon: MousePointerClick },
    { label: "Replies", value: formatNumber(metrics?.replies), icon: Reply },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email"
        description="Write with AI, send tracked emails and reuse your best templates."
      />

      {/* Metrics */}
      <section className="space-y-2">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((card, index) => (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={card.icon}
              loading={metricsQuery.isLoading}
              className="reveal"
              style={{ animationDelay: `${60 + index * 45}ms` }}
            />
          ))}
        </div>
        {!metricsQuery.isLoading && metrics ? (
          metrics.tracked ? (
            <p className="text-xs text-muted-foreground">
              Live open &amp; click tracking from your verified domain
              {typeof metrics.delivered === "number" ? ` · ${metrics.delivered} delivered` : ""}
              {metrics.bounced ? ` · ${metrics.bounced} bounced` : ""}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Open &amp; click rates activate once you send from a verified domain, set one up in
              Email Sending.
            </p>
          )
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* AI Email Writer */}
        <section className="reveal lg:col-span-2" style={{ animationDelay: "240ms" }}>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center text-brand">
                    <WandSparkles className="size-4" />
                  </span>
                  AI Email Writer
                </CardTitle>
                <CardDescription>
                  Pick the email type, tell it who you are writing to, and send the
                  draft straight to a lead.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setTypesOpen(true)}
              >
                <Settings2 className="size-4" />
                Manage types
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <form
                className="grid gap-4 sm:grid-cols-[160px_1fr_1fr_auto]"
                onSubmit={handleGenerate}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="draft-type">Type</Label>
                  <Select
                    value={draftType}
                    onValueChange={(value) => setDraftType(value)}
                  >
                    <SelectTrigger id="draft-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="draft-name">Recipient name</Label>
                  <Input
                    id="draft-name"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="e.g. Priya"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="draft-company">Company (optional)</Label>
                  <Input
                    id="draft-company"
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    placeholder="e.g. Acme Corp"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" loading={writeMutation.isPending}>
                    {!writeMutation.isPending ? <WandSparkles className="size-4" /> : null}
                    Generate
                  </Button>
                </div>
              </form>

              {draft ? (
                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="brand" className="capitalize">
                      {draft.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {draft.generatedBy}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      Edit anything below before you save or send.
                    </span>
                  </div>

                  {/* Editable draft */}
                  <div className="space-y-1.5">
                    <Label htmlFor="draft-subject">Subject</Label>
                    <Input
                      id="draft-subject"
                      value={draftSubject}
                      onChange={(event) => setDraftSubject(event.target.value)}
                      placeholder="Email subject"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="draft-body">Message</Label>
                    <Textarea
                      id="draft-body"
                      rows={9}
                      value={draftBody}
                      onChange={(event) => setDraftBody(event.target.value)}
                      placeholder="Write your message..."
                    />
                  </div>

                  {/* Two actions: save as a reusable template, or send now to a
                      chosen lead. */}
                  <div className="flex flex-col gap-3 border-t pt-3.5 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="justify-center"
                      onClick={() =>
                        openCreateTemplate({
                          subject: draftSubject,
                          body: draftBody,
                          category: draft.type,
                        })
                      }
                    >
                      <Bookmark className="size-4" />
                      Save as template
                    </Button>
                    <div className="flex flex-1 items-center gap-2 sm:justify-end">
                      <LeadCombobox
                        value={sendLead}
                        onChange={setSendLead}
                        placeholder="Select a lead…"
                        triggerClassName="h-9 w-full sm:w-48"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleSendDraft}
                        loading={sendMutation.isPending}
                        disabled={!sendLead || !draftBody.trim()}
                      >
                        {!sendMutation.isPending ? <Send className="size-4" /> : null}
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
                  <Mail className="size-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Fill in the fields above and hit Generate, your editable draft
                    appears here, ready to save or send.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Templates */}
        <section className="reveal" style={{ animationDelay: "300ms" }}>
          <Card className="flex h-full flex-col">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle>Templates</CardTitle>
                <CardDescription>Click one to compose and send.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => openCreateTemplate()}>
                <Plus className="size-4" />
                New
              </Button>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
              <Button
                variant="secondary"
                className="w-full shrink-0 justify-center"
                onClick={() => openComposer()}
              >
                <PenLine className="size-4" />
                Compose email
              </Button>

              {templatesQuery.isLoading ? (
                <div className="space-y-2.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              ) : templates.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No templates yet"
                  description="Save the emails you send most often, then reuse them in one click."
                  className="py-8"
                  action={
                    <Button size="sm" onClick={() => openCreateTemplate()}>
                      <Plus className="size-4" />
                      New template
                    </Button>
                  }
                />
              ) : (
                <div className="-mr-1 max-h-[460px] min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="rounded-md border p-3 transition-colors duration-120 hover:border-brand/50 hover:bg-muted/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className="min-w-0 flex-1 text-left"
                          title="Use this template"
                        >
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{template.name}</p>
                            {template.category ? (
                              <Badge variant="secondary" className="shrink-0">
                                {template.category}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {template.subject}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Edit ${template.name}`}
                            onClick={() => openEditTemplate(template)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Delete ${template.name}`}
                            onClick={() => handleDeleteTemplate(template)}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {template.body ? (
                        <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {template.body}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => applyTemplate(template)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                      >
                        <Send className="size-3" />
                        Use template
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Gmail-style "New Message" compose window: docked bottom-right, dark
          title bar with minimise / full-screen / close, borderless To / Subject
          / body, and the blue rounded Send toolbar. */}
      {composeOpen ? (
        <>
          {composeExpanded ? (
            <div
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setComposeExpanded(false)}
            />
          ) : null}
          <div
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden bg-card ring-1 ring-border",
              composeExpanded
                ? "left-1/2 top-1/2 h-[86vh] w-[min(820px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg"
                : "inset-x-0 bottom-0 mx-auto w-full rounded-t-lg sm:inset-x-auto sm:right-6 sm:mx-0 sm:w-[512px]",
              !composeExpanded &&
                (composeMin ? "sm:h-auto" : "h-[72vh] sm:h-[560px]"),
            )}
          >
            {/* Title bar */}
            <div
              className="flex shrink-0 items-center justify-between bg-muted px-4 py-2.5 text-foreground"
              role={composeMin ? "button" : undefined}
              onClick={() => composeMin && setComposeMin(false)}
            >
              <span className="truncate text-sm font-medium">
                {composeSubject.trim() || "New Message"}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Minimise"
                  className="rounded p-1 hover:bg-background"
                  onClick={(event) => {
                    event.stopPropagation();
                    setComposeMin((value) => !value);
                  }}
                >
                  <Minus className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={composeExpanded ? "Exit full screen" : "Full screen"}
                  className="rounded p-1 hover:bg-background"
                  onClick={(event) => {
                    event.stopPropagation();
                    setComposeMin(false);
                    setComposeExpanded((value) => !value);
                  }}
                >
                  {composeExpanded ? (
                    <Minimize2 className="size-3.5" />
                  ) : (
                    <Maximize2 className="size-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Close"
                  className="rounded p-1 hover:bg-background"
                  onClick={(event) => {
                    event.stopPropagation();
                    setComposeOpen(false);
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {!composeMin ? (
              <>
                {/* Recipients + subject */}
                <div className="shrink-0 px-4">
                  <div className="flex items-center gap-2 border-b py-2 text-sm">
                    <span className="text-muted-foreground">To</span>
                    <div className="flex-1">
                      <LeadCombobox
                        value={composeLead}
                        onChange={handleComposeRecipient}
                        placeholder="Recipients"
                        triggerClassName="h-7 border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:ring-0"
                      />
                    </div>
                  </div>
                  <div className="border-b py-2">
                    <input
                      value={composeSubject}
                      onChange={(event) => setComposeSubject(event.target.value)}
                      placeholder="Subject"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                {/* Body */}
                <textarea
                  value={composeBody}
                  onChange={(event) => setComposeBody(event.target.value)}
                  placeholder="Compose email"
                  className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                />
                {composeContext ? (
                  <p className="shrink-0 px-4 pb-1 text-xs text-muted-foreground">
                    Using template “{composeContext}”. Delivered as a branded HTML
                    email with a plain-text fallback.
                  </p>
                ) : null}

                {/* Send toolbar */}
                <div className="flex shrink-0 items-center gap-1 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={handleComposeSend}
                    disabled={
                      !composeLead ||
                      !composeBody.trim() ||
                      sendMutation.isPending
                    }
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-6 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    Send
                  </button>
                  <button
                    type="button"
                    aria-label="Discard draft"
                    onClick={() => setComposeOpen(false)}
                    className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted"
                  >
                    <Trash2 className="size-[18px]" />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Template editor dialog (create + edit) */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit template" : "New email template"}</DialogTitle>
            <DialogDescription>
              Saved templates are reusable here and in campaigns and journeys.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveTemplate}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  value={tplName}
                  onChange={(event) => setTplName(event.target.value)}
                  placeholder="e.g. Demo follow-up"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-category">Category (optional)</Label>
                <Input
                  id="tpl-category"
                  value={tplCategory}
                  onChange={(event) => setTplCategory(event.target.value)}
                  placeholder="e.g. Sales"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-subject">Subject</Label>
              <Input
                id="tpl-subject"
                value={tplSubject}
                onChange={(event) => setTplSubject(event.target.value)}
                placeholder="e.g. Quick recap of today's demo"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">Body</Label>
              <Textarea
                id="tpl-body"
                rows={6}
                value={tplBody}
                onChange={(event) => setTplBody(event.target.value)}
                placeholder="Hi {name},..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={savingTemplate}>
                {!savingTemplate ? (
                  editingId ? (
                    <Pencil className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )
                ) : null}
                {editingId ? "Save changes" : "Create template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage custom AI Email Writer types */}
      <Dialog open={typesOpen} onOpenChange={setTypesOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email types</DialogTitle>
            <DialogDescription>
              Add, remove, or restore the types the AI Email Writer offers. Custom
              types are deleted; built-in ones are hidden and can be restored.
            </DialogDescription>
          </DialogHeader>

          {/* Active types, built-ins plus custom. Removing a custom type
              deletes it; removing a built-in hides it (restore below). */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active types
            </p>
            {draftTypesQuery.isLoading ? (
              <Skeleton className="h-10" />
            ) : (
              <div className="space-y-2">
                {[
                  ...visibleBuiltins.map((t) => ({
                    key: t.value,
                    label: t.label,
                    intent: undefined as string | undefined,
                    builtin: true,
                  })),
                  ...customTypes.map((t) => ({
                    key: t.key,
                    label: t.label,
                    intent: t.intent as string | undefined,
                    builtin: false,
                  })),
                ].map((type) => {
                  const pending =
                    deleteTypeMutation.isPending &&
                    deleteTypeMutation.variables === type.key;
                  return (
                    <div
                      key={type.key}
                      className="flex items-start justify-between gap-3 border-t pt-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {type.label}
                          </p>
                          <Badge
                            variant={type.builtin ? "secondary" : "brand"}
                            className="shrink-0"
                          >
                            {type.builtin ? "Built-in" : "Custom"}
                          </Badge>
                        </div>
                        {type.intent ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {type.intent}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={
                          type.builtin
                            ? `Hide ${type.label}`
                            : `Delete ${type.label}`
                        }
                        title={type.builtin ? "Hide from the list" : "Delete"}
                        onClick={() => deleteTypeMutation.mutate(type.key)}
                        disabled={pending}
                      >
                        {pending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hidden built-ins, restore any you removed. */}
          {hiddenBuiltinTypes.length > 0 ? (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Hidden built-in types
              </p>
              <div className="space-y-2">
                {hiddenBuiltinTypes.map((type) => {
                  const pending =
                    restoreTypeMutation.isPending &&
                    restoreTypeMutation.variables === type.value;
                  return (
                    <div
                      key={type.value}
                      className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2"
                    >
                      <p className="truncate text-sm text-muted-foreground">
                        {type.label}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => restoreTypeMutation.mutate(type.value)}
                        disabled={pending}
                      >
                        {pending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )}
                        Restore
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Add a new type */}
          <form className="space-y-4 border-t pt-4" onSubmit={handleAddType}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add a type
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="type-label">Name</Label>
              <Input
                id="type-label"
                value={newTypeLabel}
                onChange={(event) => setNewTypeLabel(event.target.value)}
                placeholder="e.g. Win-back offer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type-intent">What should this email do?</Label>
              <Textarea
                id="type-intent"
                rows={2}
                value={newTypeIntent}
                onChange={(event) => setNewTypeIntent(event.target.value)}
                placeholder="e.g. a win-back email offering a reason to return, ending with a clear next step"
              />
              <p className="text-xs text-muted-foreground">
                This instruction is what the AI follows when generating the draft.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="type-subject">Fallback subject (optional)</Label>
                <Input
                  id="type-subject"
                  value={newTypeSubject}
                  onChange={(event) => setNewTypeSubject(event.target.value)}
                  placeholder="Used when no AI is configured"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type-body">Fallback body (optional)</Label>
                <Input
                  id="type-body"
                  value={newTypeBody}
                  onChange={(event) => setNewTypeBody(event.target.value)}
                  placeholder="Supports {name} and {company}"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTypesOpen(false)}>
                Done
              </Button>
              <Button type="submit" loading={addTypeMutation.isPending}>
                {!addTypeMutation.isPending ? <Plus className="size-4" /> : null}
                Add type
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
