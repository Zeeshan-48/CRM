// Email API: reusable templates, the AI email writer, sends with simulated
// engagement tracking, and aggregate metrics.

import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { InboxMessage } from "./inbox";
import type { LeadOption } from "./lead-options";

// ---- Types (colocated; mirror open-crm-api email responses) ----

export interface EmailTemplate {
  id: string;
  tenant_id: string;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailTemplateInput {
  name: string;
  subject: string;
  body: string;
  category?: string;
}

// Built-in draft types shipped with the app. Workspaces can add more of their
// own from the UI (stored server-side); those arrive as CustomDraftType via
// listDraftTypes and are merged into the dropdown. `type` on WriteEmailInput is
// therefore a plain string (a built-in key OR a custom key).
export type EmailDraftType =
  | "sales"
  | "followup"
  | "response"
  | "referral"
  | "meeting"
  | "proposal"
  | "reengage"
  | "thankyou"
  | "renewal";

// A workspace-defined AI Email Writer type (tenants.config.emailDraftTypes).
export interface CustomDraftType {
  key: string;
  label: string;
  intent: string;
  subject?: string;
  body?: string;
}

export interface AddDraftTypeInput {
  label: string;
  intent: string;
  subject?: string;
  body?: string;
}

// The type list as the UI needs it: custom (deletable) types plus the keys of
// any built-in types the workspace has hidden (restorable).
export interface DraftTypeSettings {
  custom: CustomDraftType[];
  hidden: string[];
}

export interface WriteEmailInput {
  type: string;
  name: string;
  company?: string;
  /** Free-form brief ("what this email is for") to steer the AI draft. */
  brief?: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  generatedBy: string;
  type: string;
}

export interface SendEmailInput {
  leadId?: string;
  contactId?: string;
  subject?: string;
  body: string;
}

export interface SentEmail extends InboxMessage {
  subject: string;
  /** "SES" for a real delivery, "SIMULATED" when SES is not keyed. */
  provider: "SES" | "SIMULATED";
  /** A freshly-sent email has no engagement yet; opens/clicks arrive later. */
  opened: boolean;
  clicked: boolean;
}

export interface EmailMetrics {
  sent: number;
  openRate: number;
  clickRate: number;
  replies: number;
  /** Delivered / bounced counts from the SES event pipeline. */
  delivered?: number;
  bounced?: number;
  /** True when open/click rates reflect real SES tracking (not just raw sends). */
  tracked?: boolean;
}

// ---- Calls ----

export const listEmailTemplates = () => apiGet<EmailTemplate[]>("/email/templates");

export const createEmailTemplate = (input: CreateEmailTemplateInput) =>
  apiPost<EmailTemplate>("/email/templates", input);

export const updateEmailTemplate = (id: string, input: CreateEmailTemplateInput) =>
  apiPut<EmailTemplate>(`/email/templates/${id}`, input);

export const deleteEmailTemplate = (id: string) =>
  apiDelete<{ id: string }>(`/email/templates/${id}`);

export const writeEmail = (input: WriteEmailInput) =>
  apiPost<EmailDraft>("/email/write", input);

// ---- Custom draft types (workspace-defined AI Email Writer types) ----

export const listDraftTypes = () =>
  apiGet<DraftTypeSettings>("/email/draft-types");

export const addDraftType = (input: AddDraftTypeInput) =>
  apiPost<CustomDraftType>("/email/draft-types", input);

// Removes a type: deletes a custom one, or hides a built-in one.
export const deleteDraftType = (key: string) =>
  apiDelete<{ key: string }>(`/email/draft-types/${key}`);

// Restores a previously hidden built-in type.
export const restoreDraftType = (key: string) =>
  apiPost<{ key: string }>(`/email/draft-types/${key}/restore`, {});

export const sendEmail = (input: SendEmailInput) =>
  apiPost<SentEmail>("/email/send", input);

export const getEmailMetrics = () => apiGet<EmailMetrics>("/email/metrics");

/** Leads for the "send to lead" select. */
export const listLeadOptions = () =>
  apiGet<{ leads: LeadOption[] }>("/leads", { params: { limit: 100 } }).then(
    (result) => result.leads
  );

/**
 * Server-side lead search for the recipient combobox. Passing `q` filters by
 * name/email/phone on the backend, so the picker isn't capped at the first
 * page of leads and can find anyone by typing. Empty `q` returns the most
 * relevant leads (first page).
 */
export const searchLeadOptions = (q?: string) =>
  apiGet<{ leads: LeadOption[] }>("/leads", {
    params: { limit: 50, q: q && q.trim() ? q.trim() : undefined },
  }).then((result) => result.leads);
