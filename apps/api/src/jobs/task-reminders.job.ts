import config from "../config";
import activitiesRepository from "../repositories/activities.repository";
import mailerService from "../services/mailer.service";
import logger from "../utils/logger";

// Hour of day (UTC) at/after which the daily task reminders go out. Default 3 UTC
// is ~08:30 IST, a sensible "start of day" nudge. Tune via env without a deploy.
const SEND_HOUR_UTC = Number(process.env.TASK_REMINDER_HOUR_UTC ?? 3);

let running = false;

const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const dayStamp = (d: Date): string => d.toISOString().slice(0, 10);

const formatDue = (due: Date | null): string =>
  due
    ? new Date(due).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "No due date set";

/**
 * Emails each task owner once a day, for every task that is still OPEN and has
 * `remind_daily` on, until the task is completed. Idempotent per calendar day via
 * `tasks.reminder_last_sent_at` (so a second tick in the same window never double
 * sends). Best-effort: a failed send for one task never blocks the others, and
 * mailer.service self-simulates when SES is not keyed. Scheduled by scheduler.ts.
 */
export async function runTaskReminders(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    // Only send at/after the configured hour, so reminders land in the morning
    // rather than at whatever minute the sweep first runs.
    if (now.getUTCHours() < SEND_HOUR_UTC) return;

    const dayStart = startOfUtcDay(now);
    const due = await activitiesRepository.dueReminderTasks(dayStart);
    if (!due.length) return;

    let sent = 0;
    for (const task of due) {
      const owner = task.owner_name?.trim() || "there";
      const leadLine = task.lead_id
        ? [
            `Lead: ${task.lead_name?.trim() || "Linked lead"}`,
            `Open the lead: ${config.CRM_APP_URL}/leads/${task.lead_id}`,
          ]
        : [];

      const body = [
        `Hi ${owner},`,
        "",
        "This is your daily reminder for a task that's still open:",
        "",
        [
          `Task: ${task.title}`,
          `Priority: ${task.priority}`,
          `Due: ${formatDue(task.due_at)}`,
          ...leadLine,
        ].join("\n"),
        "",
        "You'll keep getting this reminder each day until the task is marked complete.",
        `See all your work: ${config.CRM_APP_URL}/reminders`,
      ].join("\n");

      try {
        await mailerService.send({
          tenantId: task.tenant_id,
          category: "NOTIFICATION",
          to: task.owner_email,
          subject: `Reminder: ${task.title}`,
          text: body,
          // One reminder per task per calendar day, even if the sweep runs twice.
          idempotencyKey: `task-reminder:${task.id}:${dayStamp(now)}`,
        });
        sent++;
      } catch (err) {
        logger.warn(`task reminder email failed for task ${task.id}: ${String(err)}`);
      } finally {
        // Stamp regardless of send outcome so a persistently failing task never
        // becomes a daily retry storm, it resumes naturally the next day.
        await activitiesRepository.markReminderSent(task.id, now);
      }
    }
    if (sent) logger.info(`task reminders: sent ${sent}`);
  } catch (err) {
    logger.warn(`task reminders tick failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
