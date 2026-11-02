import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./client";

export type MeetingMode = "ONLINE" | "OFFLINE";
export type MeetingStatus = "SCHEDULED" | "CANCELLED" | "COMPLETED";

export interface CalendarProvider {
  key: string;
  name: string;
  connected: boolean;
  note: string;
  // Present for Google: the connected account email, and whether the
  // integration is configured on the server (creds present).
  email?: string | null;
  available?: boolean;
}

export interface GoogleCalendarStatus {
  connected: boolean;
  email: string | null;
  status: string | null;
  available: boolean;
}

export interface Meeting {
  id: string;
  tenant_id: string;
  title: string;
  lead_id: string | null;
  contact_id: string | null;
  owner_id: string | null;
  start_at: string;
  duration_min: number;
  mode: MeetingMode;
  location: string | null;
  status: MeetingStatus;
  reminder_at: string | null;
  booking_link_id: string | null;
  // Set when the meeting is mirrored to an external calendar (e.g. "GOOGLE").
  external_provider: string | null;
  external_event_id: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /calendar/meetings joins in the lead/contact name as with_name. */
export interface MeetingWithName extends Meeting {
  with_name: string | null;
}

/**
 * Outcome of mirroring the new meeting to the owner's Google Calendar, returned
 * by POST /calendar/meetings so the UI can report what actually happened:
 *   MEET_CREATED , real Google Meet link created + calendar blocked
 *   EVENT_CREATED, calendar event created, but no Meet link (offline meeting)
 *   NOT_CONNECTED, owner hasn't connected Google → fell back to a Jitsi link
 *   DISABLED     , integration off on the server → Jitsi link
 *   FAILED       , owner connected but the Google call failed → Jitsi fallback
 */
export type GoogleSyncStatus =
  | "MEET_CREATED"
  | "EVENT_CREATED"
  | "NOT_CONNECTED"
  | "DISABLED"
  | "FAILED";

/** The just-scheduled meeting, plus how the Google Calendar sync went. */
export interface ScheduledMeeting extends Meeting {
  googleSync?: GoogleSyncStatus;
}

export interface BookingLink {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  duration_min: number;
  owner_id: string | null;
  bookings: number;
  url: string;
  created_at: string;
  updated_at: string;
}

export const listProviders = () => apiGet<CalendarProvider[]>("/calendar/providers");

// Google Calendar OAuth (per-user).
export const getGoogleCalendarStatus = () =>
  apiGet<GoogleCalendarStatus>("/calendar/google/status");
export const connectGoogleCalendar = () =>
  apiPost<{ url: string }>("/calendar/google/connect");
export const disconnectGoogleCalendar = () =>
  apiDelete<{ ok: boolean }>("/calendar/google/connection");

export const listMeetings = (params?: { owner?: string }) =>
  apiGet<MeetingWithName[]>("/calendar/meetings", { params });

export const scheduleMeeting = (body: {
  title: string;
  start_at: string;
  duration_min?: number;
  mode?: MeetingMode;
  location?: string;
  lead_id?: string;
  contact_id?: string;
  force?: boolean;
}) => apiPost<ScheduledMeeting>("/calendar/meetings", body);

/** Retroactively create the Google Calendar event + Meet link for a meeting
 *  that was scheduled before the owner connected Google. */
export const resyncMeeting = (id: string) =>
  apiPost<ScheduledMeeting>(`/calendar/meetings/${id}/sync`);

export const cancelMeeting = (id: string) =>
  apiPost<Meeting>(`/calendar/meetings/${id}/cancel`);

export const deleteMeeting = (id: string) =>
  apiDelete<{ ok: boolean }>(`/calendar/meetings/${id}`);

// Working hours used by manual scheduling AND the AI agent.
export interface WorkingHours {
  timezone: string;
  days: number[]; // 0=Sun … 6=Sat
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}
export const getWorkingHours = () => apiGet<WorkingHours>("/calendar/working-hours");
export const updateWorkingHours = (body: WorkingHours) =>
  apiPut<WorkingHours>("/calendar/working-hours", body);

export const listReminders = () => apiGet<Meeting[]>("/calendar/reminders");

export const listBookingLinks = () => apiGet<BookingLink[]>("/calendar/booking-links");

export interface CreatedBookingLink extends BookingLink {
  // Present when the link targeted a lead/contact: whether the invite email sent.
  invited?: { emailed: boolean; reason?: string };
}
export const createBookingLink = (body: {
  name: string;
  duration_min: number;
  lead_id?: string;
  contact_id?: string;
}) => apiPost<CreatedBookingLink>("/calendar/booking-links", body);

// ---- Single per-agent booking link ("my link") ----

/** The current agent's one reusable booking link (with public URL), created
 *  once and shared with any number of leads/contacts. `alreadyExisted` is set
 *  when a create call returned the existing link instead of making a new one. */
export interface MyBookingLink extends BookingLink {
  alreadyExisted?: boolean;
}

/** GET returns null until the agent creates their link. */
export const getMyBookingLink = () =>
  apiGet<MyBookingLink | null>("/calendar/booking-links/mine");

export const createMyBookingLink = (body: { name?: string; duration_min?: number }) =>
  apiPost<MyBookingLink>("/calendar/booking-links/mine", body);

export const updateMyBookingLink = (body: { name?: string; duration_min?: number }) =>
  apiPatch<MyBookingLink>("/calendar/booking-links/mine", body);

export interface ShareResult {
  sent: number;
  total: number;
  results: Array<{
    type: "lead" | "contact";
    id: string;
    emailed: boolean;
    reason?: string;
  }>;
}

/** Email/WhatsApp the agent's link to the selected leads/contacts at once. */
export const shareMyBookingLink = (body: {
  leadIds?: string[];
  contactIds?: string[];
}) => apiPost<ShareResult>("/calendar/booking-links/mine/share", body);
