import { apiDelete, apiGet, apiPost, apiPut } from "./client";

export type ActivityType = "CALL" | "MEETING" | "DEMO" | "NOTE" | "EMAIL" | "TASK";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type TaskStatus = "OPEN" | "DONE" | "CANCELLED";
export type Priority = "HIGH" | "MEDIUM" | "LOW";

export interface Activity {
  id: string;
  tenant_id: string;
  type: ActivityType;
  direction: MessageDirection | null;
  subject: string | null;
  notes: string | null;
  owner_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  duration_sec: number | null;
  created_at: string;
  updated_at: string;
  // Display names resolved server-side (present on the list endpoint) so the feed
  // can read "<agent> did <X> with <lead/contact/deal>".
  owner_name?: string | null;
  with_type?: "LEAD" | "CONTACT" | "DEAL" | null;
  with_name?: string | null;
  // True when an AI agent logged this (autonomous voice call, sales agent, …).
  ai_generated?: boolean;
}

export interface Task {
  id: string;
  tenant_id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  due_at: string | null;
  completed_at: string | null;
  owner_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  remind_daily: boolean;
  reminder_last_sent_at: string | null;
  // True when an AI agent created this task (e.g. the sales agent's follow-ups).
  ai_generated?: boolean;
  created_at: string;
  updated_at: string;
}

export const listActivities = (params?: {
  type?: ActivityType;
  leadId?: string;
  contactId?: string;
  dealId?: string;
  owner?: string;
  // false → hide AI-generated rows; omit/true → include everything.
  includeAi?: boolean;
  limit?: number;
}) => apiGet<Activity[]>("/activities", { params });

/** True total of activities (unbounded by listActivities' page limit), honouring
 *  the same type/owner filters. Powers the "Total activities" summary stat. */
export const countActivities = (params?: {
  type?: ActivityType;
  leadId?: string;
  contactId?: string;
  dealId?: string;
  owner?: string;
  includeAi?: boolean;
}) => apiGet<{ total: number }>("/activities/count", { params });

export const logActivity = (body: {
  type: ActivityType;
  direction?: MessageDirection;
  subject?: string;
  notes?: string;
  lead_id?: string;
  contact_id?: string;
  deal_id?: string;
  duration_sec?: number;
}) => apiPost<Activity>("/activities", body);

export const listTasks = (status?: TaskStatus, mine?: boolean, includeAi?: boolean) =>
  apiGet<Task[]>("/activities/tasks/list", {
    params: {
      ...(status ? { status } : {}),
      // Only send `mine` when true, any string (even "false") reads as truthy
      // server-side, so its mere presence is what enables the owner filter.
      ...(mine ? { mine: 1 } : {}),
      // Only send when hiding AI (false); omit otherwise so the default is "all".
      ...(includeAi === false ? { includeAi: 0 } : {}),
    },
  });

export const createTask = (body: {
  title: string;
  priority?: Priority;
  due_at?: string;
  owner_id?: string;
  lead_id?: string;
  contact_id?: string;
  deal_id?: string;
  remind_daily?: boolean;
}) => apiPost<Task>("/activities/tasks", body);

export const completeTask = (id: string) =>
  apiPost<Task>(`/activities/tasks/${id}/complete`);

export const updateActivity = (
  id: string,
  body: {
    type?: ActivityType;
    direction?: MessageDirection;
    subject?: string;
    notes?: string;
    duration_sec?: number;
  }
) => apiPut<Activity>(`/activities/${id}`, body);

export const deleteActivity = (id: string) =>
  apiDelete<{ ok: boolean }>(`/activities/${id}`);

export const updateTask = (
  id: string,
  body: {
    title?: string;
    priority?: Priority;
    status?: TaskStatus;
    due_at?: string | null;
    remind_daily?: boolean;
  }
) => apiPut<Task>(`/activities/tasks/${id}`, body);

export const deleteTask = (id: string) =>
  apiDelete<{ ok: boolean }>(`/activities/tasks/${id}`);
