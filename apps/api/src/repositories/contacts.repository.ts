import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { contact_lifecycle } from "../db/enums";
import type { DB, contacts } from "../db/types";

export type ContactRow = Selectable<contacts>;

export interface ContactsListParams {
  q?: string;
  lifecycle?: contact_lifecycle;
}

export interface CreateContactData {
  tenant_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  account_id?: string | null;
  title?: string | null;
  city?: string | null;
  owner_id?: string | null;
  tags?: string[];
  socials?: Record<string, unknown>;
  lifecycle?: contact_lifecycle;
  converted_from_lead_id?: string | null;
}

export interface UpdateContactData {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  account_id?: string | null;
  title?: string;
  city?: string;
  owner_id?: string | null;
  tags?: string[];
  socials?: Record<string, unknown>;
  lifecycle?: contact_lifecycle;
  last_activity_at?: Date;
}

class ContactsRepository {
  async list(tenantId: string, params: ContactsListParams = {}): Promise<ContactRow[]> {
    let query = db.selectFrom("contacts").selectAll().where("tenant_id", "=", tenantId);
    if (params.lifecycle) query = query.where("lifecycle", "=", params.lifecycle);
    if (params.q) {
      const s = `%${params.q}%`;
      query = query.where((eb) =>
        eb.or([
          eb("name", "ilike", s),
          eb("email", "ilike", s),
          eb("phone", "ilike", s),
          eb("company", "ilike", s),
        ])
      );
    }
    return query.orderBy("created_at", "desc").execute();
  }

  async findById(id: string, tenantId: string): Promise<ContactRow | undefined> {
    return db
      .selectFrom("contacts")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async create(data: CreateContactData, trx?: Transaction<DB>): Promise<ContactRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("contacts")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        email: data.email ?? "",
        phone: data.phone ?? "",
        company: data.company ?? "",
        account_id: data.account_id ?? null,
        title: data.title ?? "",
        city: data.city ?? "",
        owner_id: data.owner_id ?? null,
        tags: JSON.stringify(data.tags ?? []),
        socials: JSON.stringify(data.socials ?? {}),
        lifecycle: data.lifecycle ?? "LEAD",
        converted_from_lead_id: data.converted_from_lead_id ?? null,
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    data: UpdateContactData,
    trx?: Transaction<DB>
  ): Promise<ContactRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    const direct = [
      "name",
      "email",
      "phone",
      "company",
      "account_id",
      "title",
      "city",
      "owner_id",
      "lifecycle",
      "last_activity_at",
    ] as const;
    for (const key of direct) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (data.tags !== undefined) patch.tags = JSON.stringify(data.tags);
    if (data.socials !== undefined) patch.socials = JSON.stringify(data.socials);

    return (trx || db)
      .updateTable("contacts")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("contacts")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  // ---- 360 profile relations ----

  async detailRelations(tenantId: string, contact: ContactRow) {
    const [
      activities,
      tickets,
      conversations,
      messages,
      deals,
      invoices,
      calls,
      meetings,
    ] = await Promise.all([
      db
        .selectFrom("activities")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("contact_id", "=", contact.id)
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("tickets")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("contact_id", "=", contact.id)
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("conversations")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("contact_id", "=", contact.id)
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("messages")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("contact_id", "=", contact.id)
        .orderBy("at", "asc")
        .execute(),
      // Deals linked directly to the contact or to the contact's account.
      db
        .selectFrom("deals")
        .leftJoin("stages", "stages.id", "deals.stage_id")
        .selectAll("deals")
        .select("stages.name as stage_name")
        .where("deals.tenant_id", "=", tenantId)
        .where((eb) => {
          const ors = [eb("deals.contact_id", "=", contact.id)];
          if (contact.account_id) ors.push(eb("deals.account_id", "=", contact.account_id));
          return eb.or(ors);
        })
        .orderBy("deals.created_at", "desc")
        .execute(),
      db
        .selectFrom("invoices")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("contact_id", "=", contact.id)
        .orderBy("created_at", "desc")
        .execute(),
      // Calls made to the contact, including pre-conversion calls on the lead.
      db
        .selectFrom("voice_calls")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where((eb) => {
          const ors = [eb("contact_id", "=", contact.id)];
          if (contact.converted_from_lead_id) {
            ors.push(eb("lead_id", "=", contact.converted_from_lead_id));
          }
          return eb.or(ors);
        })
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("meetings")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("contact_id", "=", contact.id)
        .orderBy("start_at", "desc")
        .execute(),
    ]);

    return {
      activities,
      tickets,
      conversations,
      messages,
      deals,
      invoices,
      calls,
      meetings,
    };
  }
}

export default new ContactsRepository();
