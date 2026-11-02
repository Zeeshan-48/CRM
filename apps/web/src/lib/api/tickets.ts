// Tickets API. Types are colocated here and mirror
// open-crm-api/src/services/tickets.service.ts response shapes.
// Note: the list endpoint returns `contact` as a name string while the detail
// endpoint returns a full contact object; both carry a computed `breached` flag.

import { apiDelete, apiGet, apiPost, apiPut } from "./client";

export type TicketStatus = "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
export type TicketPriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";

export const TICKET_STATUSES: TicketStatus[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];
export const TICKET_PRIORITIES: TicketPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
export const TICKET_CHANNELS = ["web", "email", "phone", "whatsapp", "chat"] as const;

interface TicketBase {
  id: string;
  tenant_id: string;
  subject: string;
  body: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  contact_id: string | null;
  lead_id: string | null;
  assignee_id: string | null;
  channel: string | null;
  sla_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  sentiment: string | null;
  escalated: boolean;
  csat: number | null;
  created_at: string;
  updated_at: string;
}

export interface TicketListItem extends TicketBase {
  /** Contact display name, joined server-side. */
  contact: string | null;
  /** Lead display name, joined server-side. */
  lead: string | null;
  breached: boolean;
}

export interface TicketContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
}

export interface TicketReply {
  id: string;
  tenant_id: string;
  ticket_id: string;
  author_user_id: string | null;
  is_ai: boolean;
  body: string;
  /** How the reply was delivered to the customer: "email" | "whatsapp", or null for an internal note. */
  channel: string | null;
  created_at: string;
}

export interface TicketDetail extends TicketBase {
  breached: boolean;
  contact: TicketContact | null;
  /** Linked lead (recipient for customer replies when no contact is linked). */
  lead: TicketContact | null;
  replies: TicketReply[];
}

export interface TicketMetrics {
  total: number;
  open: number;
  resolved: number;
  breached: number;
  /** Backend returns an array of { priority, count }, not a keyed object. */
  byPriority: Array<{ priority: TicketPriority; count: number }>;
  csat: number | null;
}

export interface SlaPolicy {
  id: string;
  tenant_id: string;
  name: string;
  priority: string | null;
  first_response_hours: number | null;
  resolution_hours: number | null;
  is_default: boolean;
}

export interface RagSource {
  id: string;
  title: string;
}

export interface AiResolveResult {
  resolved: boolean;
  /** Present when resolved is true. */
  reply?: TicketReply;
  /** Present when resolved is true. */
  source?: RagSource;
  /** Present (possibly null) when resolved is false. */
  suggestion?: { article: RagSource; score: number; snippet: string } | null;
}

export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee?: string;
}

export interface CreateTicketInput {
  subject: string;
  body?: string;
  priority?: TicketPriority;
  contactId?: string;
  leadId?: string;
  assigneeId?: string;
  channel?: string;
}

export type ReplyChannel = "email" | "whatsapp";

export interface UpdateTicketInput {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee_id?: string | null;
}

/** Contact option for the create dialog. */
export interface ContactOption {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
}

/** Assignable user (subset of the public user shape from GET /users). */
export interface UserOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

export const listTickets = (filters: TicketFilters = {}) =>
  apiGet<TicketListItem[]>("/tickets", { params: filters });

export const getTicketMetrics = () => apiGet<TicketMetrics>("/tickets/metrics");

export const listSlaPolicies = () => apiGet<SlaPolicy[]>("/tickets/sla");

export const getTicket = (id: string) => apiGet<TicketDetail>(`/tickets/${id}`);

export const createTicket = (input: CreateTicketInput) =>
  apiPost<TicketBase>("/tickets", input);

export const updateTicket = (id: string, input: UpdateTicketInput) =>
  apiPut<TicketBase>(`/tickets/${id}`, input);

export const deleteTicket = (id: string) => apiDelete<{ ok: boolean }>(`/tickets/${id}`);

export const escalateTicket = (id: string) =>
  apiPost<TicketBase>(`/tickets/${id}/escalate`);

export const replyToTicket = (
  id: string,
  body: string,
  opts: { toCustomer?: boolean; channel?: ReplyChannel } = {}
) =>
  apiPost<{ ticket: TicketBase; reply: TicketReply; sentChannel: ReplyChannel | null }>(
    `/tickets/${id}/reply`,
    { body, toCustomer: opts.toCustomer, channel: opts.channel }
  );

export const aiResolveTicket = (id: string) =>
  apiPost<AiResolveResult>(`/tickets/${id}/ai-resolve`);

export const listContactOptions = () => apiGet<ContactOption[]>("/contacts");

/** Recent leads for the create dialog's "regarding" picker. */
export const listLeadOptions = async (): Promise<ContactOption[]> => {
  const res = await apiGet<{ data: Array<{ id: string; name: string; email: string | null }> }>(
    "/leads",
    { params: { limit: 200 } }
  );
  return res.data.map((l) => ({ id: l.id, name: l.name, email: l.email, company: null }));
};

export const listUserOptions = () => apiGet<UserOption[]>("/users");
