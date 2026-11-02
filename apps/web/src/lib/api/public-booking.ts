import { apiGet, apiPost } from "./client";

// Public (unauthenticated) self-service booking API. These endpoints ignore any
// auth token, so the shared client is fine, no /login redirect can fire because
// the public routes never return 401.

export interface BookingDaySlots {
  date: string; // local YYYY-MM-DD
  slots: string[]; // ISO UTC start times
}

export interface PublicBookingInfo {
  tenant: { name: string; brand_color: string };
  link: { name: string; slug: string; duration_min: number };
  host: string | null;
  timezone: string;
  days: BookingDaySlots[];
  // Present when the link targets a specific lead/contact, prefills the form.
  prefill: { name: string; email: string } | null;
}

export interface PublicBookingResult {
  ok: boolean;
  start_at: string;
  duration_min: number;
  host: string | null;
  tenant: string;
}

export const getPublicBooking = (tenantSlug: string, linkSlug: string) =>
  apiGet<PublicBookingInfo>(
    `/public/booking/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(linkSlug)}`
  );

export const submitPublicBooking = (
  tenantSlug: string,
  linkSlug: string,
  body: { name: string; email: string; startAt: string }
) =>
  apiPost<PublicBookingResult>(
    `/public/booking/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(linkSlug)}`,
    body
  );
