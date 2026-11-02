import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { meeting_mode, meeting_status } from "../db/enums";
import type { booking_links, DB, meetings } from "../db/types";

export type MeetingRow = Selectable<meetings>;
export type BookingLinkRow = Selectable<booking_links>;
export type MeetingWithName = MeetingRow & { with_name: string | null };

export interface CreateMeetingData {
  tenant_id: string;
  title: string;
  lead_id?: string | null;
  contact_id?: string | null;
  owner_id?: string | null;
  start_at: Date;
  duration_min?: number;
  mode?: meeting_mode;
  location?: string | null;
  status?: meeting_status;
  reminder_at?: Date | null;
  booking_link_id?: string | null;
}

export interface CreateBookingLinkData {
  tenant_id: string;
  name: string;
  slug: string;
  duration_min?: number;
  owner_id?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
}

class CalendarRepository {
  async listMeetings(
    tenantId: string,
    params: { owner?: string } = {}
  ): Promise<MeetingWithName[]> {
    let query = db
      .selectFrom("meetings")
      .leftJoin("contacts", (join) =>
        join
          .onRef("contacts.id", "=", "meetings.contact_id")
          .onRef("contacts.tenant_id", "=", "meetings.tenant_id")
      )
      .leftJoin("leads", (join) =>
        join
          .onRef("leads.id", "=", "meetings.lead_id")
          .onRef("leads.tenant_id", "=", "meetings.tenant_id")
      )
      .selectAll("meetings")
      .select(["contacts.name as contact_name", "leads.name as lead_name"])
      .where("meetings.tenant_id", "=", tenantId);

    if (params.owner) query = query.where("meetings.owner_id", "=", params.owner);

    const rows = await query.orderBy("meetings.start_at", "asc").execute();

    return rows.map(({ contact_name, lead_name, ...meeting }) => ({
      ...meeting,
      with_name: contact_name ?? lead_name ?? null,
    }));
  }

  async findMeetingById(id: string, tenantId: string): Promise<MeetingRow | undefined> {
    return db
      .selectFrom("meetings")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async createMeeting(data: CreateMeetingData, trx?: Transaction<DB>): Promise<MeetingRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("meetings")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        title: data.title,
        lead_id: data.lead_id ?? null,
        contact_id: data.contact_id ?? null,
        owner_id: data.owner_id ?? null,
        start_at: data.start_at,
        duration_min: data.duration_min ?? 30,
        mode: data.mode ?? "ONLINE",
        location: data.location ?? null,
        status: data.status ?? "SCHEDULED",
        reminder_at: data.reminder_at ?? null,
        booking_link_id: data.booking_link_id ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Record the synced external-calendar event on a meeting (and optionally swap
  // in the provider's video link). Called best-effort after a successful push.
  async setExternalEvent(
    id: string,
    tenantId: string,
    data: { provider: string; eventId: string; location?: string | null }
  ): Promise<void> {
    await db
      .updateTable("meetings")
      .set({
        external_provider: data.provider,
        external_event_id: data.eventId,
        ...(data.location ? { location: data.location } : {}),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  async cancelMeeting(id: string, tenantId: string): Promise<MeetingRow | undefined> {
    return db
      .updateTable("meetings")
      .set({ status: "CANCELLED", updated_at: new Date() })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteMeeting(id: string, tenantId: string): Promise<void> {
    await db
      .deleteFrom("meetings")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  async reminders(tenantId: string, from: Date, to: Date): Promise<MeetingRow[]> {
    return db
      .selectFrom("meetings")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "SCHEDULED")
      .where("reminder_at", ">=", from)
      .where("reminder_at", "<=", to)
      .orderBy("reminder_at", "asc")
      .execute();
  }

  // Meetings whose reminder is due to be SENT now: linked to a lead/contact (so
  // there's someone to notify), still SCHEDULED, not yet reminded, and starting
  // within the lead window (and not already in the past). Cross-tenant, the
  // reminder job runs on the single jobs worker.
  async dueReminders(now: Date, windowEnd: Date, limit = 100): Promise<MeetingRow[]> {
    return db
      .selectFrom("meetings")
      .selectAll()
      .where("status", "=", "SCHEDULED")
      .where("reminder_sent_at", "is", null)
      .where("start_at", ">", now)
      .where("start_at", "<=", windowEnd)
      .where((eb) => eb.or([eb("lead_id", "is not", null), eb("contact_id", "is not", null)]))
      .orderBy("start_at", "asc")
      .limit(limit)
      .execute();
  }

  async markReminderSent(id: string): Promise<void> {
    const now = new Date();
    await db
      .updateTable("meetings")
      .set({ reminder_sent_at: now, updated_at: now })
      .where("id", "=", id)
      .execute();
  }

  async listBookingLinks(tenantId: string): Promise<BookingLinkRow[]> {
    return db
      .selectFrom("booking_links")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();
  }

  // The agent's ONE personal booking link: the generic (untargeted) link they
  // own. Targeted per-lead links (lead_id/contact_id set) are excluded so a
  // legacy targeted link never masquerades as the agent's shareable link.
  async findGenericBookingLinkByOwner(
    tenantId: string,
    ownerId: string
  ): Promise<BookingLinkRow | undefined> {
    return db
      .selectFrom("booking_links")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("owner_id", "=", ownerId)
      .where("lead_id", "is", null)
      .where("contact_id", "is", null)
      .orderBy("created_at", "asc")
      .executeTakeFirst();
  }

  // Update the editable fields of a booking link (name + duration). The slug/URL
  // is immutable so a shared link never breaks.
  async updateBookingLink(
    id: string,
    tenantId: string,
    data: { name?: string; duration_min?: number }
  ): Promise<BookingLinkRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.duration_min !== undefined) patch.duration_min = data.duration_min;
    return db
      .updateTable("booking_links")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async findBookingLinkBySlug(slug: string, tenantId: string): Promise<BookingLinkRow | undefined> {
    return db
      .selectFrom("booking_links")
      .selectAll()
      .where("slug", "=", slug)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async bookingLinkSlugExists(tenantId: string, slug: string): Promise<boolean> {
    const row = await db
      .selectFrom("booking_links")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("slug", "=", slug)
      .executeTakeFirst();
    return !!row;
  }

  async createBookingLink(
    data: CreateBookingLinkData,
    trx?: Transaction<DB>
  ): Promise<BookingLinkRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("booking_links")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        slug: data.slug,
        duration_min: data.duration_min ?? 30,
        owner_id: data.owner_id ?? null,
        lead_id: data.lead_id ?? null,
        contact_id: data.contact_id ?? null,
        bookings: 0,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async incrementBookings(id: string, tenantId: string): Promise<void> {
    await db
      .updateTable("booking_links")
      .set((eb) => ({ bookings: eb("bookings", "+", 1), updated_at: new Date() }))
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }
}

export default new CalendarRepository();
