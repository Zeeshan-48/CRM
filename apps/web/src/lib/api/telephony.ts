// Telephony click-to-call: Twilio (the platform default account or tenant BYO)
// or Exotel (tenant BYO only). Mirrors the email-domains API shape.

import { apiDelete, apiGet, apiPost, apiPut } from "./client";

export type TelephonyStatus = "PENDING" | "ACTIVE" | "DISABLED";
export type TelephonyProvider = "TWILIO" | "EXOTEL";

export interface TelephonyConfig {
  configured: boolean;
  status: TelephonyStatus;
  provider: TelephonyProvider;
  account_sid: string | null;
  from_number: string | null;
  /** Whether an auth token is stored (the token itself is never returned). */
  auth_token_set: boolean;
  /** Optional masked hint (for example the last 4 characters) of the stored token. */
  auth_token_hint?: string | null;
  /** Exotel only: whether an API key is stored. */
  api_key_set: boolean;
  /** Optional masked hint of the stored Exotel API key. */
  api_key_hint?: string | null;
  /** Exotel API subdomain (api.in.exotel.com for Indian accounts). */
  subdomain: string | null;
  /** Path token for the public Exotel webhook URLs the admin pastes into their flow. */
  webhook_token: string | null;
  verified_at: string | null;
  last_error: string | null;
  defaultAvailable: boolean;
  defaultFrom: string | null;
  simulated: boolean;
  exotelSimulated: boolean;
}

/**
 * Secrets are write-only: the API never returns them. On update, a blank or
 * omitted field keeps the stored value (same provider only).
 */
export interface SaveTelephonyInput {
  provider?: TelephonyProvider;
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  apiKey?: string;
  subdomain?: string;
}

export interface PhoneCall {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  agent_user_id?: string | null;
  direction?: "INBOUND" | "OUTBOUND";
  provider?: string;
  outcome?: string | null;
  summary?: string | null;
  recording_url?: string | null;
  from_number: string | null;
  to_number: string | null;
  call_status: string | null;
  duration_sec: number;
  // Populated by the poller when a call fails: the recipient-leg reason and,
  // when available, the Twilio Debugger error code.
  call_error: string | null;
  twilio_call_sid: string | null;
  external_call_id?: string | null;
  created_at: string;
  mode?: "tenant" | "default";
  simulated?: boolean;
}

export interface PlaceCallInput {
  leadId?: string;
  contactId?: string;
  /** Optional override; the backend uses the caller's saved profile phone when omitted. */
  agentPhone?: string;
}

export interface TelephonyNumber {
  id: string;
  phone: string;
  label: string | null;
  kind: "MAIN" | "AGENT";
  assigned_user_id: string | null;
  active: boolean;
  created_at: string;
}

export interface LogManualCallInput {
  leadId?: string;
  contactId?: string;
  durationSec?: number;
  outcome?: string;
  notes?: string;
}

/** Outcomes an agent can pick when logging a personal-SIM call. */
export const MANUAL_CALL_OUTCOMES = [
  "CONNECTED",
  "NOT_ANSWERED",
  "CALLBACK_REQUESTED",
  "NOT_INTERESTED",
  "QUALIFIED",
] as const;

export const getTelephony = () => apiGet<TelephonyConfig>("/telephony");
export const saveTelephony = (input: SaveTelephonyInput) =>
  apiPut<TelephonyConfig>("/telephony", input);
export const validateTelephony = () => apiPost<TelephonyConfig>("/telephony/validate");
export const removeTelephony = () => apiDelete<{ ok: boolean }>("/telephony");

export const placeCall = (input: PlaceCallInput) => apiPost<PhoneCall>("/telephony/call", input);
export const listCalls = () => apiGet<PhoneCall[]>("/telephony/calls");

/** Log a call the agent dialed from their personal SIM (no recording exists). */
export const logManualCall = (input: LogManualCallInput) =>
  apiPost<PhoneCall>("/telephony/calls/manual", input);

/** Short-lived playable URL for a recording; pending while the mirror runs. */
export const getRecordingUrl = (callId: string) =>
  apiGet<{ url: string | null; pending: boolean }>(`/telephony/calls/${callId}/recording`);

// ---- ExoPhone pool ----

export const listNumbers = () => apiGet<TelephonyNumber[]>("/telephony/numbers");
export const addNumber = (input: {
  phone: string;
  label?: string;
  kind: "MAIN" | "AGENT";
  assignedUserId?: string;
}) => apiPost<TelephonyNumber>("/telephony/numbers", input);
export const updateNumber = (
  id: string,
  patch: { label?: string; kind?: "MAIN" | "AGENT"; assignedUserId?: string | null; active?: boolean }
) => apiPut<TelephonyNumber>(`/telephony/numbers/${id}`, patch);
export const removeNumber = (id: string) => apiDelete<{ ok: boolean }>(`/telephony/numbers/${id}`);

/** Self-service agent presence: inbound routing skips unavailable agents. */
export const setCallAvailability = (available: boolean) =>
  apiPost<{ available_for_calls: boolean }>("/telephony/availability", { available });
