// WhatsApp API: BYO connection (Meta Cloud API), approved-style templates,
// one-off sends, tag broadcasts and the KB-grounded AI auto-reply agent.

import { apiDelete, apiGet, apiPost } from "./client";
import type { InboxMessage } from "./inbox";

// ---- BYO connection via Meta Embedded Signup ("Connect with Facebook"). ----

export type WhatsAppStatus = "PENDING" | "ACTIVE" | "DISABLED";

export interface WhatsAppConfig {
  configured: boolean;
  status: WhatsAppStatus;
  /** How the account was connected (EMBEDDED going forward). */
  connect_method: string;
  phone_number_id: string | null;
  waba_id: string | null;
  business_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  /** Whether an access token is stored (never returned here). */
  access_token_set: boolean;
  verified_at: string | null;
  last_error: string | null;
  /** True when the platform is wired for Embedded Signup (server-side). */
  embeddedAvailable: boolean;
  defaultAvailable: boolean;
  simulated: boolean;
}

/** Payload captured from the Embedded Signup popup + FB.login callback. */
export interface EmbeddedSignupInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
}

export const getWhatsAppConfig = () =>
  apiGet<WhatsAppConfig>("/whatsapp/config");
export const exchangeEmbeddedSignup = (input: EmbeddedSignupInput) =>
  apiPost<WhatsAppConfig>("/whatsapp/config/embedded-signup/exchange", input);
export const validateWhatsAppConfig = () =>
  apiPost<WhatsAppConfig>("/whatsapp/config/validate");
export const removeWhatsAppConfig = () =>
  apiDelete<{ ok: boolean }>("/whatsapp/config");

// ---- Types (colocated; mirror open-crm-api whatsapp responses) ----

export const WA_TEMPLATE_CATEGORIES = [
  "MARKETING",
  "ONBOARDING",
  "TRANSACTIONAL",
] as const;
export type WaTemplateCategory = (typeof WA_TEMPLATE_CATEGORIES)[number];

export const WA_TEMPLATE_STATUSES = [
  "APPROVED",
  "PENDING",
  "REJECTED",
] as const;
export type WaTemplateStatus = (typeof WA_TEMPLATE_STATUSES)[number];

export interface WhatsAppTemplate {
  id: string;
  tenant_id: string;
  key: string;
  body: string;
  category: WaTemplateCategory;
  status: WaTemplateStatus;
  language?: string;
  variables?: number;
  meta_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWaTemplateInput {
  key: string;
  body: string;
  category?: WaTemplateCategory;
}

export interface SendWhatsAppInput {
  leadId?: string;
  contactId?: string;
  templateKey?: string;
  body?: string;
}

/** The send response: the recorded message plus the live delivery outcome. */
export type SendWhatsAppResult = InboxMessage & {
  /** True when Meta actually accepted the message (not simulated/failed). */
  delivered?: boolean;
  /** A failure reason from Meta, when the send did not go out. */
  error?: string | null;
};

export interface BroadcastInput {
  templateKey: string;
  audienceTag: string;
}

export interface BroadcastResult {
  sent: number;
  audienceTag: string;
}

/**
 * Source returned by the agent. The backend currently returns plain
 * `{ id, title }` article refs (it maps RAG hits to `hit.article`), but the
 * full RAG hit shape `{ article, score, snippet }` is kept optional so the UI
 * renders richer data if the endpoint starts returning it.
 */
export interface AgentSource {
  id?: string;
  title?: string;
  article?: { id: string; title: string };
  score?: number;
  snippet?: string;
}

export interface AgentReplyResult {
  reply: string;
  action: string;
  sources: AgentSource[];
}

// ---- Calls ----

export const listWaTemplates = () =>
  apiGet<WhatsAppTemplate[]>("/whatsapp/templates");

export const createWaTemplate = (input: CreateWaTemplateInput) =>
  apiPost<WhatsAppTemplate>("/whatsapp/templates", input);

export const deleteWaTemplate = (id: string) =>
  apiDelete<{ deleted: boolean }>(`/whatsapp/templates/${id}`);

export const syncWaTemplates = () =>
  apiPost<{ synced: number; pruned?: number }>("/whatsapp/templates/sync");

export const sendWhatsApp = (input: SendWhatsAppInput) =>
  apiPost<SendWhatsAppResult>("/whatsapp/send", input);

export const broadcastWhatsApp = (input: BroadcastInput) =>
  apiPost<BroadcastResult>("/whatsapp/campaigns", input);

export const askWhatsAppAgent = (question: string, leadId?: string) =>
  apiPost<AgentReplyResult>("/whatsapp/agent/reply", { question, leadId });
