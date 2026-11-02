import calendarRepository from "../repositories/calendar.repository";
import { sendMeetingReminder } from "../services/meeting-invite.service";
import logger from "../utils/logger";

// How long before a meeting the reminder goes out. Tune via env without a deploy.
const LEAD_MINUTES = Number(process.env.MEETING_REMINDER_LEAD_MINUTES ?? 60);

let running = false;

// Sends a one-time reminder (email + WhatsApp) for lead/contact-linked meetings
// that start within the lead window and haven't been reminded yet. Idempotent
// via `meetings.reminder_sent_at`. Scheduled by scheduler.ts.
export async function runMeetingReminders(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + LEAD_MINUTES * 60_000);
    const due = await calendarRepository.dueReminders(now, windowEnd);
    for (const m of due) {
      try {
        await sendMeetingReminder({
          tenantId: m.tenant_id,
          actorId: m.owner_id,
          meeting: {
            id: m.id,
            title: m.title,
            start_at: m.start_at,
            duration_min: m.duration_min,
            mode: m.mode,
            location: m.location,
            lead_id: m.lead_id,
            contact_id: m.contact_id,
          },
        });
      } finally {
        // Mark sent even if a channel failed (best-effort) so we never spam.
        await calendarRepository.markReminderSent(m.id);
      }
    }
    if (due.length) logger.info(`meeting reminders: sent ${due.length}`);
  } catch (err) {
    logger.warn(`meeting reminders tick failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
