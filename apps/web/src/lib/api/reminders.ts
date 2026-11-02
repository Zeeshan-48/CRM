import type { ReminderCount } from "@/types";
import { apiDelete, apiGet, apiPost, apiPut } from "./client";

export type ReminderPriority = "LOW" | "MEDIUM" | "HIGH";
export type ReminderStatus = "OPEN" | "DONE";
export type ReminderFilter = "open" | "today" | "done" | "all";

export interface Reminder {
  id: string;
  title: string;
  note: string | null;
  priority: ReminderPriority;
  status: ReminderStatus;
  /** YYYY-MM-DD or null when no due date is set. */
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderPayload {
  title?: string;
  note?: string;
  priority?: ReminderPriority;
  /** YYYY-MM-DD; null clears the due date on update. */
  dueDate?: string | null;
}

export const getReminderCount = () => apiGet<ReminderCount>("/reminders/count");

export const listReminders = (filter: ReminderFilter = "all") =>
  apiGet<Reminder[]>("/reminders", { params: { filter } });

export const createReminder = (payload: ReminderPayload & { title: string }) =>
  apiPost<Reminder>("/reminders", payload);

export const updateReminder = (id: string, payload: ReminderPayload) =>
  apiPut<Reminder>(`/reminders/${id}`, payload);

export const toggleReminder = (id: string) =>
  apiPost<Reminder>(`/reminders/${id}/toggle`);

export const deleteReminder = (id: string) =>
  apiDelete<{ ok: boolean }>(`/reminders/${id}`);
