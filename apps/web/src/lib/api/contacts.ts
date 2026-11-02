import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { Activity } from "./activities";
import type { Meeting } from "./calendar";
import type { Deal } from "./deals";

export type ContactLifecycle = "LEAD" | "PROSPECT" | "CUSTOMER";

export interface Contact {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  account_id: string | null;
  title: string | null;
  city: string | null;
  owner_id: string | null;
  tags: string[] | null;
  socials: Record<string, string> | null;
  lifecycle: ContactLifecycle;
  converted_from_lead_id: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Relation shapes used by the contact 360 view (and lead detail) ----

export interface CrmMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  channel: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  lead_id: string | null;
  contact_id: string | null;
  sender_user_id: string | null;
  sentiment: string | null;
  sentiment_score: number | null;
  simulated: boolean;
  at: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceCall {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  contact_id: string | null;
  agent_user_id: string | null;
  direction: "INBOUND" | "OUTBOUND";
  goal: string | null;
  provider: string;
  duration_sec: number;
  transcript: Array<{ speaker: string; text: string }> | null;
  summary: string | null;
  sentiment_label: string | null;
  sentiment_score: number | null;
  outcome: string | null;
  lead_score_delta: number;
  action_items: string[] | null;
  /** Storage key or provider URL; play via the telephony recording endpoint. */
  recording_url?: string | null;
  call_status?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Ticket {
  id: string;
  tenant_id: string;
  subject: string;
  body: string | null;
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  status: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
  contact_id: string | null;
  assignee_id: string | null;
  channel: string | null;
  sentiment: string | null;
  escalated: boolean;
  csat: number | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  channel: string;
  lead_id: string | null;
  contact_id: string | null;
  subject: string | null;
  status: "OPEN" | "CLOSED";
  unread_count: number;
  last_message_at: string | null;
  last_preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  number: string;
  deal_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  amount: number;
  tax: number;
  status: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "REFUNDED";
  gateway: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineItem {
  /** `product` = something the person did in a connected product, not a CRM touch. */
  kind: "activity" | "message" | "call" | "meeting" | "ticket" | "product";
  at: string;
  label: string | null;
  type: string | null;
  /** Product events only: flagged on the event definition as a buying signal. */
  highIntent?: boolean;
}

export interface ContactDetail extends Contact {
  activities: Activity[];
  tickets: Ticket[];
  conversations: Conversation[];
  messages: CrmMessage[];
  deals: Deal[];
  invoices: Invoice[];
  calls: VoiceCall[];
  meetings: Meeting[];
  timeline: TimelineItem[];
}

export const listContacts = (params?: { q?: string; lifecycle?: ContactLifecycle }) =>
  apiGet<Contact[]>("/contacts", { params });

export const getContact = (id: string) => apiGet<ContactDetail>(`/contacts/${id}`);

export const createContact = (body: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  city?: string;
  lifecycle?: ContactLifecycle;
  account_id?: string;
}) => apiPost<Contact>("/contacts", body);

export const updateContact = (
  id: string,
  body: Partial<{
    name: string;
    email: string;
    phone: string;
    company: string;
    title: string;
    city: string;
    lifecycle: ContactLifecycle;
    tags: string[];
    socials: Record<string, string>;
    account_id: string | null;
  }>
) => apiPut<Contact>(`/contacts/${id}`, body);

export const deleteContact = (id: string) =>
  apiDelete<{ ok: boolean }>(`/contacts/${id}`);
