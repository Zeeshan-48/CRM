import type { NotificationItem, NotificationsResponse } from "@/types";
import { apiGet, apiPost } from "./client";

export const getNotifications = () =>
  apiGet<NotificationsResponse>("/notifications");

export const markNotificationRead = (id: string) =>
  apiPost<NotificationItem>(`/notifications/${id}/read`);

export const markAllNotificationsRead = () =>
  apiPost<{ updated: number }>("/notifications/read-all");
