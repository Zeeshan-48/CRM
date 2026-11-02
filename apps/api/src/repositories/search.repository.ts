import { db } from "../db/connection";

const PER_TYPE_LIMIT = 10;

class SearchRepository {
  async search(tenantId: string, q: string) {
    const s = `%${q}%`;
    const [leads, contacts, accounts, deals, tickets] = await Promise.all([
      db
        .selectFrom("leads")
        .select(["id", "name", "city", "source"])
        .where("tenant_id", "=", tenantId)
        .where((eb) =>
          eb.or([
            eb("name", "ilike", s),
            eb("email", "ilike", s),
            eb("phone", "ilike", s),
            eb("city", "ilike", s),
          ])
        )
        .limit(PER_TYPE_LIMIT)
        .execute(),
      db
        .selectFrom("contacts")
        .select(["id", "name", "company", "email"])
        .where("tenant_id", "=", tenantId)
        .where((eb) =>
          eb.or([eb("name", "ilike", s), eb("company", "ilike", s), eb("email", "ilike", s)])
        )
        .limit(PER_TYPE_LIMIT)
        .execute(),
      db
        .selectFrom("accounts")
        .select(["id", "name", "industry"])
        .where("tenant_id", "=", tenantId)
        .where("name", "ilike", s)
        .limit(PER_TYPE_LIMIT)
        .execute(),
      db
        .selectFrom("deals")
        .select(["id", "title", "value"])
        .where("tenant_id", "=", tenantId)
        .where("title", "ilike", s)
        .limit(PER_TYPE_LIMIT)
        .execute(),
      db
        .selectFrom("tickets")
        .select(["id", "subject", "status"])
        .where("tenant_id", "=", tenantId)
        .where("subject", "ilike", s)
        .limit(PER_TYPE_LIMIT)
        .execute(),
    ]);
    return { leads, contacts, accounts, deals, tickets };
  }
}

export default new SearchRepository();
