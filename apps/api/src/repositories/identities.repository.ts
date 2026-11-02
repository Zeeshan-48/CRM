import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { app_identities, DB } from "../db/types";

export type IdentityRow = Selectable<app_identities>;

export const IDENTITY_TYPES = ["EXTERNAL_USER_ID", "EMAIL", "PHONE", "ANONYMOUS_ID"] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

export interface IdentityInput {
  type: IdentityType;
  value: string;
}

class IdentitiesRepository {
  async find(
    tenantId: string,
    appId: string,
    type: IdentityType,
    value: string,
    trx?: Transaction<DB>
  ): Promise<IdentityRow | undefined> {
    return (trx || db)
      .selectFrom("app_identities")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("identity_type", "=", type)
      .where("identity_value", "=", value)
      .executeTakeFirst();
  }

  /**
   * Looks up several identities at once and returns the first that already
   * resolves to a person. Order matters and is the caller's: an explicit
   * external user id is stronger evidence than an email, which is stronger than
   * an anonymous cookie.
   */
  async findFirstResolved(
    tenantId: string,
    appId: string,
    identities: IdentityInput[],
    trx?: Transaction<DB>
  ): Promise<IdentityRow | undefined> {
    for (const identity of identities) {
      const row = await this.find(tenantId, appId, identity.type, identity.value, trx);
      if (row && (row.lead_id || row.contact_id)) return row;
    }
    return undefined;
  }

  /**
   * Records an identity and binds it to a person.
   *
   * Upsert rather than insert: the same anonymous id arrives on every page view,
   * and the same email arrives on every identify call. Re-binding an already
   * bound identity to a DIFFERENT person is allowed (a shared browser, a
   * corrected email) and simply moves the pointer.
   */
  async upsert(
    data: {
      tenant_id: string;
      app_id: string;
      identity_type: IdentityType;
      identity_value: string;
      lead_id: string | null;
      contact_id: string | null;
    },
    trx?: Transaction<DB>
  ): Promise<IdentityRow> {
    const now = new Date();
    const executor = trx || db;

    const inserted = await executor
      .insertInto("app_identities")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        app_id: data.app_id,
        identity_type: data.identity_type,
        identity_value: data.identity_value,
        lead_id: data.lead_id,
        contact_id: data.contact_id,
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
      })
      .onConflict((oc) =>
        oc
          .columns(["tenant_id", "app_id", "identity_type", "identity_value"])
          .doUpdateSet((eb) => ({
            last_seen_at: now,
            // COALESCE so a later call that omits the binding never CLEARS one
            // that an earlier call established.
            lead_id: eb.fn.coalesce(eb.val(data.lead_id), eb.ref("app_identities.lead_id")),
            contact_id: eb.fn.coalesce(
              eb.val(data.contact_id),
              eb.ref("app_identities.contact_id")
            ),
          }))
      )
      .returningAll()
      .executeTakeFirst();

    if (inserted) return inserted;

    const existing = await this.find(
      data.tenant_id,
      data.app_id,
      data.identity_type,
      data.identity_value,
      trx
    );
    if (!existing) throw new Error("failed to upsert identity");
    return existing;
  }

  /** Every identity currently pointing at a person, for the record UI. */
  async listForPerson(
    tenantId: string,
    person: { leadId?: string | null; contactId?: string | null }
  ): Promise<IdentityRow[]> {
    if (!person.leadId && !person.contactId) return [];
    let query = db.selectFrom("app_identities").selectAll().where("tenant_id", "=", tenantId);
    query = person.leadId
      ? query.where("lead_id", "=", person.leadId)
      : query.where("contact_id", "=", person.contactId as string);
    return query.execute();
  }

  /**
   * Repoints every identity of one person at another. Used when a lead converts
   * to a contact, so the product history follows the person rather than being
   * stranded on the retired lead record.
   */
  async movePerson(
    tenantId: string,
    from: { leadId: string },
    to: { contactId: string },
    trx?: Transaction<DB>
  ): Promise<number> {
    const result = await (trx || db)
      .updateTable("app_identities")
      .set({ contact_id: to.contactId })
      .where("tenant_id", "=", tenantId)
      .where("lead_id", "=", from.leadId)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }

  /**
   * Binds every so-far-unbound identity sharing an anonymous id to a person.
   * This is the anonymous-to-known stitch: the moment a visitor identifies
   * themselves, their earlier browsing stops being anonymous.
   */
  async bindAnonymous(
    tenantId: string,
    appId: string,
    anonymousId: string,
    person: { leadId: string | null; contactId: string | null },
    trx?: Transaction<DB>
  ): Promise<void> {
    await (trx || db)
      .updateTable("app_identities")
      .set({ lead_id: person.leadId, contact_id: person.contactId, last_seen_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("identity_type", "=", "ANONYMOUS_ID")
      .where("identity_value", "=", anonymousId)
      .execute();
  }

  /**
   * Drops every identity bound to a deleted person.
   *
   * Without this, an identity keeps pointing at a lead that no longer exists, so
   * every future event for that person resolves to a corpse: the product keeps
   * sending, the API keeps returning 201, and nothing ever appears in the CRM.
   */
  async deleteForPerson(
    tenantId: string,
    person: { leadId?: string | null; contactId?: string | null },
    trx?: Transaction<DB>
  ): Promise<void> {
    if (!person.leadId && !person.contactId) return;
    let query = (trx || db).deleteFrom("app_identities").where("tenant_id", "=", tenantId);
    query = person.leadId
      ? query.where("lead_id", "=", person.leadId)
      : query.where("contact_id", "=", person.contactId as string);
    await query.execute();
  }

  async deleteForApp(tenantId: string, appId: string): Promise<void> {
    await db
      .deleteFrom("app_identities")
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .execute();
  }
}

export default new IdentitiesRepository();
