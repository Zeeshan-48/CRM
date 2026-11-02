// Per-tenant sending domains (BYOSD): onboard a brand domain, verify DNS,
// manage sender identities, and review the message log + suppressions.

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

export type EmailDomainStatus = "PENDING" | "VERIFIED" | "FAILED" | "DISABLED";
export type EmailCategory = "TRANSACTIONAL" | "NOTIFICATION" | "MARKETING";

export interface DnsRecord {
  type: "CNAME" | "MX" | "TXT";
  name: string;
  value: string;
  purpose: string;
  priority?: number;
}

export interface SendingDomain {
  id: string;
  subdomain: string;
  mail_from_subdomain: string | null;
  ses_configuration_set: string | null;
  status: EmailDomainStatus;
  dkim_status: string | null;
  mail_from_status: string | null;
  dns_records: DnsRecord[];
  verified_at: string | null;
  last_checked_at: string | null;
  apex?: boolean;
}

export interface SenderIdentity {
  id: string;
  sending_domain_id: string;
  email_address: string;
  display_name: string | null;
  reply_to: string | null;
  status: "ACTIVE" | "ARCHIVED";
  is_default_transactional: boolean;
  is_default_notification: boolean;
  is_default_marketing: boolean;
}

export interface EmailMessage {
  id: string;
  category: EmailCategory;
  from_address: string;
  to_address: string;
  subject: string | null;
  status: string;
  ses_message_id: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  created_at: string;
}

export interface Suppression {
  id: string;
  email: string;
  reason: string;
  category_scope: EmailCategory | null;
  created_at: string;
}

// ---- Domains ----
export const listSendingDomains = () => apiGet<SendingDomain[]>("/email-sending-domains");

export const onboardSendingDomain = (subdomain: string) =>
  apiPost<SendingDomain>("/email-sending-domains", { subdomain });

export const checkSendingDomain = (id: string) =>
  apiPost<SendingDomain>(`/email-sending-domains/${id}/check`);

export const deleteSendingDomain = (id: string) =>
  apiDelete<{ id: string }>(`/email-sending-domains/${id}`);

// ---- Sender identities ----
export const listSenderIdentities = () =>
  apiGet<SenderIdentity[]>("/email-sender-identities");

export interface CreateIdentityInput {
  sendingDomainId: string;
  emailAddress: string;
  displayName?: string;
  replyTo?: string;
  defaultFor?: EmailCategory[];
}

export const createSenderIdentity = (input: CreateIdentityInput) =>
  apiPost<SenderIdentity>("/email-sender-identities", input);

export interface UpdateIdentityInput {
  displayName?: string;
  replyTo?: string;
  status?: "ACTIVE" | "ARCHIVED";
  defaultFor?: EmailCategory[];
}

export const updateSenderIdentity = (id: string, input: UpdateIdentityInput) =>
  apiPatch<SenderIdentity>(`/email-sender-identities/${id}`, input);

export const deleteSenderIdentity = (id: string) =>
  apiDelete<{ id: string }>(`/email-sender-identities/${id}`);

// ---- Reputation (sending health) ----
export type SendingStatus = "ACTIVE" | "WARNING" | "THROTTLED" | "PAUSED";

export interface ReputationRates {
  sends: number;
  bounces: number;
  complaints: number;
  bounceRate: number;
  complaintRate: number;
}

export interface ReputationEvent {
  id: string;
  from_status: string;
  to_status: string;
  trigger: string;
  reason: string | null;
  created_at: string;
}

export interface EmailReputation {
  status: SendingStatus;
  statusChangedAt: string | null;
  /** null when Redis (the metrics store) is not configured. */
  rates: ReputationRates | null;
  events: ReputationEvent[];
}

export const getEmailReputation = () => apiGet<EmailReputation>("/email-reputation");

// ---- Message log + suppressions ----
export const listEmailSendMessages = () => apiGet<EmailMessage[]>("/email-messages");

export const listSuppressions = () => apiGet<Suppression[]>("/email-suppressions");

export const addSuppression = (email: string, category?: EmailCategory) =>
  apiPost<{ email: string }>("/email-suppressions", { email, category });

export const removeSuppression = (id: string) =>
  apiDelete<{ id: string }>(`/email-suppressions/${id}`);
