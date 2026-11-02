// Omnichannel inbox API. Conversations group messages per lead/contact and
// channel; the backend resets a conversation's unread count when its detail
// endpoint is read.

import { apiGet, apiPost } from "./client";

// ---- Types (colocated; mirror open-crm-api inbox responses) ----

export const INBOX_CHANNELS = [
  "WHATSAPP",
  "EMAIL",
  "SMS",
  "TELEGRAM",
  "CHAT",
  "FACEBOOK",
  "INSTAGRAM",
  "VOICE",
] as const;

export type InboxChannel = (typeof INBOX_CHANNELS)[number];

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type ConversationStatus = "OPEN" | "CLOSED";

export interface ChannelSummary {
  channel: InboxChannel;
  conversations: number;
  unread: number;
}

export interface ConversationWho {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ConversationSummary {
  id: string;
  tenant_id: string;
  channel: InboxChannel;
  lead_id: string | null;
  contact_id: string | null;
  lead_name: string | null;
  contact_name: string | null;
  who: ConversationWho | null;
  subject: string | null;
  status: ConversationStatus;
  unread_count: number;
  last_message_at: string | null;
  last_preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboxMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  channel: InboxChannel;
  direction: MessageDirection;
  body: string;
  lead_id: string | null;
  contact_id: string | null;
  sender_user_id: string | null;
  /** Sentiment label: "Positive" | "Neutral" | "Negative". */
  sentiment: string | null;
  sentiment_score: number | null;
  simulated: boolean;
  /** Delivery receipt for outbound: sent | delivered | read | failed | null. */
  status: string | null;
  at: string;
  created_at: string;
  updated_at: string;
}

export interface InboxOverview {
  channels: ChannelSummary[];
  conversations: ConversationSummary[];
}

export interface ConversationDetail extends ConversationSummary {
  messages: InboxMessage[];
}

// ---- Calls ----

export const getInbox = (channel?: InboxChannel) =>
  apiGet<InboxOverview>("/inbox", {
    params: channel ? { channel } : undefined,
  });

export const getConversation = (conversationId: string) =>
  apiGet<ConversationDetail>(`/inbox/${conversationId}`);

export const sendInboxReply = (conversationId: string, body: string) =>
  apiPost<InboxMessage>(`/inbox/${conversationId}/send`, { body });
