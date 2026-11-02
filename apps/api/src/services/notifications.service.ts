import { NotFoundError } from "../errors";
import notificationsRepository from "../repositories/notifications.repository";

class NotificationsService {
  async list(tenantId: string, userId: string) {
    const [notifications, unread] = await Promise.all([
      notificationsRepository.listForUser(tenantId, userId),
      notificationsRepository.unreadCount(tenantId, userId),
    ]);
    return { unread, notifications };
  }

  async markRead(tenantId: string, userId: string, notificationId: string) {
    const updated = await notificationsRepository.markRead(notificationId, tenantId, userId);
    if (!updated) throw new NotFoundError("Notification not found");
    return updated;
  }

  async markAllRead(tenantId: string, userId: string) {
    const updated = await notificationsRepository.markAllRead(tenantId, userId);
    return { ok: true, updated };
  }
}

export default new NotificationsService();
