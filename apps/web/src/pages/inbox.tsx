import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCheck,
  ChevronLeft,
  CornerDownLeft,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Reply,
  Search,
  Send,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  getConversation,
  getInbox,
  sendInboxReply,
  type ConversationDetail,
  type ConversationSummary,
  type InboxChannel,
  type InboxMessage,
} from "@/lib/api/inbox";
import { formatDate, initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

// The inbox supports exactly two channels: WhatsApp and email, the only ones
// with a real, working transport. Partial<> so indexing by any InboxChannel the
// backend might return stays type-safe (unknown channels resolve to undefined
// and are filtered out by VISIBLE_CHANNELS before they ever render).
const CHANNEL_META: Partial<
  Record<InboxChannel, { label: string; icon: LucideIcon }>
> = {
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle },
  EMAIL: { label: "Email", icon: Mail },
};

// Channel-identity colour for the small badge overlaid on an avatar (WhatsApp
// green, email blue), without recolouring the avatar itself.
const CHANNEL_ACCENT: Partial<Record<InboxChannel, string>> = {
  WHATSAPP: "bg-emerald-500",
  EMAIL: "bg-sky-500",
};

// The channels shown anywhere in the inbox. Everything else the backend can
// store is filtered out of the rail, the list, and the totals.
const VISIBLE_CHANNELS: InboxChannel[] = ["WHATSAPP", "EMAIL"];

// Maps the /inbox/:channel route segment (set by the sidebar's WhatsApp / Email
// items) to a channel. A bare /inbox (no segment) falls back to the combined
// view with an in-page rail.
const PARAM_TO_CHANNEL: Record<string, InboxChannel> = {
  whatsapp: "WHATSAPP",
  email: "EMAIL",
};

const conversationName = (conversation: ConversationSummary): string =>
  conversation.who?.name || conversation.subject || "Unknown contact";

// Just the clock time, the day is carried by the separators between message
// groups, so repeating the full date on every bubble is redundant noise.
const formatTime = (value: string): string =>
  formatDate(value, { hour: "numeric", minute: "2-digit" });

// "Today" / "Yesterday" / "3 Jul 2026" for the divider between days in a thread.
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const dayLabel = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return formatDate(value);
};

// Every sender gets a flat avatar colour from the theme palette, keyed off the
// name so one contact is always one colour.
const GMAIL_AVATAR_COLORS = [
  "bg-brand",
  "bg-info",
  "bg-success",
  "bg-warning",
  "bg-danger",
  "bg-neutral",
  "bg-brand/70",
  "bg-info/70",
];

const gmailAvatarColor = (name: string | null): string => {
  const key = (name ?? "?").trim() || "?";
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return GMAIL_AVATAR_COLORS[hash % GMAIL_AVATAR_COLORS.length];
};

// Circular, single-colour Gmail-style avatar with a white initial.
function GmailAvatar({ name, size = "md" }: { name: string | null; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        size === "lg" ? "size-10 text-base" : "size-9 text-sm",
        gmailAvatarColor(name),
      )}
    >
      {initials(name).charAt(0)}
    </span>
  );
}

// Avatar with the contact's initials plus a small channel-tinted badge, so a row
// or header shows who AND on which channel at a glance.
function ChannelAvatar({
  name,
  channel,
  size = "md",
  showChannelBadge = true,
}: {
  name: string | null;
  channel: InboxChannel;
  size?: "md" | "lg";
  // Hidden on WhatsApp-scoped surfaces where every avatar is the same channel,
  // so the little green badge would be redundant noise.
  showChannelBadge?: boolean;
}) {
  const Icon = CHANNEL_META[channel]?.icon ?? MessagesSquare;
  return (
    <div className="relative shrink-0">
      <Avatar className={size === "lg" ? "size-10" : "size-9"}>
        <AvatarFallback className="bg-brand/15 text-[11px] font-semibold text-brand">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      {showChannelBadge ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full ring-2 ring-card",
            CHANNEL_ACCENT[channel] ?? "bg-brand",
          )}
        >
          <Icon className="size-2.5 text-white" />
        </span>
      ) : null}
    </div>
  );
}

// WhatsApp-style delivery receipt for an outbound message. Populated by the
// provider status webhooks (sent -> delivered -> read); read is highlighted.
// `whatsapp` renders the authentic WhatsApp ticks: grey until read, then the
// signature blue double-tick, with the grey ticks inheriting the bubble's meta
// colour so they read on the green outbound bubble in both themes.
function MessageReceipt({
  status,
  whatsapp,
}: {
  status: string | null;
  whatsapp?: boolean;
}) {
  const s = (status ?? "").toLowerCase();
  if (s === "failed")
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] text-danger"
        title="Failed"
      >
        <TriangleAlert className="size-3" /> failed
      </span>
    );
  const read = s === "read";
  const delivered = s === "delivered";
  if (whatsapp) {
    if (read)
      return <CheckCheck className="size-4 text-info" aria-label="read" />;
    if (delivered)
      return (
        <CheckCheck className="size-4 text-current" aria-label="delivered" />
      );
    return <Check className="size-4 text-current" aria-label="sent" />;
  }
  if (read)
    return <CheckCheck className="size-3.5 text-brand" aria-label="read" />;
  if (delivered)
    return (
      <CheckCheck
        className="size-3.5 text-muted-foreground"
        aria-label="delivered"
      />
    );
  // sent / received / queued / (optimistic)
  return <Check className="size-3.5 text-muted-foreground" aria-label="sent" />;
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const tone =
    sentiment === "Positive"
      ? "bg-success"
      : sentiment === "Negative"
        ? "bg-danger"
        : "bg-neutral";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", tone)} />
      {sentiment}
    </span>
  );
}

// Bare sentiment dot (no label) for the tight WhatsApp bubble meta row, where a
// full badge would crowd the timestamp. Same colour scale as SentimentBadge.
function SentimentDot({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const tone =
    sentiment === "Positive"
      ? "bg-success"
      : sentiment === "Negative"
        ? "bg-danger"
        : "bg-neutral";
  return (
    <span
      className={cn("size-1.5 rounded-full", tone)}
      title={`${sentiment} sentiment`}
    />
  );
}

function UnreadPill({
  count,
  whatsapp,
}: {
  count: number;
  whatsapp?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
        whatsapp
          ? "bg-success text-white"
          : "bg-brand text-brand-foreground",
      )}
    >
      {count}
    </span>
  );
}

export default function InboxPage() {
  const queryClient = useQueryClient();
  // The sidebar links to /inbox/whatsapp and /inbox/email; each scopes the page
  // to one channel (rail hidden). A bare /inbox keeps the combined view + rail.
  const { channel: channelParam } = useParams();
  const routeChannel = channelParam ? PARAM_TO_CHANNEL[channelParam] : undefined;
  const scoped = !!routeChannel;
  const [railChannel, setRailChannel] = React.useState<"ALL" | InboxChannel>(
    "ALL",
  );
  const channel: "ALL" | InboxChannel = routeChannel ?? railChannel;
  const scopedLabel = routeChannel ? CHANNEL_META[routeChannel]?.label : undefined;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  // Client-side filter for the WhatsApp-style search box in the chat list.
  const [search, setSearch] = React.useState("");

  // Switching channel (i.e. navigating between the WhatsApp and Email pages)
  // drops any conversation still open from the other channel.
  React.useEffect(() => {
    setSelectedId(null);
  }, [channel]);

  const inboxQuery = useQuery({
    queryKey: ["inbox", channel],
    queryFn: () => getInbox(channel === "ALL" ? undefined : channel),
  });

  const detailQuery = useQuery({
    queryKey: ["conversation", selectedId],
    queryFn: () => getConversation(selectedId as string),
    enabled: !!selectedId,
  });

  const channels = (inboxQuery.data?.channels ?? []).filter((ch) =>
    VISIBLE_CHANNELS.includes(ch.channel),
  );
  const conversations = (inboxQuery.data?.conversations ?? []).filter((c) =>
    VISIBLE_CHANNELS.includes(c.channel),
  );
  // Name/preview search, only wired to the WhatsApp chat-list search box, so it
  // is a no-op (empty query) on the email/combined views.
  const query = search.trim().toLowerCase();
  const visibleConversations = query
    ? conversations.filter(
        (c) =>
          conversationName(c).toLowerCase().includes(query) ||
          (c.last_preview ?? "").toLowerCase().includes(query),
      )
    : conversations;
  const detail = detailQuery.data;
  const detailId = detail?.id;
  // Authentic WhatsApp skin, applied to the thread whenever the open
  // conversation is a WhatsApp one (works on both the scoped /inbox/whatsapp
  // page and the combined view). `scopedWhatsapp` also skins the placeholder /
  // loading panes on the dedicated WhatsApp page, where no thread is open yet.
  const whatsapp = detail?.channel === "WHATSAPP";
  const scopedWhatsapp = routeChannel === "WHATSAPP";
  // Gmail skin, the email counterpart to the WhatsApp one above. `gmail` skins
  // the open thread (subject heading + stacked message cards + inline reply);
  // `scopedGmail` skins the chat list + placeholder on the dedicated Email page.
  const gmail = detail?.channel === "EMAIL";
  const scopedGmail = routeChannel === "EMAIL";

  // Opening a conversation resets its unread count server-side; refresh the
  // rail and list counts once per opened conversation.
  React.useEffect(() => {
    if (detailId) queryClient.invalidateQueries({ queryKey: ["inbox"] });
  }, [detailId, queryClient]);

  // Keep the latest message in view.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const messageCount = detail?.messages.length ?? 0;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detailId, messageCount]);

  // Grow the reply box with its content between a one-line floor (kept in lock-
  // step with the send button's height) and a cap, past which it scrolls.
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 140)}px`;
  }, [draft, detailId]);

  const sendMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      sendInboxReply(id, body),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: ["conversation", id] });
      const previous = queryClient.getQueryData<ConversationDetail>([
        "conversation",
        id,
      ]);
      if (previous) {
        const nowIso = new Date().toISOString();
        const optimistic: InboxMessage = {
          id: `optimistic-${Date.now()}`,
          tenant_id: previous.tenant_id,
          conversation_id: id,
          channel: previous.channel,
          direction: "OUTBOUND",
          body,
          lead_id: previous.lead_id,
          contact_id: previous.contact_id,
          sender_user_id: null,
          sentiment: null,
          sentiment_score: null,
          simulated: true,
          status: "sent",
          at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        };
        queryClient.setQueryData<ConversationDetail>(["conversation", id], {
          ...previous,
          last_preview: body,
          last_message_at: nowIso,
          messages: [...previous.messages, optimistic],
        });
      }
      setDraft("");
      return { previous };
    },
    onError: (error: Error, { id, body }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["conversation", id], context.previous);
      }
      setDraft(body);
      toast.error(error.message || "Could not send the message.");
    },
    onSettled: (_message, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["conversation", id] });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const submitReply = () => {
    const body = draft.trim();
    if (!body || !selectedId || sendMutation.isPending) return;
    sendMutation.mutate({ id: selectedId, body });
  };

  const handleSend = (event: React.FormEvent) => {
    event.preventDefault();
    submitReply();
  };

  // Enter sends; Shift+Enter inserts a newline (standard messaging behaviour).
  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitReply();
    }
  };

  const totals = channels.reduce(
    (acc, ch) => ({
      conversations: acc.conversations + ch.conversations,
      unread: acc.unread + ch.unread,
    }),
    { conversations: 0, unread: 0 },
  );

  const railItems: Array<{
    key: "ALL" | InboxChannel;
    label: string;
    icon: LucideIcon;
    count: number;
    unread: number;
  }> = [
    {
      key: "ALL",
      label: "All channels",
      icon: Inbox,
      count: totals.conversations,
      unread: totals.unread,
    },
    ...VISIBLE_CHANNELS.map((key) => {
      const summary = channels.find((ch) => ch.channel === key);
      return {
        key,
        label: CHANNEL_META[key]?.label ?? key,
        icon: CHANNEL_META[key]?.icon ?? MessagesSquare,
        count: summary?.conversations ?? 0,
        unread: summary?.unread ?? 0,
      };
    }),
  ];

  const showEmpty = !inboxQuery.isLoading && conversations.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={scopedLabel ?? "Inbox"}
        description={
          scopedLabel
            ? `Your ${scopedLabel} conversations.`
            : "Your WhatsApp and email conversations in one place."
        }
      />

      <section className="reveal" style={{ animationDelay: "80ms" }}>
        <div className="flex h-[calc(100vh-210px)] min-h-[620px] overflow-hidden rounded-lg border bg-card">
          {/* Channel rail, only on the combined /inbox view. When the sidebar
              scopes the page to one channel, the rail is redundant and hidden. */}
          {!scoped ? (
          <aside className="hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2 md:flex">
            {railItems.map((item) => {
              const active = channel === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRailChannel(item.key)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-120",
                    active
                      ? "bg-brand/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon
                    className={cn("size-4 shrink-0", active && "text-brand")}
                  />
                  <span className="flex-1 truncate text-left">
                    {item.label}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {inboxQuery.isLoading ? "" : item.count}
                  </span>
                  <UnreadPill count={item.unread} />
                </button>
              );
            })}
          </aside>
          ) : null}

          {/* Conversation list, full width on mobile; hidden there once a
              thread is open (master-detail). Always shown from sm up. */}
          <div
            className={cn(
              "w-full shrink-0 flex-col border-r sm:flex sm:w-80",
              selectedId ? "hidden" : "flex",
              scopedWhatsapp && "bg-card",
              scopedGmail && "bg-card",
            )}
          >
            {scopedWhatsapp ? (
              // WhatsApp chat-list header: a "Chats" title over the signature
              // grey search box.
              <div className="shrink-0 border-b">
                <div className="px-4 pb-1 pt-3">
                  <p className="font-display text-lg font-semibold tracking-tight text-foreground">
                    Chats
                  </p>
                </div>
                <div className="px-3 pb-2.5 pt-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search or start new chat"
                      className="h-9 w-full rounded-lg border-0 bg-muted pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
                    />
                  </div>
                </div>
              </div>
            ) : scopedGmail ? (
              // Gmail list header: just the rounded "Search mail" bar.
              <div className="shrink-0 border-b p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search mail"
                    className="h-10 w-full rounded-md border-0 bg-muted pl-11 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:bg-card"
                  />
                </div>
              </div>
            ) : (
              <div className="border-b px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {channel === "ALL"
                    ? "All conversations"
                    : CHANNEL_META[channel]?.label}
                  {!inboxQuery.isLoading ? (
                    <span className="ml-1.5 tabular-nums">
                      ({conversations.length})
                    </span>
                  ) : null}
                </p>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {inboxQuery.isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))}
                </div>
              ) : showEmpty ? (
                <EmptyState
                  icon={Inbox}
                  title="No conversations yet"
                  description="Incoming WhatsApp and email replies from your leads and contacts will show up here."
                  className="h-full rounded-none border-0"
                />
              ) : visibleConversations.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No chats match “{search.trim()}”.
                </p>
              ) : (
                visibleConversations.map((conversation) => {
                  const selected = conversation.id === selectedId;
                  const unread = conversation.unread_count > 0;
                  if (scopedWhatsapp) {
                    // WhatsApp chat row: plain avatar, name + preview, time
                    // (green when unread) and a green unread pill; the divider
                    // is indented to start past the avatar, like WhatsApp.
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => setSelectedId(conversation.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 text-left transition-colors duration-120",
                          selected
                            ? "bg-muted"
                            : "hover:bg-muted",
                        )}
                      >
                        <ChannelAvatar
                          name={conversationName(conversation)}
                          channel={conversation.channel}
                          size="lg"
                          showChannelBadge={false}
                        />
                        <div className="min-w-0 flex-1 border-b border-border py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "truncate text-[15px] text-foreground",
                                unread ? "font-semibold" : "font-medium",
                              )}
                            >
                              {conversationName(conversation)}
                            </span>
                            <span
                              className={cn(
                                "ml-auto shrink-0 text-[11px] tabular-nums",
                                unread
                                  ? "font-semibold text-success"
                                  : "text-muted-foreground",
                              )}
                            >
                              {timeAgo(conversation.last_message_at)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <p
                              className={cn(
                                "min-w-0 flex-1 truncate text-[13px]",
                                unread
                                  ? "text-foreground/80"
                                  : "text-muted-foreground",
                              )}
                            >
                              {conversation.last_preview || "No messages yet"}
                            </p>
                            <UnreadPill
                              count={conversation.unread_count}
                              whatsapp
                            />
                          </div>
                        </div>
                      </button>
                    );
                  }
                  if (scopedGmail) {
                    // Gmail inbox row: sender avatar, sender (bold when unread),
                    // subject + snippet, and the date top-right.
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => setSelectedId(conversation.id)}
                        className={cn(
                          "flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left transition-colors duration-120",
                          selected
                            ? "bg-brand/10"
                            : unread
                              ? "bg-card hover:bg-muted"
                              : "hover:bg-muted",
                        )}
                      >
                        <GmailAvatar name={conversationName(conversation)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span
                              className={cn(
                                "truncate text-sm",
                                unread
                                  ? "font-bold text-foreground"
                                  : "text-foreground/80",
                              )}
                            >
                              {conversationName(conversation)}
                            </span>
                            <span
                              className={cn(
                                "ml-auto shrink-0 text-[11px] tabular-nums",
                                unread
                                  ? "font-semibold text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {timeAgo(conversation.last_message_at)}
                            </span>
                          </div>
                          <p
                            className={cn(
                              "truncate text-[13px]",
                              unread
                                ? "font-semibold text-foreground"
                                : "text-foreground/70",
                            )}
                          >
                            {conversation.subject || "(no subject)"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {conversation.last_preview || "No messages yet"}
                          </p>
                        </div>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSelectedId(conversation.id)}
                      className={cn(
                        "relative flex w-full items-center gap-3 border-b py-3 pl-4 pr-3 text-left transition-colors duration-120",
                        selected ? "bg-brand/10" : "hover:bg-muted",
                      )}
                    >
                      {/* Left accent bar: brand on the open thread, a soft brand
                          cue on unread ones, nothing otherwise. */}
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 w-0.5",
                          selected
                            ? "bg-brand"
                            : unread
                              ? "bg-brand/40"
                              : "bg-transparent",
                        )}
                      />
                      <ChannelAvatar
                        name={conversationName(conversation)}
                        channel={conversation.channel}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              unread
                                ? "font-semibold text-foreground"
                                : "font-medium",
                            )}
                          >
                            {conversationName(conversation)}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {timeAgo(conversation.last_message_at)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <p
                            className={cn(
                              "min-w-0 flex-1 truncate text-xs",
                              unread
                                ? "text-foreground/80"
                                : "text-muted-foreground",
                            )}
                          >
                            {conversation.last_preview || "No messages yet"}
                          </p>
                          <UnreadPill count={conversation.unread_count} />
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Thread pane, hidden on mobile until a conversation is picked;
              always visible from sm up. */}
          <div
            className={cn(
              "min-w-0 flex-1 flex-col sm:flex",
              selectedId ? "flex" : "hidden sm:flex",
            )}
          >
            {!selectedId ? (
              <div
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center",
                  scopedWhatsapp && "wa-wallpaper",
                  scopedGmail && "bg-card",
                )}
              >
                <span
                  className={cn(
                    "flex size-12 items-center justify-center rounded-lg",
                    scopedWhatsapp
                      ? "bg-success/15 text-success"
                      : scopedGmail
                        ? "bg-brand/10 text-brand"
                        : "bg-brand/10 text-brand",
                  )}
                >
                  {scopedGmail ? (
                    <Mail className="size-6" />
                  ) : (
                    <MessagesSquare className="size-6" />
                  )}
                </span>
                <div>
                  <p className="font-display text-sm font-semibold tracking-tight">
                    {scopedGmail ? "Select an email" : "Select a conversation"}
                  </p>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    Pick a thread from the list to read the full history and
                    reply.
                  </p>
                </div>
              </div>
            ) : detailQuery.isLoading || !detail ? (
              <div
                className={cn(
                  "flex-1 space-y-4 p-5",
                  scopedWhatsapp && "wa-wallpaper",
                  scopedGmail && "bg-card",
                )}
              >
                <Skeleton className="h-5 w-48" />
                <Skeleton className="ml-auto h-14 w-2/3" />
                <Skeleton className="h-14 w-2/3" />
                <Skeleton className="ml-auto h-14 w-1/2" />
              </div>
            ) : (
              <>
                {gmail ? (
                  // Gmail reading-pane toolbar: the subject as the heading, the
                  // archive / delete / more affordances, and the status.
                  <div className="flex items-center gap-1 border-b bg-card px-2 py-2 sm:px-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Back to inbox"
                      className="-ml-0.5 shrink-0 sm:hidden"
                      onClick={() => setSelectedId(null)}
                    >
                      <ChevronLeft className="size-5" />
                    </Button>
                    <div className="min-w-0 flex-1 px-1">
                      <h2 className="truncate font-display text-base font-normal tracking-tight text-foreground sm:text-lg">
                        {detail.subject || "(no subject)"}
                      </h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {detail.who?.email || conversationName(detail)}
                      </p>
                    </div>
                    <Badge variant="outline" className="ml-1 shrink-0 gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          detail.status === "OPEN"
                            ? "bg-success"
                            : "bg-neutral",
                        )}
                      />
                      {detail.status === "OPEN" ? "Open" : "Closed"}
                    </Badge>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "flex items-center gap-3 border-b px-4 py-3 sm:px-5",
                      whatsapp && "bg-muted",
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Back to conversations"
                      className="-ml-1.5 shrink-0 sm:hidden"
                      onClick={() => setSelectedId(null)}
                    >
                      <ChevronLeft className="size-5" />
                    </Button>
                    <ChannelAvatar
                      name={conversationName(detail)}
                      channel={detail.channel}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold tracking-tight">
                        {conversationName(detail)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {detail.who?.phone ||
                          detail.subject ||
                          CHANNEL_META[detail.channel]?.label}
                      </p>
                    </div>
                    {/* The channel badge is redundant on the WhatsApp skin (the
                        whole thread already reads as WhatsApp), email keeps it. */}
                    {!whatsapp ? (
                      <Badge variant="brand" className="gap-1.5">
                        {React.createElement(
                          CHANNEL_META[detail.channel]?.icon ?? MessagesSquare,
                          { className: "size-3" },
                        )}
                        {CHANNEL_META[detail.channel]?.label}
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          detail.status === "OPEN"
                            ? "bg-success"
                            : "bg-neutral",
                        )}
                      />
                      {detail.status === "OPEN" ? "Open" : "Closed"}
                    </Badge>
                  </div>
                )}

                <div
                  ref={scrollRef}
                  className={cn(
                    "flex flex-1 flex-col gap-1 overflow-y-auto py-4",
                    whatsapp
                      ? "wa-wallpaper px-4 sm:px-10"
                      : gmail
                        ? "gap-0 bg-card px-4 sm:px-6"
                        : "px-5",
                  )}
                >
                  {detail.messages.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      No messages in this conversation yet.
                    </p>
                  ) : (
                    detail.messages.map((message, i) => {
                      const outbound = message.direction === "OUTBOUND";
                      const prev = detail.messages[i - 1];
                      // Gmail shows a full date per message, so it skips the
                      // WhatsApp-style day separators between groups.
                      const showDay =
                        !gmail &&
                        (!prev ||
                          !sameDay(new Date(prev.at), new Date(message.at)));
                      // Consecutive messages from the same side on the same day
                      // are grouped: only the first gets the corner "tail", the
                      // rest tuck in tight beneath it (real WhatsApp behaviour).
                      const grouped =
                        !!prev &&
                        !showDay &&
                        prev.direction === message.direction;
                      return (
                        <React.Fragment key={message.id}>
                          {showDay ? (
                            <div className="flex justify-center py-2">
                              <span
                                className={cn(
                                  "text-[11px] font-medium",
                                  whatsapp
                                    ? "bg-card text-muted-foreground"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {dayLabel(message.at)}
                              </span>
                            </div>
                          ) : null}
                          {whatsapp ? (
                            <div
                              className={cn(
                                "flex flex-col",
                                outbound ? "items-end" : "items-start",
                                grouped ? "mt-0.5" : "mt-1.5",
                              )}
                            >
                              <div
                                className={cn(
                                  "flex max-w-[85%] flex-col rounded-lg px-2.5 py-1.5 text-sm leading-relaxed sm:max-w-[70%]",
                                  outbound
                                    ? "bg-brand/10 text-foreground"
                                    : "bg-card text-foreground",
                                  !grouped &&
                                    (outbound
                                      ? "rounded-tr-none"
                                      : "rounded-tl-none"),
                                )}
                              >
                                <span className="whitespace-pre-wrap">
                                  {message.body}
                                </span>
                                {/* Meta always on its own line at the bubble's
                                    bottom-right: sentiment label (inbound), the
                                    time, and delivery ticks (outbound). */}
                                <span className="mt-1 flex select-none items-center gap-1.5 self-end text-[11px] tabular-nums text-muted-foreground">
                                  {!outbound && message.sentiment ? (
                                    <span className="inline-flex items-center gap-1">
                                      <SentimentDot
                                        sentiment={message.sentiment}
                                      />
                                      {message.sentiment}
                                    </span>
                                  ) : null}
                                  {formatTime(message.at)}
                                  {outbound ? (
                                    <MessageReceipt
                                      status={message.status}
                                      whatsapp
                                    />
                                  ) : null}
                                </span>
                              </div>
                            </div>
                          ) : gmail ? (
                            // Gmail message card: sender avatar, sender + "to …"
                            // line with the full date, then the full-width body.
                            <div className="flex gap-3 border-b border-border py-4">
                              <GmailAvatar
                                name={outbound ? "Me" : conversationName(detail)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="text-sm font-semibold text-foreground">
                                    {outbound ? "me" : conversationName(detail)}
                                  </span>
                                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                    {formatDate(message.at, {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  to {outbound ? conversationName(detail) : "me"}
                                </p>
                                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                                  {message.body}
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  {!outbound ? (
                                    <SentimentBadge
                                      sentiment={message.sentiment}
                                    />
                                  ) : null}
                                  {outbound && message.status ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] capitalize text-muted-foreground">
                                      <MessageReceipt status={message.status} />
                                      {message.status}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={cn(
                                "flex flex-col gap-1",
                                outbound ? "items-end" : "items-start",
                                grouped ? "mt-0.5" : "mt-2",
                              )}
                            >
                              <div
                                className={cn(
                                  "max-w-[78%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                                  outbound
                                    ? "rounded-br-sm bg-brand text-brand-foreground"
                                    : "rounded-bl-sm bg-muted text-foreground",
                                )}
                              >
                                {message.body}
                              </div>
                              <div className="flex items-center gap-2 px-0.5">
                                <SentimentBadge sentiment={message.sentiment} />
                                <span className="text-[11px] tabular-nums text-muted-foreground">
                                  {formatTime(message.at)}
                                </span>
                                {outbound ? (
                                  <MessageReceipt status={message.status} />
                                ) : null}
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </div>

                {gmail ? (
                  // Gmail inline reply: an outlined, rounded "Reply to …" box
                  // with a blue circular send button.
                  <div className="shrink-0 border-t bg-card px-4 py-3 sm:px-6">
                    <form
                      onSubmit={handleSend}
                      className="flex items-end gap-2 rounded-3xl border py-1 pl-3 pr-2 transition-shadow"
                    >
                      <Reply className="mb-2.5 size-4 shrink-0 text-muted-foreground" />
                      <Textarea
                        ref={composerRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={handleComposerKeyDown}
                        rows={1}
                        placeholder={`Reply to ${conversationName(detail)}`}
                        className="h-10 max-h-[140px] min-h-10 flex-1 resize-none border-0 bg-transparent px-0 py-2 leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        className="size-9 shrink-0 bg-brand text-brand-foreground hover:bg-brand/90"
                        disabled={!draft.trim() || sendMutation.isPending}
                        aria-label="Send reply"
                      >
                        {sendMutation.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-4" />
                        )}
                      </Button>
                    </form>
                  </div>
                ) : (
                  <form
                    className={cn(
                      "flex items-end gap-2 border-t px-4 py-3 sm:px-5",
                      whatsapp && "bg-muted",
                    )}
                    onSubmit={handleSend}
                  >
                    <Textarea
                      ref={composerRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      rows={1}
                      placeholder={
                        whatsapp
                          ? "Type a message"
                          : `Reply on ${CHANNEL_META[detail.channel]?.label ?? "this channel"}...`
                      }
                      className={cn(
                        "h-10 max-h-[140px] min-h-10 flex-1 resize-none py-2 leading-6",
                        whatsapp &&
                          "rounded-3xl border-0 bg-card px-4 focus-visible:ring-0 focus-visible:ring-offset-0",
                      )}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className={cn(
                        "size-10 shrink-0",
                        whatsapp &&
                          "bg-brand text-brand-foreground hover:bg-brand/90",
                      )}
                      disabled={!draft.trim() || sendMutation.isPending}
                      aria-label="Send reply"
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : whatsapp ? (
                        <Send className="size-4" />
                      ) : (
                        <CornerDownLeft className="size-4" />
                      )}
                    </Button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
