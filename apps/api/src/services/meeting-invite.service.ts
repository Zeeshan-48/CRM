// Turns a scheduled meeting into a REAL, useful artifact: a working video link
// (Jitsi, no OAuth needed), an "add to calendar" link, a branded email invite
// to the lead/contact (real SES delivery when keyed, else simulated), and a
// REAL WhatsApp message via the Meta Cloud API. Best-effort: a missing email/
// phone or a send failure never blocks the meeting from being scheduled.

import { ulid } from "ulid";
import emailRepository from "../repositories/email.repository";
import usersRepository from "../repositories/users.repository";
import emailService from "./email.service";
import schedulingService from "./scheduling.service";
import whatsappService from "./whatsapp.service";
import logger from "../utils/logger";

/** A real, immediately-usable video room URL. Jitsi rooms exist on first join,
 *  so no API call / account is required. The random suffix keeps rooms private
 *  and collision-free. */
export const buildMeetingUrl = (title: string): string => {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "")
      .slice(0, 32) || "meeting";
  const rand = ulid().toLowerCase().slice(-10);
  return `https://meet.jit.si/crm-${slug}-${rand}`;
};

interface InviteMeeting {
  id: string;
  title: string;
  start_at: Date;
  duration_min: number;
  mode: string;
  location: string | null;
  lead_id: string | null;
  contact_id: string | null;
  owner_id?: string | null;
  // "GOOGLE" once mirrored to Google Calendar, which means the attendee already
  // received Google's native invite email, so we skip our branded email for it.
  external_provider?: string | null;
}

const firstNameOf = (name?: string | null): string => {
  const first = String(name ?? "").trim().split(/\s+/)[0];
  return first || "there";
};

// Resolve display names for the email: the meeting host (owner, else the acting
// user) and the invitee (linked lead/contact), plus the tenant name for the
// signature. All best-effort, missing names degrade to sensible fallbacks.
const resolveParties = async (
  tenantId: string,
  actorId: string | null,
  meeting: InviteMeeting
): Promise<{ hostName: string; inviteeName: string; tenantName: string }> => {
  const [hostUser, tenant, invitee] = await Promise.all([
    meeting.owner_id
      ? usersRepository.findById(meeting.owner_id, tenantId)
      : actorId
        ? usersRepository.findById(actorId, tenantId)
        : Promise.resolve(undefined),
    emailRepository.tenantBrand(tenantId),
    meeting.lead_id
      ? emailRepository.leadRecipient(tenantId, meeting.lead_id)
      : meeting.contact_id
        ? emailRepository.contactRecipient(tenantId, meeting.contact_id)
        : Promise.resolve(undefined),
  ]);
  const tenantName = tenant?.name?.trim() || "The team";
  return {
    hostName: hostUser?.name?.trim() || tenantName,
    inviteeName: firstNameOf(invitee?.name),
    tenantName,
  };
};

// YYYYMMDDTHHMMSSZ (UTC) for the Google Calendar template link.
const gcalStamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const addToCalendarUrl = (m: InviteMeeting, details: string): string => {
  const end = new Date(m.start_at.getTime() + m.duration_min * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: m.title,
    dates: `${gcalStamp(m.start_at)}/${gcalStamp(end)}`,
    details,
    location: m.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

// Real WhatsApp via the Meta Cloud API (whatsappService.send). NOTE: a free-text
// message only delivers inside the 24h customer-service window; outside it, Meta
// rejects it (surfaced in `delivered`/`error`) and an approved template would be
// needed. Best-effort, never throws to the caller.
const sendWhatsApp = async (
  tenantId: string,
  actorId: string | null,
  meeting: InviteMeeting,
  text: string
): Promise<void> => {
  try {
    const r = await whatsappService.send(tenantId, actorId ?? "", {
      leadId: meeting.lead_id ?? undefined,
      contactId: meeting.contact_id ?? undefined,
      body: text,
    });
    if (!r.delivered) {
      logger.warn(
        `meeting WhatsApp not delivered for ${meeting.id}: ${r.error ?? "no WhatsApp number / outside 24h window / not configured"}`
      );
    }
  } catch (err) {
    logger.warn(`meeting WhatsApp skipped for ${meeting.id}: ${err}`);
  }
};

/** Real email invite (SES when keyed) + real WhatsApp message. No-op when the
 *  meeting isn't linked to a lead/contact (we'd have no recipient). */
export const sendMeetingInvite = async (params: {
  tenantId: string;
  actorId: string | null;
  meeting: InviteMeeting;
}): Promise<void> => {
  const { tenantId, actorId, meeting } = params;
  if (!meeting.lead_id && !meeting.contact_id) return;

  const wh = await schedulingService.getWorkingHours(tenantId);
  const when = `${schedulingService.formatLocal(meeting.start_at, wh.timezone)} (${wh.timezone})`;
  const { hostName, inviteeName, tenantName } = await resolveParties(tenantId, actorId, meeting);

  const locationLabel = meeting.mode === "ONLINE" ? "Join link" : "Location";
  const detailsLine = meeting.mode === "ONLINE" ? `Join: ${meeting.location ?? ""}` : meeting.location ?? "";
  const addToCal = addToCalendarUrl(meeting, detailsLine);

  // Plain-text body; the mailer wraps it in a branded HTML shell (paragraphs are
  // split on blank lines, single newlines become line breaks). Keep the details
  // as one block (single newlines) so they render as a tidy list.
  const body = [
    `Hi ${inviteeName},`,
    "",
    `Your meeting with ${hostName} is confirmed. Here are the details:`,
    "",
    [
      `Event: ${meeting.title}`,
      `When: ${when}`,
      `Duration: ${meeting.duration_min} minutes`,
      `Host: ${hostName}`,
      `${locationLabel}: ${meeting.location ?? "To be shared"}`,
    ].join("\n"),
    "",
    `Add this meeting to your calendar:`,
    addToCal,
    "",
    "Looking forward to speaking with you.",
    "",
    ["Warm regards,", hostName, tenantName].join("\n"),
  ].join("\n");

  // Real email invite, emailService resolves the recipient address itself and
  // throws if there's none, so we keep it best-effort. Skipped when the meeting
  // was mirrored to Google Calendar: Google already emailed the attendee its
  // native invite (sendUpdates=all), so sending our branded copy too would
  // double-email the lead. WhatsApp (below) is unaffected, Google can't do that.
  const googleAlreadyEmailed = meeting.external_provider === "GOOGLE";
  if (!googleAlreadyEmailed) {
    try {
      await emailService.send(tenantId, actorId ?? "system", {
        leadId: meeting.lead_id ?? undefined,
        contactId: meeting.contact_id ?? undefined,
        subject: `Meeting confirmed: ${meeting.title}`,
        body,
      });
    } catch (err) {
      logger.warn(`meeting invite email skipped for ${meeting.id}: ${err}`);
    }
  }

  const whereShort =
    meeting.mode === "ONLINE"
      ? `Join here: ${meeting.location ?? ""}`
      : `Location: ${meeting.location ?? ""}`;
  await sendWhatsApp(
    tenantId,
    actorId,
    meeting,
    `Hi ${inviteeName}, your meeting "${meeting.title}" with ${hostName} is confirmed for ${when}. ${whereShort}`
  );
};

/** A reminder ahead of the meeting (email + WhatsApp). Sent by the reminder job;
 *  the meeting's owner is the sender. No-op without a lead/contact. */
export const sendMeetingReminder = async (params: {
  tenantId: string;
  actorId: string | null;
  meeting: InviteMeeting;
}): Promise<void> => {
  const { tenantId, actorId, meeting } = params;
  if (!meeting.lead_id && !meeting.contact_id) return;

  const wh = await schedulingService.getWorkingHours(tenantId);
  const when = `${schedulingService.formatLocal(meeting.start_at, wh.timezone)} (${wh.timezone})`;
  const { hostName, inviteeName, tenantName } = await resolveParties(tenantId, actorId, meeting);
  const locationLabel = meeting.mode === "ONLINE" ? "Join link" : "Location";

  const body = [
    `Hi ${inviteeName},`,
    "",
    `A quick reminder about your upcoming meeting with ${hostName}:`,
    "",
    [
      `Event: ${meeting.title}`,
      `When: ${when}`,
      `Duration: ${meeting.duration_min} minutes`,
      `Host: ${hostName}`,
      `${locationLabel}: ${meeting.location ?? "To be shared"}`,
    ].join("\n"),
    "",
    "See you soon.",
    "",
    ["Warm regards,", hostName, tenantName].join("\n"),
  ].join("\n");

  try {
    await emailService.send(tenantId, actorId ?? "system", {
      leadId: meeting.lead_id ?? undefined,
      contactId: meeting.contact_id ?? undefined,
      subject: `Reminder: ${meeting.title}`,
      body,
    });
  } catch (err) {
    logger.warn(`meeting reminder email skipped for ${meeting.id}: ${err}`);
  }

  const whereShort =
    meeting.mode === "ONLINE"
      ? `Join here: ${meeting.location ?? ""}`
      : `Location: ${meeting.location ?? ""}`;
  await sendWhatsApp(
    tenantId,
    actorId,
    meeting,
    `Hi ${inviteeName}, a reminder that your meeting "${meeting.title}" with ${hostName} is at ${when}. ${whereShort}`
  );
};

/** Email (+ WhatsApp) a specific lead/contact a personalised booking link so they
 *  can self-schedule a time. Sent when a booking link is created for a targeted
 *  lead/contact. Returns whether the email actually went out (false if the record
 *  has no email on file). Best-effort, never throws. */
export const sendBookingLinkInvite = async (params: {
  tenantId: string;
  actorId: string | null;
  leadId?: string | null;
  contactId?: string | null;
  linkName: string;
  durationMin: number;
  url: string;
}): Promise<{ emailed: boolean; reason?: string }> => {
  const { tenantId, actorId, leadId, contactId, linkName, durationMin, url } = params;
  if (!leadId && !contactId) return { emailed: false, reason: "no recipient linked" };

  const [hostUser, tenant, recipient] = await Promise.all([
    actorId ? usersRepository.findById(actorId, tenantId) : Promise.resolve(undefined),
    emailRepository.tenantBrand(tenantId),
    leadId
      ? emailRepository.leadRecipient(tenantId, leadId)
      : contactId
        ? emailRepository.contactRecipient(tenantId, contactId)
        : Promise.resolve(undefined),
  ]);
  const tenantName = tenant?.name?.trim() || "The team";
  const hostName = hostUser?.name?.trim() || tenantName;
  const inviteeName = firstNameOf(recipient?.name);

  if (!recipient?.email) {
    return { emailed: false, reason: "recipient has no email on file" };
  }

  const body = [
    `Hi ${inviteeName},`,
    "",
    `${hostName} would like to schedule a ${durationMin}-minute meeting (${linkName}) with you. Please pick whatever time works best:`,
    "",
    url,
    "",
    "As soon as you choose a time you'll get a calendar invite with the video link.",
    "",
    ["Warm regards,", hostName, tenantName].join("\n"),
  ].join("\n");

  try {
    await emailService.send(tenantId, actorId ?? "system", {
      leadId: leadId ?? undefined,
      contactId: contactId ?? undefined,
      subject: `${hostName} invited you to book a meeting`,
      body,
    });
  } catch (err) {
    logger.warn(`booking link invite email skipped: ${err}`);
    return { emailed: false, reason: String(err) };
  }

  // Best-effort WhatsApp nudge with the same link.
  try {
    await whatsappService.send(tenantId, actorId ?? "", {
      leadId: leadId ?? undefined,
      contactId: contactId ?? undefined,
      body: `Hi ${inviteeName}, ${hostName} would like to meet. Pick a time: ${url}`,
    });
  } catch (err) {
    logger.warn(`booking link invite WhatsApp skipped: ${err}`);
  }

  return { emailed: true };
};
