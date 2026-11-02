import { db } from "../db/connection";
import { BadRequestError } from "../errors";
import calendarConnectionsRepository from "../repositories/calendar-connections.repository";
import googleCalendarService from "./google-calendar.service";
import logger from "../utils/logger";

// Lightweight scheduling guardrails shared by manual + AI meeting booking:
//  - per-tenant working hours (day-of-week + open/close in a timezone),
//  - conflict detection against the owner's existing SCHEDULED meetings.
// No external calendar sync (that's a later phase); meetings are CRM records.
export interface WorkingHours {
  timezone: string; // IANA tz, e.g. "Asia/Kolkata"
  days: number[]; // allowed weekdays, 0=Sun … 6=Sat
  start: string; // "HH:MM" local open time
  end: string; // "HH:MM" local close time
}

const DEFAULT_HOURS: WorkingHours = {
  timezone: "Asia/Kolkata",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
};

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const hm = (s: string): number => {
  const [h, m] = String(s).split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

// Weekday + minutes-of-day of a UTC instant, evaluated in the given timezone.
const localParts = (date: Date, tz: string): { dow: number; minutesOfDay: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some platforms emit 24 for midnight
  return { dow: DOW[get("weekday")] ?? 0, minutesOfDay: hour * 60 + parseInt(get("minute"), 10) };
};

// Timezone offset (localWallClock - UTC) in ms at a given instant, via Intl.
const tzOffsetMs = (date: Date, tz: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(
    parseInt(get("year"), 10),
    parseInt(get("month"), 10) - 1,
    parseInt(get("day"), 10),
    hour,
    parseInt(get("minute"), 10),
    parseInt(get("second"), 10)
  );
  return asUTC - date.getTime();
};

// Convert a wall-clock time in `tz` (y, m 1-12, d, minutes-of-day) to the UTC
// instant. Two-pass to stay correct across DST transitions.
const wallTimeToUtc = (y: number, mo: number, d: number, minutesOfDay: number, tz: string): Date => {
  const hh = Math.floor(minutesOfDay / 60);
  const mm = minutesOfDay % 60;
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const offset1 = tzOffsetMs(new Date(guess), tz);
  let utc = guess - offset1;
  const offset2 = tzOffsetMs(new Date(utc), tz);
  if (offset2 !== offset1) utc = guess - offset2;
  return new Date(utc);
};

// Local calendar date + weekday of an instant in `tz`.
const localYmd = (date: Date, tz: string): { year: number; month: number; day: number; dow: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    dow: DOW[get("weekday")] ?? 0,
  };
};

export interface AvailabilityResult {
  ok: boolean;
  reason?: string;
}

export interface DaySlots {
  date: string; // local YYYY-MM-DD
  slots: string[]; // ISO UTC start times
}

class SchedulingService {
  // Validate + persist a tenant's working hours into tenants.config.scheduling
  // (no schema change). Both manual scheduling and the AI agent read these.
  async setWorkingHours(tenantId: string, input: Record<string, unknown>): Promise<WorkingHours> {
    const wh = this.validateHours(input);
    const row = await db
      .selectFrom("tenants")
      .select("config")
      .where("id", "=", tenantId)
      .executeTakeFirst();
    const config =
      row?.config && typeof row.config === "object"
        ? { ...(row.config as Record<string, unknown>) }
        : {};
    config.scheduling = wh;
    await db
      .updateTable("tenants")
      .set({ config: JSON.stringify(config), updated_at: new Date() })
      .where("id", "=", tenantId)
      .execute();
    return wh;
  }

  private validateHours(input: Record<string, unknown>): WorkingHours {
    const timezone = String(input.timezone ?? "").trim() || DEFAULT_HOURS.timezone;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      throw new BadRequestError(`Invalid timezone: ${timezone}`);
    }
    const days = Array.isArray(input.days)
      ? [...new Set(input.days.map(Number))]
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          .sort((a, b) => a - b)
      : DEFAULT_HOURS.days;
    if (!days.length) throw new BadRequestError("Select at least one working day");
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    const start = String(input.start ?? "").trim();
    const end = String(input.end ?? "").trim();
    if (!re.test(start) || !re.test(end)) {
      throw new BadRequestError("Times must be in 24-hour HH:MM format");
    }
    if (hm(start) >= hm(end)) {
      throw new BadRequestError("Start time must be before end time");
    }
    return { timezone, days, start, end };
  }

  async getWorkingHours(tenantId: string): Promise<WorkingHours> {
    const row = await db
      .selectFrom("tenants")
      .select("config")
      .where("id", "=", tenantId)
      .executeTakeFirst();
    const cfg = (row?.config as { scheduling?: Partial<WorkingHours> } | null)?.scheduling;
    return {
      timezone: cfg?.timezone || DEFAULT_HOURS.timezone,
      days: Array.isArray(cfg?.days) && cfg!.days!.length ? cfg!.days! : DEFAULT_HOURS.days,
      start: cfg?.start || DEFAULT_HOURS.start,
      end: cfg?.end || DEFAULT_HOURS.end,
    };
  }

  // Is this instant inside the tenant's working window (working day, at or after
  // open, before close)? The single check every feature should use when it needs
  // to know "is the workspace open right now", e.g. the sales agent only runs
  // its automation during working hours.
  isWithinWorkingHours(at: Date, wh: WorkingHours): boolean {
    const { dow, minutesOfDay } = localParts(at, wh.timezone);
    if (!wh.days.includes(dow)) return false;
    return minutesOfDay >= hm(wh.start) && minutesOfDay < hm(wh.end);
  }

  // Convenience: resolve the tenant's hours and test an instant against them.
  async isTenantOpen(tenantId: string, at: Date): Promise<boolean> {
    return this.isWithinWorkingHours(at, await this.getWorkingHours(tenantId));
  }

  // Is `startAt` (UTC) bookable: inside working hours (whole meeting), on a
  // working day, and not overlapping an existing meeting for `ownerId`?
  async checkAvailability(
    tenantId: string,
    ownerId: string | null,
    startAt: Date,
    durationMin: number
  ): Promise<AvailabilityResult> {
    const wh = await this.getWorkingHours(tenantId);
    const endAt = new Date(startAt.getTime() + durationMin * 60_000);
    const startP = localParts(startAt, wh.timezone);
    const endP = localParts(endAt, wh.timezone);
    const open = hm(wh.start);
    const close = hm(wh.end);

    if (!wh.days.includes(startP.dow)) {
      return { ok: false, reason: "that day is outside working days" };
    }
    if (startP.minutesOfDay < open) {
      return { ok: false, reason: `the day starts at ${wh.start}` };
    }
    // End must land the same day and not run past close (no overnight bookings).
    if (endP.dow !== startP.dow || endP.minutesOfDay > close || endP.minutesOfDay <= startP.minutesOfDay) {
      return { ok: false, reason: `it would run past the ${wh.end} close` };
    }

    if (ownerId) {
      const windowStart = new Date(startAt.getTime() - 6 * 60 * 60_000);
      const existing = await db
        .selectFrom("meetings")
        .select(["start_at", "duration_min"])
        .where("tenant_id", "=", tenantId)
        .where("owner_id", "=", ownerId)
        .where("status", "=", "SCHEDULED")
        .where("start_at", ">=", windowStart)
        .where("start_at", "<", endAt)
        .execute();
      for (const m of existing) {
        const s = new Date(m.start_at).getTime();
        const e = s + (m.duration_min ?? 30) * 60_000;
        if (s < endAt.getTime() && e > startAt.getTime()) {
          return { ok: false, reason: "the host already has a meeting then" };
        }
      }

      // Also respect the host's REAL calendar (Google) when connected. This can
      // only ADD conflicts; it never relaxes the checks above. Fail-open: any
      // error (or the feature being off) leaves today's CRM-only behavior.
      const external = await this.checkExternalBusy(tenantId, ownerId, startAt, endAt);
      if (!external.ok) return external;
    }
    return { ok: true };
  }

  // Bookable start times for a public booking link over the next `days`,
  // grouped by local date. A slot qualifies when the whole meeting fits inside
  // working hours on a working day, is in the future, and overlaps neither an
  // existing SCHEDULED meeting for the owner (one query) nor a Google busy block
  // (one FreeBusy call, fail-open). Pure computation otherwise, no per-slot IO.
  async availableSlots(
    tenantId: string,
    ownerId: string | null,
    durationMin: number,
    fromDate: Date,
    days = 14,
    stepMin = 30
  ): Promise<DaySlots[]> {
    const wh = await this.getWorkingHours(tenantId);
    const open = hm(wh.start);
    const close = hm(wh.end);
    const rangeEnd = new Date(fromDate.getTime() + days * 24 * 60 * 60_000);

    // Collect busy intervals once: CRM meetings + (optionally) Google busy.
    const busy: Array<{ start: number; end: number }> = [];
    if (ownerId) {
      const meetings = await db
        .selectFrom("meetings")
        .select(["start_at", "duration_min"])
        .where("tenant_id", "=", tenantId)
        .where("owner_id", "=", ownerId)
        .where("status", "=", "SCHEDULED")
        .where("start_at", ">=", new Date(fromDate.getTime() - 24 * 60 * 60_000))
        .where("start_at", "<", rangeEnd)
        .execute();
      for (const m of meetings) {
        const s = new Date(m.start_at).getTime();
        busy.push({ start: s, end: s + (m.duration_min ?? 30) * 60_000 });
      }

      try {
        if (googleCalendarService.isEnabled()) {
          const conn = await calendarConnectionsRepository.find(tenantId, ownerId);
          if (conn && conn.status === "CONNECTED" && conn.sync_enabled) {
            const blocks = await googleCalendarService.freeBusyBlocks(conn, fromDate, rangeEnd);
            for (const b of blocks) busy.push({ start: b.start.getTime(), end: b.end.getTime() });
          }
        }
      } catch (err) {
        logger.warn(`Google freeBusy (slots) skipped for user ${ownerId}: ${err}`);
      }
    }

    const overlaps = (startMs: number, endMs: number): boolean =>
      busy.some((b) => b.start < endMs && b.end > startMs);

    const nowMs = fromDate.getTime();
    const out: DaySlots[] = [];
    for (let offset = 0; offset < days; offset++) {
      const anchor = new Date(fromDate.getTime() + offset * 24 * 60 * 60_000);
      const { year, month, day, dow } = localYmd(anchor, wh.timezone);
      if (!wh.days.includes(dow)) continue;

      const slots: string[] = [];
      for (let mins = open; mins + durationMin <= close; mins += stepMin) {
        const start = wallTimeToUtc(year, month, day, mins, wh.timezone);
        const startMs = start.getTime();
        const endMs = startMs + durationMin * 60_000;
        if (startMs <= nowMs) continue; // no past slots
        if (overlaps(startMs, endMs)) continue;
        slots.push(start.toISOString());
      }
      if (slots.length) {
        out.push({
          date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          slots,
        });
      }
    }
    return out;
  }

  // Google FreeBusy overlap for the owner, gated + best-effort. Returns ok:true
  // (allow) whenever the feature is off, the owner isn't connected, or the API
  // errors/times out, so external calendar problems never block scheduling.
  private async checkExternalBusy(
    tenantId: string,
    ownerId: string,
    startAt: Date,
    endAt: Date
  ): Promise<AvailabilityResult> {
    if (!googleCalendarService.isEnabled()) return { ok: true };
    try {
      const conn = await calendarConnectionsRepository.find(tenantId, ownerId);
      if (!conn || conn.status !== "CONNECTED" || !conn.sync_enabled) return { ok: true };
      const busy = await googleCalendarService.isBusy(conn, startAt, endAt);
      if (busy) return { ok: false, reason: "the host is busy on their Google Calendar then" };
      return { ok: true };
    } catch (err) {
      logger.warn(`Google freeBusy check skipped for user ${ownerId}: ${err}`);
      return { ok: true };
    }
  }

  // Human-friendly local time, for confirmations the agent reads back AND the
  // "current time" in the prompt. MUST include the year, without it the LLM
  // assumed its training-era year (2023) and booked times 3 years in the past.
  formatLocal(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }
}

export default new SchedulingService();
