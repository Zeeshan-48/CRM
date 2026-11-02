import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_FINANCE,
  login,
} from "../helpers";

// pg serializes Date writes with local getters; index.ts forces TZ=UTC in the
// server process, so the test process must match or timestamps shift.
process.env.TZ = "UTC";

const MARKER = `cal-test-${Date.now()}`;

let adminToken: string;
let financeToken: string;
let esAdminToken: string;
let adminUserId: string;
let nwTenantId: string;
let testLeadId: string;

const createdMeetingIds: string[] = [];
const createdLinkIds: string[] = [];
// The working-hours test writes tenants.config; snapshot/restore so it leaves
// the shared northwind tenant unchanged.
let savedTenantConfig: unknown = null;

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const me = await api.get("/api/v1/auth/me").set(auth(adminToken));
  adminUserId = me.body.data.user.id;

  const tenant = await db
    .selectFrom("tenants")
    .select("id")
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;
  savedTenantConfig =
    (
      await db
        .selectFrom("tenants")
        .select("config")
        .where("id", "=", nwTenantId)
        .executeTakeFirst()
    )?.config ?? null;

  // A lead inserted directly so no workflow side effects need cleanup.
  testLeadId = ulid();
  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await db
    .insertInto("leads")
    .values({
      id: testLeadId,
      tenant_id: nwTenantId,
      name: `Lead ${MARKER}`,
      email: `${MARKER}@example.com`,
      phone: "",
      city: "Pune",
      source: "API",
      campaign: "",
      owner_id: null,
      tags: JSON.stringify([]),
      notes: "",
      last_activity_at: old,
      created_at: old,
      updated_at: old,
    })
    .execute();
});

afterAll(async () => {
  for (const id of createdMeetingIds) {
    await db.deleteFrom("meetings").where("id", "=", id).execute();
  }
  for (const id of createdLinkIds) {
    await db.deleteFrom("meetings").where("booking_link_id", "=", id).execute();
    await db.deleteFrom("booking_links").where("id", "=", id).execute();
  }
  await db.deleteFrom("activities").where("lead_id", "=", testLeadId).execute();
  await db.deleteFrom("leads").where("id", "=", testLeadId).execute();
  // Leads auto-created by booking against a generic link (email carries MARKER),
  // plus their activities/meetings, so a booking test leaves no residue.
  const bookedLeads = await db
    .selectFrom("leads")
    .select("id")
    .where("tenant_id", "=", nwTenantId)
    .where("email", "like", `%${MARKER}%`)
    .execute();
  for (const l of bookedLeads) {
    await db.deleteFrom("activities").where("lead_id", "=", l.id).execute();
    await db.deleteFrom("meetings").where("lead_id", "=", l.id).execute();
    await db.deleteFrom("leads").where("id", "=", l.id).execute();
  }
  await db
    .updateTable("tenants")
    .set({ config: savedTenantConfig === null ? null : JSON.stringify(savedTenantConfig) })
    .where("id", "=", nwTenantId)
    .execute();
  await closeDB();
});

describe("calendar providers", () => {
  it("returns the provider catalogue with real connection state", async () => {
    const res = await api.get("/api/v1/calendar/providers").set(auth(adminToken));
    expect(res.status).toBe(200);
    const keys = res.body.data.map((p: { key: string }) => p.key);
    // Google is the only supported provider (Outlook/Calendly removed).
    expect(keys).toEqual(["google"]);
    for (const provider of res.body.data) {
      // connected reflects the real per-user state (true once that user has
      // linked Google in this env), so assert the shape, not a fixed value.
      expect(typeof provider.connected).toBe("boolean");
      expect(provider.note).toBeTruthy();
      expect(provider.name).toBeTruthy();
    }
  });

  it("denies the calendar module to FINANCE", async () => {
    const res = await api.get("/api/v1/calendar/providers").set(auth(financeToken));
    expect(res.status).toBe(403);
  });
});

describe("meetings", () => {
  it("lists meetings upcoming first with resolved with_name", async () => {
    const res = await api.get("/api/v1/calendar/meetings").set(auth(adminToken));
    expect(res.status).toBe(200);
    const list = res.body.data;
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < list.length; i++) {
      expect(new Date(list[i - 1].start_at).getTime()).toBeLessThanOrEqual(
        new Date(list[i].start_at).getTime()
      );
    }
    const seeded = list.find((m: { title: string }) => m.title.startsWith("Demo with"));
    expect(seeded).toBeTruthy();
    expect(seeded.with_name).toBeTruthy();
  });

  it("requires title and start_at, validates mode", async () => {
    const noTitle = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ start_at: days(1) });
    expect(noTitle.status).toBe(400);

    const noStart = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Sync ${MARKER}` });
    expect(noStart.status).toBe(400);

    const badMode = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Sync ${MARKER}`, start_at: days(1), mode: "TELEPATHY" });
    expect(badMode.status).toBe(400);
  });

  it("schedules a meeting with defaults (30 min, ONLINE, reminder = start)", async () => {
    const startAt = days(2);
    const res = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Demo sync ${MARKER}`, start_at: startAt, force: true });
    expect(res.status).toBe(201);
    const meeting = res.body.data;
    createdMeetingIds.push(meeting.id);
    expect(meeting.duration_min).toBe(30);
    expect(meeting.mode).toBe("ONLINE");
    expect(meeting.status).toBe("SCHEDULED");
    // ONLINE meetings get a real, joinable video link: Jitsi by default, or a
    // real Google Meet link when the owner has Google Calendar connected.
    expect(meeting.location).toMatch(/^https:\/\/(meet\.jit\.si|meet\.google\.com)\//);
    expect(meeting.owner_id).toBe(adminUserId);
    expect(new Date(meeting.reminder_at).getTime()).toBe(new Date(startAt).getTime());
  });

  it("logs a MEETING activity and touches the lead when lead_id is given", async () => {
    const res = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Lead demo ${MARKER}`, start_at: days(3), lead_id: testLeadId, force: true });
    expect(res.status).toBe(201);
    createdMeetingIds.push(res.body.data.id);

    const activity = await db
      .selectFrom("activities")
      .selectAll()
      .where("tenant_id", "=", nwTenantId)
      .where("lead_id", "=", testLeadId)
      .where("type", "=", "MEETING")
      .executeTakeFirst();
    expect(activity).toBeTruthy();
    expect(activity?.subject).toBe(`Lead demo ${MARKER}`);

    const lead = await db
      .selectFrom("leads")
      .select("last_activity_at")
      .where("id", "=", testLeadId)
      .executeTakeFirstOrThrow();
    expect(new Date(lead.last_activity_at as unknown as string).getTime()).toBeGreaterThan(
      Date.now() - 60 * 1000
    );
  });

  it("cancels a meeting and blocks cross-tenant cancellation", async () => {
    const created = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Cancel me ${MARKER}`, start_at: days(4), force: true });
    const meetingId = created.body.data.id;
    createdMeetingIds.push(meetingId);

    const crossTenant = await api
      .post(`/api/v1/calendar/meetings/${meetingId}/cancel`)
      .set(auth(esAdminToken));
    expect(crossTenant.status).toBe(404);

    const cancelled = await api
      .post(`/api/v1/calendar/meetings/${meetingId}/cancel`)
      .set(auth(adminToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
  });
});

describe("availability guardrail + delete", () => {
  it("blocks a conflicting/off-hours slot, allows force, then deletes", async () => {
    const slot = days(5);
    const a = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Avail A ${MARKER}`, start_at: slot, force: true });
    expect(a.status).toBe(201);
    const aId = a.body.data.id;
    createdMeetingIds.push(aId);

    // Same owner + same slot WITHOUT force => rejected (conflict or off-hours).
    const blocked = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Avail B ${MARKER}`, start_at: slot });
    expect(blocked.status).toBe(400);

    // force overrides the guardrail.
    const forced = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Avail B ${MARKER}`, start_at: slot, force: true });
    expect(forced.status).toBe(201);
    createdMeetingIds.push(forced.body.data.id);

    // Delete A; cross-tenant delete is blocked; A no longer listed.
    const cross = await api
      .delete(`/api/v1/calendar/meetings/${aId}`)
      .set(auth(esAdminToken));
    expect(cross.status).toBe(404);

    const del = await api.delete(`/api/v1/calendar/meetings/${aId}`).set(auth(adminToken));
    expect(del.status).toBe(200);

    const list = await api.get("/api/v1/calendar/meetings").set(auth(adminToken));
    const ids = list.body.data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(aId);
  });
});

describe("reminders", () => {
  it("returns only SCHEDULED meetings with reminder_at in the next 7 days", async () => {
    const soon = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Soon ${MARKER}`, start_at: days(2), force: true });
    createdMeetingIds.push(soon.body.data.id);

    const far = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Far ${MARKER}`, start_at: days(30), force: true });
    createdMeetingIds.push(far.body.data.id);

    const cancelled = await api
      .post("/api/v1/calendar/meetings")
      .set(auth(adminToken))
      .send({ title: `Cancelled ${MARKER}`, start_at: days(3), force: true });
    createdMeetingIds.push(cancelled.body.data.id);
    await api
      .post(`/api/v1/calendar/meetings/${cancelled.body.data.id}/cancel`)
      .set(auth(adminToken));

    const res = await api.get("/api/v1/calendar/reminders").set(auth(adminToken));
    expect(res.status).toBe(200);
    const titles = res.body.data.map((m: { title: string }) => m.title);
    expect(titles).toContain(`Soon ${MARKER}`);
    expect(titles).not.toContain(`Far ${MARKER}`);
    expect(titles).not.toContain(`Cancelled ${MARKER}`);
  });
});

describe("booking links", () => {
  it("lists booking links including the seeded discovery link", async () => {
    const res = await api.get("/api/v1/calendar/booking-links").set(auth(adminToken));
    expect(res.status).toBe(200);
    const slugs = res.body.data.map((l: { slug: string }) => l.slug);
    expect(slugs).toContain("discovery-northwind");
    for (const link of res.body.data) {
      // Real public booking URL: {CRM_APP_URL}/meet/{tenantSlug}/{linkSlug}.
      expect(link.url).toMatch(new RegExp(`/meet/[^/]+/${link.slug}$`));
    }
  });

  it("requires a name", async () => {
    const res = await api.post("/api/v1/calendar/booking-links").set(auth(adminToken)).send({});
    expect(res.status).toBe(400);
  });

  // PUBLIC booking page (no auth header): resolves tenant+link from the URL and
  // returns branding + open slots for a prospect to self-schedule.
  it("serves the public booking page unauthenticated with open slots", async () => {
    const res = await api.get("/api/v1/public/booking/northwind/discovery-northwind");
    expect(res.status).toBe(200);
    expect(res.body.data.link.slug).toBe("discovery-northwind");
    expect(res.body.data.tenant.name).toBeTruthy();
    expect(res.body.data.timezone).toBeTruthy();
    expect(Array.isArray(res.body.data.days)).toBe(true);
  });

  it("returns 404 for an unknown public booking link", async () => {
    const res = await api.get(`/api/v1/public/booking/northwind/missing-${Date.now()}`);
    expect(res.status).toBe(404);
  });

  it("rejects a public booking with an invalid email", async () => {
    const res = await api
      .post("/api/v1/public/booking/northwind/discovery-northwind")
      .send({ name: "Test", email: "nope", startAt: days(3) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a booking slug from another tenant", async () => {
    const res = await api
      .post(`/api/v1/calendar/booking-links/discovery-northwind/book`)
      .set(auth(esAdminToken))
      .send({ name: "Mallory", email: "mallory@example.com" });
    expect(res.status).toBe(404);
  });
});

// The new single-per-agent flow: one reusable link created once, editable,
// shareable to many, and safe against double-booking (a taken slot vanishes
// from availability so nobody else can grab it).
describe("my booking link (single per agent)", () => {
  let mySlug = "";
  let myLinkId = "";

  it("starts empty, then creates one link with a non-identifying random slug", async () => {
    // Clear any generic link left by a prior aborted run so the create is fresh.
    await db
      .deleteFrom("booking_links")
      .where("tenant_id", "=", nwTenantId)
      .where("owner_id", "=", adminUserId)
      .where("lead_id", "is", null)
      .where("contact_id", "is", null)
      .execute();

    const before = await api
      .get("/api/v1/calendar/booking-links/mine")
      .set(auth(adminToken));
    expect(before.status).toBe(200);
    expect(before.body.data).toBeNull();

    const res = await api
      .post("/api/v1/calendar/booking-links/mine")
      .set(auth(adminToken))
      .send({ name: `My Link ${MARKER}`, duration_min: 45 });
    expect(res.status).toBe(201);
    myLinkId = res.body.data.id;
    mySlug = res.body.data.slug;
    createdLinkIds.push(myLinkId);
    expect(mySlug).toMatch(/^[a-z0-9]{6,}$/);
    expect(res.body.data.owner_id).toBe(adminUserId);
    expect(res.body.data.duration_min).toBe(45);
    expect(res.body.data.bookings).toBe(0);
    expect(res.body.data.url).toMatch(new RegExp(`/meet/[^/]+/${mySlug}$`));
  });

  it("is idempotent, a repeat create returns the same link, unchanged", async () => {
    const res = await api
      .post("/api/v1/calendar/booking-links/mine")
      .set(auth(adminToken))
      .send({ name: "Should be ignored", duration_min: 15 });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(myLinkId);
    expect(res.body.data.slug).toBe(mySlug);
    expect(res.body.data.alreadyExisted).toBe(true);
    expect(res.body.data.duration_min).toBe(45);

    const get = await api
      .get("/api/v1/calendar/booking-links/mine")
      .set(auth(adminToken));
    expect(get.body.data.id).toBe(myLinkId);
  });

  it("edits the name and duration but keeps the slug/URL", async () => {
    const res = await api
      .patch("/api/v1/calendar/booking-links/mine")
      .set(auth(adminToken))
      .send({ name: `Renamed ${MARKER}`, duration_min: 20 });
    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe(mySlug);
    expect(res.body.data.name).toBe(`Renamed ${MARKER}`);
    expect(res.body.data.duration_min).toBe(20);
  });

  it("shares the link to selected leads and reports per-recipient outcomes", async () => {
    const res = await api
      .post("/api/v1/calendar/booking-links/mine/share")
      .set(auth(adminToken))
      .send({ leadIds: [testLeadId] });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.results[0].type).toBe("lead");
    expect(res.body.data.results[0].id).toBe(testLeadId);
    expect(typeof res.body.data.results[0].emailed).toBe("boolean");
  });

  it("rejects a share with no recipients", async () => {
    const res = await api
      .post("/api/v1/calendar/booking-links/mine/share")
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(400);
  });

  it("a booked slot disappears from availability so it can't be double-booked", async () => {
    const info = await api.get(`/api/v1/public/booking/northwind/${mySlug}`);
    expect(info.status).toBe(200);
    const slots: string[] = info.body.data.days.flatMap(
      (d: { slots: string[] }) => d.slots
    );
    const slot = slots[0];
    expect(slot).toBeTruthy();

    const booked = await api
      .post(`/api/v1/calendar/booking-links/${mySlug}/book`)
      .set(auth(adminToken))
      .send({ name: "Pat Prospect", email: `pat-${MARKER}@example.com`, startAt: slot });
    expect(booked.status).toBe(201);
    createdMeetingIds.push(booked.body.data.meeting.id);
    expect(booked.body.data.meeting.owner_id).toBe(adminUserId);

    // That same slot is no longer offered to the next visitor.
    const after = await api.get(`/api/v1/public/booking/northwind/${mySlug}`);
    const stillOffered: string[] = after.body.data.days.flatMap(
      (d: { slots: string[] }) => d.slots
    );
    expect(stillOffered).not.toContain(slot);
  });
});
