import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCheck,
  FileText,
  Loader2,
  Megaphone,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Zap,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { WhatsAppConnectionCard } from "@/components/whatsapp/WhatsAppConnectionCard";
import { WhatsAppSendCard } from "@/components/whatsapp/WhatsAppSendCard";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  askWhatsAppAgent,
  broadcastWhatsApp,
  createWaTemplate,
  deleteWaTemplate,
  listWaTemplates,
  syncWaTemplates,
  WA_TEMPLATE_CATEGORIES,
  type AgentReplyResult,
  type AgentSource,
  type BroadcastResult,
  type WaTemplateCategory,
  type WaTemplateStatus,
} from "@/lib/api/whatsapp";
import { BRAND } from "@/lib/brand";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<WaTemplateStatus, string> = {
  APPROVED: "bg-success",
  PENDING: "bg-warning",
  REJECTED: "bg-danger",
};

const CATEGORY_VARIANT: Record<
  WaTemplateCategory,
  "brand" | "secondary" | "outline"
> = {
  MARKETING: "brand",
  ONBOARDING: "secondary",
  TRANSACTIONAL: "outline",
};

const AGENT_SUGGESTIONS = [
  "What plans do you offer?",
  "How does pricing work?",
  "Can I book a demo?",
];

// The WhatsApp glyph (phone-in-speech-bubble), single-colour so it inherits
// currentColor, used in the branded page banner.
// Faint WhatsApp-style doodle tile for the banner + chat wallpaper.
const doodleBg = (hex: string, opacity: number): string =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='104' height='104' viewBox='0 0 104 104'%3E%3Cg fill='none' stroke='${encodeURIComponent(
    hex,
  )}' stroke-opacity='${opacity}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 22h22a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5H24l-6 5v-5a5 5 0 0 1-2-19z'/%3E%3Ccircle cx='78' cy='30' r='10'/%3E%3Cpath d='M66 74c3 5 9 7 13 3'/%3E%3Cpath d='M30 70l6-6 6 6-6 6z'/%3E%3C/g%3E%3C/svg%3E")`;

const clockTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const sourceTitle = (source: AgentSource): string =>
  source.article?.title || source.title || "Knowledge base article";

const sourceKey = (source: AgentSource, index: number): string =>
  source.article?.id || source.id || `source-${index}`;

interface AgentExchange {
  question: string;
  reply?: AgentReplyResult;
  at: string;
}

export default function WhatsAppPage() {
  const queryClient = useQueryClient();

  const templatesQuery = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: listWaTemplates,
  });
  const templates = templatesQuery.data ?? [];

  // ---- Create-template dialog ----
  const [createOpen, setCreateOpen] = React.useState(false);
  const [tplKey, setTplKey] = React.useState("");
  const [tplBody, setTplBody] = React.useState("");
  const [tplCategory, setTplCategory] =
    React.useState<WaTemplateCategory>("MARKETING");

  const createMutation = useMutation({
    mutationFn: createWaTemplate,
    onSuccess: (template) => {
      toast.success(`Draft template "${template.key}" saved.`, {
        description:
          "Submit it in Meta to get it approved, then Sync from Meta.",
      });
      setCreateOpen(false);
      setTplKey("");
      setTplBody("");
      setTplCategory("MARKETING");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not create template."),
  });

  const syncMutation = useMutation({
    mutationFn: syncWaTemplates,
    onSuccess: (result) => {
      toast.success(`Synced ${result.synced} template(s) from Meta.`, {
        description:
          result.synced === 0
            ? "None found, create/approve templates in Meta and set your WABA ID in settings."
            : result.pruned
              ? `Removed ${result.pruned} stale template(s) no longer in Meta.`
              : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not sync templates."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWaTemplate,
    onSuccess: () => {
      toast.success("Template removed.");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not remove template."),
  });

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tplKey.trim() || !tplBody.trim()) {
      toast.error("Template key and body are required.");
      return;
    }
    createMutation.mutate({
      key: tplKey.trim(),
      body: tplBody.trim(),
      category: tplCategory,
    });
  };

  // ---- AI agent tester ----
  const [question, setQuestion] = React.useState("");
  const [exchanges, setExchanges] = React.useState<AgentExchange[]>([]);
  const chatScrollRef = React.useRef<HTMLDivElement>(null);

  const agentMutation = useMutation({
    mutationFn: (q: string) => askWhatsAppAgent(q),
    onSuccess: (reply, q) => {
      setExchanges((prev) => [
        ...prev,
        { question: q, reply, at: new Date().toISOString() },
      ]);
      setQuestion("");
    },
    onError: (error: Error) =>
      toast.error(error.message || "The agent could not answer."),
  });

  React.useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [exchanges, agentMutation.isPending]);

  const askAgent = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || agentMutation.isPending) return;
    setQuestion(trimmed);
    agentMutation.mutate(trimmed);
  };

  // ---- Broadcast ----
  const [broadcastTemplate, setBroadcastTemplate] = React.useState("");
  const [audienceTag, setAudienceTag] = React.useState("");
  const [lastBroadcast, setLastBroadcast] = React.useState<
    (BroadcastResult & { templateKey: string; at: string }) | null
  >(null);

  const broadcastMutation = useMutation({
    mutationFn: broadcastWhatsApp,
    onSuccess: (result, variables) => {
      toast.success(
        `Broadcast sent to ${formatNumber(result.sent)} lead${result.sent === 1 ? "" : "s"} tagged "${result.audienceTag}".`,
      );
      setLastBroadcast({
        ...result,
        templateKey: variables.templateKey,
        at: new Date().toISOString(),
      });
      setAudienceTag("");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Broadcast failed."),
  });

  const handleBroadcast = (event: React.FormEvent) => {
    event.preventDefault();
    if (!broadcastTemplate) {
      toast.error("Pick a template to broadcast.");
      return;
    }
    if (!audienceTag.trim()) {
      toast.error("Enter the audience tag to target.");
      return;
    }
    broadcastMutation.mutate({
      templateKey: broadcastTemplate,
      audienceTag: audienceTag.trim(),
    });
  };

  const chatEmpty = exchanges.length === 0 && !agentMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Connect your number, manage templates, test the AI agent and broadcast to tagged audiences."
      />

      <section className="reveal" style={{ animationDelay: "40ms" }}>
        <WhatsAppConnectionCard />
      </section>

      <section className="reveal" style={{ animationDelay: "80ms" }}>
        <Tabs defaultValue="send">
          <TabsList>
            <TabsTrigger value="send" className="gap-1.5">
              <Send className="size-3.5" />
              Send
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5">
              <FileText className="size-3.5" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-1.5">
              <Bot className="size-3.5" />
              AI Agent
            </TabsTrigger>
            <TabsTrigger value="broadcast" className="gap-1.5">
              <Megaphone className="size-3.5" />
              Broadcast
            </TabsTrigger>
          </TabsList>

          {/* ---- Send (one-off) ---- */}
          <TabsContent value="send" className="mt-4">
            <WhatsAppSendCard />
          </TabsContent>

          {/* ---- Templates ---- */}
          <TabsContent value="templates" className="mt-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle>Message templates</CardTitle>
                  <CardDescription>
                    Approved templates come from your Meta WhatsApp account,
                    click Sync from Meta to pull them. {"{name}"} is replaced
                    with the recipient's first name on send.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={syncMutation.isPending}
                    onClick={() => syncMutation.mutate()}
                  >
                    {syncMutation.isPending ? null : (
                      <RefreshCw className="size-4" />
                    )}
                    Sync from Meta
                  </Button>
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" />
                    New template
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {templatesQuery.isLoading ? (
                  <div className="space-y-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                ) : templates.length === 0 ? (
                  <EmptyState
                    icon={MessageCircle}
                    title="No templates yet"
                    description="Templates power one-off sends, broadcasts and journey steps. Create your first one."
                    action={
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="size-4" />
                        New template
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Key</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Body</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {templates.map((template) => {
                          const inMeta = !!template.meta_id;
                          return (
                            <TableRow key={template.id}>
                              <TableCell className="font-medium">
                                {template.key}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    CATEGORY_VARIANT[template.category] ??
                                    "outline"
                                  }
                                >
                                  {template.category}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {inMeta ? (
                                  <Badge variant="outline" className="gap-1.5">
                                    <span
                                      className={cn(
                                        "size-1.5 rounded-full",
                                        STATUS_DOT[template.status] ??
                                          "bg-neutral",
                                      )}
                                    />
                                    {template.status}
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="gap-1.5 text-muted-foreground"
                                    title="This template is a local draft. It only becomes Approved once it exists and is approved in Meta, then arrives via Sync from Meta."
                                  >
                                    <span className="size-1.5 rounded-full bg-neutral" />
                                    Draft · not in Meta
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="max-w-[360px]">
                                <p className="truncate text-muted-foreground">
                                  {template.body}
                                </p>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete ${template.key}`}
                                  loading={
                                    deleteMutation.isPending &&
                                    deleteMutation.variables === template.id
                                  }
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove template "${template.key}"? This only deletes the local record${inMeta ? ", it stays in Meta and returns on the next sync" : ""}.`,
                                      )
                                    )
                                      deleteMutation.mutate(template.id);
                                  }}
                                >
                                  {deleteMutation.isPending &&
                                  deleteMutation.variables ===
                                    template.id ? null : (
                                    <Trash2 className="size-4 text-muted-foreground" />
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- AI agent tester ---- */}
          <TabsContent value="agent" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>AI agent tester</CardTitle>
                <CardDescription>
                  Ask anything a customer might send on WhatsApp. Replies are
                  grounded in your published knowledge base articles.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex h-[460px] flex-col overflow-hidden rounded-xl border">
                  {/* WhatsApp-style chat header */}
                  <div className="flex items-center gap-3 border-b bg-card px-4 py-2.5 text-foreground">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
                      <Bot className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-tight">
                        {BRAND.assistantName}
                      </p>
                      <p className="text-[11px] leading-tight text-muted-foreground">
                        online · replies from your knowledge base
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wide">
                      AI
                    </span>
                  </div>

                  {/* Messages on the WhatsApp chat wallpaper */}
                  <div
                    ref={chatScrollRef}
                    className="flex-1 space-y-2.5 overflow-y-auto bg-muted px-3 py-4 sm:px-5"
                    style={{ backgroundImage: doodleBg("#54656f", 0.06) }}
                  >
                    {chatEmpty ? (
                      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <span className="flex size-12 items-center justify-center text-success">
                          <Bot className="size-6" />
                        </span>
                        <p className="text-sm font-medium text-foreground">
                          Ask anything a customer might send
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {AGENT_SUGGESTIONS.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => askAgent(suggestion)}
                              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors duration-120 hover:bg-muted"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        {exchanges.map((exchange, index) => (
                          <div
                            key={`${exchange.question}-${index}`}
                            className="space-y-2"
                          >
                            {/* Outgoing (customer) bubble */}
                            <div className="flex justify-end">
                              <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-brand/10 px-3 py-2 text-sm leading-relaxed text-foreground">
                                <p className="whitespace-pre-wrap break-words">
                                  {exchange.question}
                                </p>
                                <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                                  {clockTime(exchange.at)}
                                  <CheckCheck className="size-3.5 text-info" />
                                </span>
                              </div>
                            </div>
                            {/* Incoming (agent) bubble + meta */}
                            {exchange.reply ? (
                              <div className="flex max-w-[88%] flex-col gap-2">
                                <div className="rounded-lg rounded-tl-sm bg-card px-3 py-2 text-sm leading-relaxed text-foreground">
                                  <p className="whitespace-pre-wrap break-words">
                                    {exchange.reply.reply}
                                  </p>
                                  <span className="mt-0.5 block text-right text-[10px] text-muted-foreground">
                                    {clockTime(exchange.at)}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 pl-0.5">
                                  <Zap className="size-3 text-success" />
                                  <Badge
                                    variant="brand"
                                    className="font-mono text-[11px]"
                                  >
                                    {exchange.reply.action}
                                  </Badge>
                                </div>
                                {exchange.reply.sources.length > 0 ? (
                                  <div className="space-y-1.5">
                                    <p className="pl-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Sources
                                    </p>
                                    {exchange.reply.sources.map(
                                      (source, sourceIndex) => (
                                        <div
                                          key={sourceKey(source, sourceIndex)}
                                          className="border-b py-2"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="truncate text-xs font-medium">
                                              {sourceTitle(source)}
                                            </p>
                                            {source.score != null ? (
                                              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                                score {source.score}
                                              </span>
                                            ) : null}
                                          </div>
                                          {source.snippet ? (
                                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                              {source.snippet}
                                            </p>
                                          ) : null}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                        {/* In-flight: show the sent question + a typing bubble */}
                        {agentMutation.isPending ? (
                          <div className="space-y-2">
                            <div className="flex justify-end">
                              <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-brand/10 px-3 py-2 text-sm leading-relaxed text-foreground">
                                <p className="whitespace-pre-wrap break-words">
                                  {question}
                                </p>
                              </div>
                            </div>
                            <div className="flex justify-start">
                              <div className="flex items-center gap-1 rounded-lg rounded-tl-sm bg-card px-3.5 py-3">
                                <span className="size-2 animate-bounce rounded-full bg-neutral/50 [animation-delay:-0.2s]" />
                                <span className="size-2 animate-bounce rounded-full bg-neutral/50 [animation-delay:-0.1s]" />
                                <span className="size-2 animate-bounce rounded-full bg-neutral/50" />
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>

                  {/* WhatsApp-style input bar */}
                  <form
                    className="flex items-center gap-2 bg-muted px-3 py-2.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      askAgent(question);
                    }}
                  >
                    <Input
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="Type a message as a customer would…"
                      disabled={agentMutation.isPending}
                      className="border-transparent bg-card"
                    />
                    <button
                      type="submit"
                      disabled={agentMutation.isPending || !question.trim()}
                      aria-label="Send message"
                      className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground transition-colors duration-120 hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {agentMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </button>
                  </form>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- Broadcast ---- */}
          <TabsContent value="broadcast" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Send a broadcast</CardTitle>
                  <CardDescription>
                    Sends the chosen template to every lead carrying the
                    audience tag.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={handleBroadcast}>
                    <div className="space-y-1.5">
                      <Label htmlFor="broadcast-template">Template</Label>
                      <Select
                        value={broadcastTemplate}
                        onValueChange={setBroadcastTemplate}
                      >
                        <SelectTrigger id="broadcast-template">
                          <SelectValue
                            placeholder={
                              templates.length === 0
                                ? "No templates yet"
                                : "Pick a template"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((template) => (
                            <SelectItem key={template.id} value={template.key}>
                              {template.key}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="audience-tag">Audience tag</Label>
                      <Input
                        id="audience-tag"
                        value={audienceTag}
                        onChange={(event) => setAudienceTag(event.target.value)}
                        placeholder="e.g. webinar-june"
                      />
                      <p className="text-xs text-muted-foreground">
                        Leads are matched on their tags list.
                      </p>
                    </div>
                    <Button
                      type="submit"
                      loading={broadcastMutation.isPending}
                      disabled={
                        broadcastMutation.isPending || templates.length === 0
                      }
                    >
                      {broadcastMutation.isPending ? null : (
                        <Megaphone className="size-4" />
                      )}
                      Send broadcast
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent result</CardTitle>
                  <CardDescription>
                    Outcome of your latest broadcast this session.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {lastBroadcast ? (
                    <div className="border-t pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                            {formatNumber(lastBroadcast.sent)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            message{lastBroadcast.sent === 1 ? "" : "s"} sent
                          </p>
                        </div>
                        <span className="flex size-8 shrink-0 items-center justify-center text-success">
                          <Megaphone className="size-4" />
                        </span>
                      </div>
                      <div className="mt-4 space-y-2 border-t pt-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            Template
                          </span>
                          <span className="truncate font-medium">
                            {lastBroadcast.templateKey}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            Audience tag
                          </span>
                          <Badge variant="brand">
                            {lastBroadcast.audienceTag}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Sent</span>
                          <span className="tabular-nums">
                            {timeAgo(lastBroadcast.at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
                      <Megaphone className="size-5 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        No broadcasts yet this session. Results show here right
                        after you send one.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* Create-template dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New WhatsApp template</DialogTitle>
            <DialogDescription>
              Keys must be unique. Use {"{name}"} anywhere in the body to
              personalise. This saves a local draft, Meta only marks it
              Approved after you submit and it passes review, which arrives on
              the next sync.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-key">Key</Label>
              <Input
                id="tpl-key"
                value={tplKey}
                onChange={(event) => setTplKey(event.target.value)}
                placeholder="e.g. welcome_v2"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-category">Category</Label>
              <Select
                value={tplCategory}
                onValueChange={(value) =>
                  setTplCategory(value as WaTemplateCategory)
                }
              >
                <SelectTrigger id="tpl-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WA_TEMPLATE_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">Body</Label>
              <Textarea
                id="tpl-body"
                rows={4}
                value={tplBody}
                onChange={(event) => setTplBody(event.target.value)}
                placeholder="Hi {name}, thanks for your interest in Acme..."
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createMutation.isPending}>
                {createMutation.isPending ? null : <Plus className="size-4" />}
                Create template
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
