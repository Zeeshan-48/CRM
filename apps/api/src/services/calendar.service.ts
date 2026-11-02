import { ulid } from "ulid";
import config from "../config";
import { meeting_mode } from "../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { assertCanManageRecord } from "../utils/record-policy";
import activitiesRepository from "../repositories/activities.repository";
import calendarConnectionsRepository from "../repositories/calendar-connections.repository";
import calendarRepository, { BookingLinkRow, MeetingRow } from "../repositories/calendar.repository";
import emailRepository from "../repositories/email.repository";
import leadsRepository from "../repositories/leads.repository";
import tenantsRepository from "../repositories/tenants.repository";
import usersRepository from "../repositories/users.repository";
import engineService from "./engine.service";
import googleCalendarService from "./google-calendar.service";
import { buildMeetingUrl, sendBookingLinkInvite, sendMeetingInvite } from "./meeting-invite.service";
import schedulingService from "./scheduling.service";
import scoringService from "./scoring.service";
import logger from "../utils/logger";

const MEETING_MODES = Object.values(meeting_mode);
const REMINDER_WINDOW_DAYS = 7;

// Outcome of mirroring a meeting to the owner's Google Calendar. Returned to the
// UI so it can tell the user whether a real Meet link + calendar block happened,
// instead of silently handing back a Jitsi fallback.
//   MEET_CREATED, Google event created AND a real Meet link is on the meeting
//   EVENT_CREATED, Google event created, but no Meet link (offline meeting, or
//                    Google returned no conference URL)
//   NOT_CONNECTED, integration is on, but the owner hasn't connected Google
//   DISABLED, integration is off on the server (falls back to Jitsi)
//   FAILED, owner is connected but the Google call failed (kept fallback)
export type GoogleSyncStatus =
  | "MEET_CREATED"
  | "EVENT_CREATED"
  | "NOT_CONNECTED"
  | "DISABLED"
  | "FAILED";

const parseDate = (value: unknown, field: string): Date => {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${field} must be a valid date`);
  return date;
};

const daysAhead = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

// A short, NON-identifying public slug (e.g. "k7f3a9x2mq"). Deliberately not
// derived from the link/agent name so the public URL never leaks who the host
// is. Randomness comes from the tail of a ULID; collisions are re-rolled.
const randomSlug = (): string => ulid().toLowerCase().slice(-10);

// A real, working public booking URL into the tenant SPA:
//   {CRM_APP_URL}/meet/{tenantSlug}/{linkSlug}
// (CRM_APP_URL is the customer-facing web host, the app's own frontend base.)
const withUrl = (link: BookingLinkRow, tenantSlug: string) => ({
  ...link,
  url: `${config.CRM_APP_URL}/meet/${tenantSlug}/${link.slug}`,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Postgres unique-violation (SQLSTATE 23505). Raised by the partial unique index
// on scheduled meetings when two bookers grab the same host slot at once, the
// DB-level backstop behind the availability check, closing its read-then-write
// race. Narrowed structurally so we don't depend on the pg driver's types.
const isUniqueViolation = (err: unknown): boolean =>
  !!err && typeof err === "object" && (err as { code?: string }).code === "23505";

class CalendarService {
  // Provider cards for the calendar page. Google is the only supported provider
  // and reflects the REAL per-user connection when the integration is enabled.
  async providers(tenantId: string, userId: string) {
    const googleEnabled = googleCalendarService.isEnabled();
    const google = googleEnabled
      ? await googleCalendarService.status(tenantId, userId)
      : { connected: false, email: null, status: null };
    return [
      {
        key: "google",
        name: "Google Calendar",
        connected: google.connected,
        email: google.email,
        available: googleEnabled,
        note: googleEnabled ? "Sync meetings & availability" : "Not configured",
      },
    ];
  }

  async meetings(tenantId: string, params: { owner?: string } = {}) {
    return calendarRepository.listMeetings(tenantId, params);
  }

  // Same as pushMeetingToGoogle, but also reports WHAT happened so callers (the
  // schedule flow) can tell the user. Never throws, any failure degrades to the
  // Jitsi fallback the meeting was created with. See GoogleSyncStatus.
  async syncMeetingToGoogle(
    tenantId: string,
    meeting: MeetingRow
  ): Promise<{ meeting: MeetingRow; status: GoogleSyncStatus }> {
    if (!googleCalendarService.isEnabled() || !meeting.owner_id) {
      return { meeting, status: "DISABLED" };
    }

    let conn;
    try {
      conn = await calendarConnectionsRepository.find(tenantId, meeting.owner_id);
    } catch (err) {
      logger.warn(`Google Calendar lookup failed for meeting ${meeting.id}: ${err}`);
      return { meeting, status: "FAILED" };
    }
    if (!conn || conn.status !== "CONNECTED" || !conn.sync_enabled) {
      return { meeting, status: "NOT_CONNECTED" };
    }

    try {
      let attendeeEmail: string | null = null;
      if (meeting.lead_id) {
        attendeeEmail = (await emailRepository.leadRecipient(tenantId, meeting.lead_id))?.email ?? null;
      } else if (meeting.contact_id) {
        attendeeEmail =
          (await emailRepository.contactRecipient(tenantId, meeting.contact_id))?.email ?? null;
      }

      const wh = await schedulingService.getWorkingHours(tenantId);
      const online = meeting.mode === "ONLINE";
      const result = await googleCalendarService.createEvent(conn, {
        title: meeting.title,
        startAt: new Date(meeting.start_at),
        durationMin: meeting.duration_min,
        timezone: wh.timezone,
        online,
        attendeeEmail,
      });

      const newLocation = online && result.meetUrl ? result.meetUrl : null;
      await calendarRepository.setExternalEvent(meeting.id, tenantId, {
        provider: "GOOGLE",
        eventId: result.eventId,
        location: newLocation,
      });
      return {
        meeting: {
          ...meeting,
          external_provider: "GOOGLE",
          external_event_id: result.eventId,
          location: newLocation ?? meeting.location,
        },
        // ONLINE meetings should carry a Meet link; if Google returned none, it's
        // still a real calendar block, just without a video URL.
        status: newLocation ? "MEET_CREATED" : "EVENT_CREATED",
      };
    } catch (err) {
      // Surface to the caller (→ UI toast) but never mark the connection ERROR
      // here: a transient createEvent failure shouldn't disable a healthy
      // connection. Genuine auth death is caught + flagged in getValidAccessToken.
      logger.warn(`Google Calendar push failed for meeting ${meeting.id}: ${err}`);
      return { meeting, status: "FAILED" };
    }
  }

  // Mirror a CRM meeting onto its owner's connected Google Calendar (best-effort).
  // No-op unless the feature is enabled AND the owner has an active connection,
  // in which case behavior is exactly the CRM-native path. For ONLINE meetings a
  // real Google Meet link replaces the Jitsi fallback. Returns the meeting with
  // any external ids / Meet link applied so the invite + response reflect them.
  //
  // Public so any path that books a meeting outside schedule() produces the same
  // Google Meet link. Call it BEFORE sending the invite, so the email carries the
  // Meet URL rather than the Jitsi fallback it was created with.
  async pushMeetingToGoogle(tenantId: string, meeting: MeetingRow): Promise<MeetingRow> {
    return (await this.syncMeetingToGoogle(tenantId, meeting)).meeting;
  }

  // Remove the mirrored Google event when a CRM meeting is cancelled/deleted.
  // Best-effort + idempotent (delete tolerates an already-gone event).
  private async removeMeetingFromGoogle(tenantId: string, meeting: MeetingRow): Promise<void> {
    if (meeting.external_provider !== "GOOGLE" || !meeting.external_event_id) return;
    if (!googleCalendarService.isEnabled() || !meeting.owner_id) return;
    try {
      const conn = await calendarConnectionsRepository.find(tenantId, meeting.owner_id);
      if (!conn) return;
      await googleCalendarService.deleteEvent(conn, meeting.external_event_id);
    } catch (err) {
      logger.warn(`Google Calendar delete skipped for meeting ${meeting.id}: ${err}`);
    }
  }

  async schedule(
    tenantId: string,
    actorId: string,
    body: {
      title?: string;
      start_at?: string;
      duration_min?: number;
      mode?: string;
      location?: string;
      reminder_at?: string;
      lead_id?: string;
      contact_id?: string;
      owner_id?: string;
      booking_link_id?: string;
      force?: boolean;
    }
  ) {
    if (!body.title) throw new BadRequestError("title is required");
    if (!body.start_at) throw new BadRequestError("start_at is required");
    const startAt = parseDate(body.start_at, "start_at");

    let mode: meeting_mode = "ONLINE";
    if (body.mode !== undefined) {
      if (!(MEETING_MODES as readonly string[]).includes(body.mode)) {
        throw new BadRequestError(`mode must be one of ${MEETING_MODES.join(", ")}`);
      }
      mode = body.mode as meeting_mode;
    }

    const durationMin =
      body.duration_min === undefined || body.duration_min === null
        ? 30
        : Number(body.duration_min);
    if (!Number.isInteger(durationMin) || durationMin <= 0) {
      throw new BadRequestError("duration_min must be a positive integer");
    }

    const reminderAt =
      body.reminder_at !== undefined && body.reminder_at !== null
        ? parseDate(body.reminder_at, "reminder_at")
        : startAt;

    // Working-hours + double-booking guardrail (same as the AI agent). `force`
    // lets a user deliberately override (e.g. an off-hours or back-to-back slot).
    const ownerId = body.owner_id ?? actorId;
    if (!body.force) {
      const avail = await schedulingService.checkAvailability(
        tenantId,
        ownerId,
        startAt,
        durationMin
      );
      if (!avail.ok) {
        throw new BadRequestError(`Can't schedule then, ${avail.reason}.`);
      }
    }

    // ONLINE meetings get a REAL, joinable video link (Jitsi, no OAuth) instead
    // of the old "Google Meet" placeholder string; respect an explicit location.
    const location =
      body.location || (mode === "OFFLINE" ? "Office" : buildMeetingUrl(body.title));

    let meeting: MeetingRow;
    try {
      meeting = await calendarRepository.createMeeting({
        tenant_id: tenantId,
        title: body.title,
        lead_id: body.lead_id ?? null,
        contact_id: body.contact_id ?? null,
        owner_id: body.owner_id ?? actorId,
        start_at: startAt,
        duration_min: durationMin,
        mode,
        location,
        reminder_at: reminderAt,
        booking_link_id: body.booking_link_id ?? null,
      });
    } catch (err) {
      // The slot-uniqueness index fired: someone booked this exact host slot
      // between the availability check above and the insert. Surface a friendly
      // 409 instead of a 500 so the booker just picks another time.
      if (isUniqueViolation(err)) {
        throw new ConflictError("That time was just taken. Please pick another slot.");
      }
      throw err;
    }

    if (meeting.lead_id) {
      await activitiesRepository.create({
        tenant_id: tenantId,
        type: "MEETING",
        subject: meeting.title,
        owner_id: actorId,
        lead_id: meeting.lead_id,
      });
      await leadsRepository.update(meeting.lead_id, tenantId, { last_activity_at: new Date() });
      scoringService.recomputeInBackground(tenantId, meeting.lead_id);
    }

    // Mirror to the owner's Google Calendar (best-effort). On success this swaps
    // the Jitsi link for a real Meet link, so the invite below carries it. The
    // status is returned to the UI so it can tell the user what actually happened.
    const sync = await this.syncMeetingToGoogle(tenantId, meeting);
    const synced = sync.meeting;

    // Send the invite (email + WhatsApp) when the meeting is linked to a
    // lead/contact. Best-effort, never blocks scheduling.
    await sendMeetingInvite({ tenantId, actorId, meeting: synced });

    engineService.audit(tenantId, actorId, "meeting.scheduled", "meeting", synced.id, {
      title: synced.title,
      googleSync: sync.status,
    });
    return { ...synced, googleSync: sync.status };
  }

  // Retroactively push an existing meeting to Google, for meetings scheduled
  // BEFORE the owner connected their calendar (so they got only a Jitsi link).
  // On success Google creates the event + Meet link and natively invites the
  // attendee, so no branded re-send is needed. Idempotent: refuses to duplicate
  // an already-synced event.
  async resync(tenantId: string, actorId: string, meetingId: string) {
    const meeting = await calendarRepository.findMeetingById(meetingId, tenantId);
    if (!meeting) throw new NotFoundError("Meeting not found");
    if (meeting.status === "CANCELLED") {
      throw new BadRequestError("This meeting is cancelled");
    }
    if (meeting.external_provider === "GOOGLE" && meeting.external_event_id) {
      throw new BadRequestError("This meeting is already on Google Calendar");
    }

    const sync = await this.syncMeetingToGoogle(tenantId, meeting);
    engineService.audit(tenantId, actorId, "meeting.resynced", "meeting", meetingId, {
      googleSync: sync.status,
    });
    return { ...sync.meeting, googleSync: sync.status };
  }

  async cancel(tenantId: string, actorId: string, meetingId: string) {
    const meeting = await calendarRepository.findMeetingById(meetingId, tenantId);
    if (!meeting) throw new NotFoundError("Meeting not found");

    const updated = await calendarRepository.cancelMeeting(meetingId, tenantId);
    if (!updated) throw new NotFoundError("Meeting not found");

    // Remove the mirrored Google event (best-effort).
    await this.removeMeetingFromGoogle(tenantId, meeting);

    engineService.audit(tenantId, actorId, "meeting.cancelled", "meeting", meetingId, {
      title: updated.title,
    });
    return updated;
  }

  async deleteMeeting(tenantId: string, actorId: string, actorRole: string, meetingId: string) {
    const meeting = await calendarRepository.findMeetingById(meetingId, tenantId);
    if (!meeting) throw new NotFoundError("Meeting not found");
    assertCanManageRecord(actorId, actorRole, meeting.owner_id, "delete", "meeting");
    // Remove the mirrored Google event first (best-effort), then delete locally.
    await this.removeMeetingFromGoogle(tenantId, meeting);
    await calendarRepository.deleteMeeting(meetingId, tenantId);
    engineService.audit(tenantId, actorId, "meeting.deleted", "meeting", meetingId, {
      title: meeting.title,
    });
    return { ok: true };
  }

  getWorkingHours(tenantId: string) {
    return schedulingService.getWorkingHours(tenantId);
  }

  async setWorkingHours(tenantId: string, actorId: string, body: Record<string, unknown>) {
    const wh = await schedulingService.setWorkingHours(tenantId, body);
    engineService.audit(tenantId, actorId, "calendar.working_hours_updated", "tenant", tenantId, {});
    return wh;
  }

  async reminders(tenantId: string) {
    const now = new Date();
    return calendarRepository.reminders(tenantId, now, daysAhead(REMINDER_WINDOW_DAYS));
  }

  async bookingLinks(tenantId: string) {
    const [links, tenant] = await Promise.all([
      calendarRepository.listBookingLinks(tenantId),
      tenantsRepository.findById(tenantId),
    ]);
    const slug = tenant?.slug ?? "";
    return links.map((l) => withUrl(l, slug));
  }

  async createBookingLink(
    tenantId: string,
    actorId: string,
    body: { name?: string; slug?: string; duration_min?: number; lead_id?: string; contact_id?: string }
  ) {
    if (!body.name) throw new BadRequestError("name is required");

    const durationMin =
      body.duration_min === undefined || body.duration_min === null
        ? 30
        : Number(body.duration_min);
    if (!Number.isInteger(durationMin) || durationMin <= 0) {
      throw new BadRequestError("duration_min must be a positive integer");
    }

    // Non-identifying random slug (re-roll on the rare collision).
    let slug = randomSlug();
    while (await calendarRepository.bookingLinkSlugExists(tenantId, slug)) {
      slug = randomSlug();
    }

    const link = await calendarRepository.createBookingLink({
      tenant_id: tenantId,
      name: body.name,
      slug,
      duration_min: durationMin,
      owner_id: actorId,
      lead_id: body.lead_id ?? null,
      contact_id: body.contact_id ?? null,
    });

    engineService.audit(tenantId, actorId, "booking_link.created", "booking_link", link.id, {
      slug,
    });
    const tenant = await tenantsRepository.findById(tenantId);
    const withUrlLink = withUrl(link, tenant?.slug ?? "");

    // Targeted link: email the lead/contact the URL so they can self-schedule.
    let invited: { emailed: boolean; reason?: string } | undefined;
    if (link.lead_id || link.contact_id) {
      invited = await sendBookingLinkInvite({
        tenantId,
        actorId,
        leadId: link.lead_id,
        contactId: link.contact_id,
        linkName: link.name,
        durationMin,
        url: withUrlLink.url,
      });
    }
    return { ...withUrlLink, invited };
  }

  // ---- Single per-agent booking link ("my link") ----
  //
  // The new model: each agent has ONE generic, reusable booking link they create
  // once and share with any number of leads/contacts. Double-booking is prevented
  // at the slot level (availableSlots hides a host's taken slots), so a single
  // link safely serves everyone. Legacy per-lead targeted links still work on the
  // public path; they're just no longer created from the UI.

  // The current agent's booking link (with public URL), or null if they haven't
  // created one yet.
  async getMyBookingLink(tenantId: string, actorId: string) {
    const [link, tenant] = await Promise.all([
      calendarRepository.findGenericBookingLinkByOwner(tenantId, actorId),
      tenantsRepository.findById(tenantId),
    ]);
    return link ? withUrl(link, tenant?.slug ?? "") : null;
  }

  // Create the agent's single booking link. Idempotent: if one already exists it
  // is returned untouched (flagged alreadyExisted) rather than creating a second
  // or erroring, a double-submit or a lost create-race must never 500.
  async createMyBookingLink(
    tenantId: string,
    actorId: string,
    body: { name?: string; duration_min?: number }
  ) {
    const tenant = await tenantsRepository.findById(tenantId);
    const slug = tenant?.slug ?? "";

    const existing = await calendarRepository.findGenericBookingLinkByOwner(tenantId, actorId);
    if (existing) return { ...withUrl(existing, slug), alreadyExisted: true };

    const durationMin =
      body.duration_min === undefined || body.duration_min === null
        ? 30
        : Number(body.duration_min);
    if (!Number.isInteger(durationMin) || durationMin <= 0) {
      throw new BadRequestError("duration_min must be a positive integer");
    }
    const name = String(body.name ?? "").trim() || "Book a meeting";

    // Non-identifying random slug (re-roll on the rare collision).
    let linkSlug = randomSlug();
    while (await calendarRepository.bookingLinkSlugExists(tenantId, linkSlug)) {
      linkSlug = randomSlug();
    }

    let link;
    try {
      link = await calendarRepository.createBookingLink({
        tenant_id: tenantId,
        name,
        slug: linkSlug,
        duration_min: durationMin,
        owner_id: actorId,
      });
    } catch (err) {
      // Lost the create race: the one-generic-link-per-owner unique index rejected
      // this second insert. Hand back the link that won instead of erroring.
      if (isUniqueViolation(err)) {
        const winner = await calendarRepository.findGenericBookingLinkByOwner(tenantId, actorId);
        if (winner) return { ...withUrl(winner, slug), alreadyExisted: true };
      }
      throw err;
    }

    engineService.audit(tenantId, actorId, "booking_link.created", "booking_link", link.id, {
      slug: linkSlug,
    });
    return withUrl(link, slug);
  }

  // Edit the agent's link (display name and/or meeting duration). The slug/URL is
  // immutable, so anything already shared keeps working.
  async updateMyBookingLink(
    tenantId: string,
    actorId: string,
    body: { name?: string; duration_min?: number }
  ) {
    const link = await calendarRepository.findGenericBookingLinkByOwner(tenantId, actorId);
    if (!link) throw new NotFoundError("You don't have a booking link yet");

    const patch: { name?: string; duration_min?: number } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestError("name can't be empty");
      patch.name = name;
    }
    if (body.duration_min !== undefined) {
      const d = Number(body.duration_min);
      if (!Number.isInteger(d) || d <= 0) {
        throw new BadRequestError("duration_min must be a positive integer");
      }
      patch.duration_min = d;
    }

    const updated = await calendarRepository.updateBookingLink(link.id, tenantId, patch);
    const tenant = await tenantsRepository.findById(tenantId);
    engineService.audit(tenantId, actorId, "booking_link.updated", "booking_link", link.id, {});
    return withUrl(updated ?? link, tenant?.slug ?? "");
  }

  // Email/WhatsApp the agent's single link to any number of leads/contacts at
  // once (better UX than one-off targeted links). Reuses sendBookingLinkInvite
  // per recipient; returns a per-recipient outcome so the UI can summarise.
  async shareMyBookingLink(
    tenantId: string,
    actorId: string,
    body: { leadIds?: string[]; contactIds?: string[] }
  ) {
    const link = await calendarRepository.findGenericBookingLinkByOwner(tenantId, actorId);
    if (!link) throw new NotFoundError("Create your booking link first");
    const tenant = await tenantsRepository.findById(tenantId);
    const url = withUrl(link, tenant?.slug ?? "").url;

    const clean = (arr?: string[]) => [
      ...new Set((arr ?? []).filter((s): s is string => typeof s === "string" && !!s)),
    ];
    const leadIds = clean(body.leadIds);
    const contactIds = clean(body.contactIds);
    if (!leadIds.length && !contactIds.length) {
      throw new BadRequestError("Select at least one lead or contact");
    }

    const results = await Promise.all([
      ...leadIds.map(async (id) => ({
        type: "lead" as const,
        id,
        ...(await sendBookingLinkInvite({
          tenantId,
          actorId,
          leadId: id,
          linkName: link.name,
          durationMin: link.duration_min,
          url,
        })),
      })),
      ...contactIds.map(async (id) => ({
        type: "contact" as const,
        id,
        ...(await sendBookingLinkInvite({
          tenantId,
          actorId,
          contactId: id,
          linkName: link.name,
          durationMin: link.duration_min,
          url,
        })),
      })),
    ]);

    const sent = results.filter((r) => r.emailed).length;
    engineService.audit(tenantId, actorId, "booking_link.shared", "booking_link", link.id, {
      recipients: results.length,
      sent,
    });
    return { sent, total: results.length, results };
  }

  // Internal (authenticated) booking against a link. Mirrors publicBook: resolve
  // the booker to a lead/contact, then delegate to schedule() so this path gets
  // the SAME Google Meet link + branded email/WhatsApp invite as every other one.
  // It used to hand-roll the meeting with a Jitsi URL and send nothing at all.
  async book(
    tenantId: string,
    actorId: string,
    slug: string,
    body: { name?: string; email?: string; startAt?: string }
  ) {
    const link = await calendarRepository.findBookingLinkBySlug(slug, tenantId);
    if (!link) throw new NotFoundError("Booking link not found");

    if (!body.name) throw new BadRequestError("name is required");
    if (!body.email) throw new BadRequestError("email is required");

    const name = String(body.name).trim();
    const email = String(body.email).trim();
    const startAt =
      body.startAt !== undefined && body.startAt !== null
        ? parseDate(body.startAt, "startAt")
        : daysAhead(2);

    // The invite can only be sent to a lead/contact (the mailer resolves the
    // address from the record), so the booker must be one. Targeted link → its
    // pre-selected record; generic link → find by email, else create the lead.
    let leadId: string | undefined;
    let contactId: string | undefined;
    if (link.lead_id || link.contact_id) {
      leadId = link.lead_id ?? undefined;
      contactId = link.contact_id ?? undefined;
    } else {
      const existing = await leadsRepository.findByEmail(tenantId, email);
      const lead =
        existing ??
        (await leadsRepository.create({
          tenant_id: tenantId,
          name,
          email,
          source: "BOOKING",
          owner_id: link.owner_id ?? actorId,
        }));
      leadId = lead.id;
    }

    // force: this endpoint has never enforced the working-hours/conflict
    // guardrail, and delegating to schedule() would silently start rejecting
    // bookings it used to accept. Availability stays the caller's problem here.
    const meeting = await this.schedule(tenantId, actorId, {
      title: `Discovery: ${name}`,
      start_at: startAt.toISOString(),
      duration_min: link.duration_min,
      mode: "ONLINE",
      lead_id: leadId,
      contact_id: contactId,
      owner_id: link.owner_id ?? actorId,
      booking_link_id: link.id,
      force: true,
    });
    await calendarRepository.incrementBookings(link.id, tenantId);

    if (link.owner_id) {
      engineService.notify(tenantId, link.owner_id, `New booking via ${link.name}: ${name}`);
    }
    engineService.audit(tenantId, actorId, "booking_link.booked", "booking_link", link.id, {
      slug: link.slug,
      name,
      email,
    });
    return { meeting, link: link.name };
  }

  // ---- PUBLIC booking page (no auth) ----

  // Resolve a `/book/:tenantSlug/:linkSlug` URL to the info a prospect needs:
  // branding, the host's name, the working timezone, and the open slots through
  // the end of next month. Only non-sensitive fields are returned.
  async publicBookingInfo(tenantSlug: string, linkSlug: string) {
    const tenant = await tenantsRepository.findActiveBySlug(tenantSlug);
    if (!tenant) throw new NotFoundError("Booking page not found");
    const link = await calendarRepository.findBookingLinkBySlug(linkSlug, tenant.id);
    if (!link) throw new NotFoundError("Booking page not found");

    // Offer availability across the rest of this month and all of next month, so
    // the public calendar can page from today through the end of next month.
    const now = new Date();
    const endOfNextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0, 23, 59, 59),
    );
    const horizonDays =
      Math.ceil((endOfNextMonth.getTime() - now.getTime()) / 86_400_000) + 2;

    const [host, wh, days, target] = await Promise.all([
      link.owner_id ? usersRepository.findById(link.owner_id, tenant.id) : Promise.resolve(undefined),
      schedulingService.getWorkingHours(tenant.id),
      schedulingService.availableSlots(tenant.id, link.owner_id, link.duration_min, new Date(), horizonDays),
      // Targeted link → prefill the form with the linked lead/contact's details.
      link.lead_id
        ? emailRepository.leadRecipient(tenant.id, link.lead_id)
        : link.contact_id
          ? emailRepository.contactRecipient(tenant.id, link.contact_id)
          : Promise.resolve(undefined),
    ]);

    return {
      tenant: { name: tenant.name, brand_color: tenant.brand_color },
      link: { name: link.name, slug: link.slug, duration_min: link.duration_min },
      host: host?.name ?? null,
      timezone: wh.timezone,
      days,
      // Present only for a targeted link; the public page pre-fills these.
      prefill: target ? { name: target.name ?? "", email: target.email ?? "" } : null,
    };
  }

  // Book a slot from the public page. Validates the request, ensures the slot is
  // still free (via schedule()'s guardrail), turns the booker into a lead (reused
  // if the email already exists), then delegates to schedule() so the meeting
  // gets the SAME Google push + branded email/WhatsApp invite as internal ones.
  async publicBook(
    tenantSlug: string,
    linkSlug: string,
    body: { name?: string; email?: string; startAt?: string }
  ) {
    const tenant = await tenantsRepository.findActiveBySlug(tenantSlug);
    if (!tenant) throw new NotFoundError("Booking page not found");
    const link = await calendarRepository.findBookingLinkBySlug(linkSlug, tenant.id);
    if (!link) throw new NotFoundError("Booking page not found");
    if (!link.owner_id) throw new BadRequestError("This booking link is not accepting bookings");

    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    if (!name) throw new BadRequestError("name is required");
    if (!EMAIL_RE.test(email)) throw new BadRequestError("A valid email is required");
    if (!body.startAt) throw new BadRequestError("startAt is required");
    const startAt = parseDate(body.startAt, "startAt");
    if (startAt.getTime() <= Date.now()) throw new BadRequestError("Pick a future time");

    // Pre-check availability before creating a lead, so a slot taken in the
    // meantime doesn't leave an orphan lead. schedule() re-checks authoritatively.
    const avail = await schedulingService.checkAvailability(
      tenant.id,
      link.owner_id,
      startAt,
      link.duration_min
    );
    if (!avail.ok) throw new BadRequestError(`That time isn't available, ${avail.reason}.`);

    // Who the meeting links to:
    //  - targeted link → the pre-selected lead/contact (no new record created);
    //  - generic link  → find an existing lead by email, else create one.
    let leadId: string | undefined;
    let contactId: string | undefined;
    if (link.lead_id || link.contact_id) {
      leadId = link.lead_id ?? undefined;
      contactId = link.contact_id ?? undefined;
    } else {
      const existing = await leadsRepository.findByEmail(tenant.id, email);
      const lead =
        existing ??
        (await leadsRepository.create({
          tenant_id: tenant.id,
          name,
          email,
          source: "BOOKING",
          owner_id: link.owner_id,
        }));
      leadId = lead.id;
    }

    // Delegate: schedule() re-checks availability (throws if the slot was taken
    // in the meantime), creates the meeting, pushes to Google, and sends the
    // branded invite with the Meet link. The host is the actor/owner.
    const meeting = await this.schedule(tenant.id, link.owner_id, {
      title: `${link.name} with ${name}`,
      start_at: startAt.toISOString(),
      duration_min: link.duration_min,
      mode: "ONLINE",
      lead_id: leadId,
      contact_id: contactId,
      owner_id: link.owner_id,
      booking_link_id: link.id,
    });

    await calendarRepository.incrementBookings(link.id, tenant.id);
    engineService.notify(tenant.id, link.owner_id, `New booking via ${link.name}: ${name}`);
    engineService.audit(tenant.id, link.owner_id, "booking_link.booked", "booking_link", link.id, {
      slug: link.slug,
      name,
      email,
    });

    return {
      ok: true,
      start_at: meeting.start_at,
      duration_min: meeting.duration_min,
      host: (await usersRepository.findById(link.owner_id, tenant.id))?.name ?? null,
      tenant: tenant.name,
    };
  }
}

export default new CalendarService();
