import { Selectable } from "kysely";
import { db } from "../db/connection";
import type { channel as ChannelEnum } from "../db/enums";
import type { conversations, messages } from "../db/types";

export type ConversationRow = Selectable<conversations>;
export type MessageRow = Selectable<messages>;

export interface ConversationListRow extends ConversationRow {
  lead_name: string | null;
  contact_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

class InboxRepository {
  async channelSummary(
    tenantId: string
  ): Promise<Array<{ channel: ChannelEnum; conversations: number; unread: number }>> {
    const rows = await db
      .selectFrom("conversations")
      .select([
        "channel",
        db.fn.count<number>("id").as("conversations"),
        db.fn.sum<number>("unread_count").as("unread"),
      ])
      .where("tenant_id", "=", tenantId)
      .groupBy("channel")
      .execute();
    return rows.map((r) => ({
      channel: r.channel,
      conversations: Number(r.conversations ?? 0),
      unread: Number(r.unread ?? 0),
    }));
  }

  async listConversations(
    tenantId: string,
    channel?: ChannelEnum
  ): Promise<ConversationListRow[]> {
    let query = db
      .selectFrom("conversations")
      .leftJoin("leads", (join) =>
        join
          .onRef("leads.id", "=", "conversations.lead_id")
          .onRef("leads.tenant_id", "=", "conversations.tenant_id")
      )
      .leftJoin("contacts", (join) =>
        join
          .onRef("contacts.id", "=", "conversations.contact_id")
          .onRef("contacts.tenant_id", "=", "conversations.tenant_id")
      )
      .selectAll("conversations")
      .select([
        "leads.name as lead_name",
        "contacts.name as contact_name",
        "leads.email as lead_email",
        "leads.phone as lead_phone",
        "contacts.email as contact_email",
        "contacts.phone as contact_phone",
      ])
      .where("conversations.tenant_id", "=", tenantId);
    if (channel) query = query.where("conversations.channel", "=", channel);
    return query.orderBy("conversations.last_message_at", "desc").execute();
  }

  async findConversation(
    id: string,
    tenantId: string
  ): Promise<ConversationListRow | undefined> {
    return db
      .selectFrom("conversations")
      .leftJoin("leads", (join) =>
        join
          .onRef("leads.id", "=", "conversations.lead_id")
          .onRef("leads.tenant_id", "=", "conversations.tenant_id")
      )
      .leftJoin("contacts", (join) =>
        join
          .onRef("contacts.id", "=", "conversations.contact_id")
          .onRef("contacts.tenant_id", "=", "conversations.tenant_id")
      )
      .selectAll("conversations")
      .select([
        "leads.name as lead_name",
        "contacts.name as contact_name",
        "leads.email as lead_email",
        "leads.phone as lead_phone",
        "contacts.email as contact_email",
        "contacts.phone as contact_phone",
      ])
      .where("conversations.id", "=", id)
      .where("conversations.tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async listMessages(tenantId: string, conversationId: string): Promise<MessageRow[]> {
    return db
      .selectFrom("messages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("conversation_id", "=", conversationId)
      .orderBy("at", "asc")
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async resetUnread(id: string, tenantId: string): Promise<void> {
    await db
      .updateTable("conversations")
      .set({ unread_count: 0, updated_at: new Date() })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .execute();
  }
}

export default new InboxRepository();
