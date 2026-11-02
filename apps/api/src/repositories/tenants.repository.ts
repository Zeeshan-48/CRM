import { Selectable } from "kysely";
import { db } from "../db/connection";
import type { tenants } from "../db/types";

export type TenantRow = Selectable<tenants>;

class TenantsRepository {
  async findById(id: string): Promise<TenantRow | undefined> {
    return db.selectFrom("tenants").selectAll().where("id", "=", id).executeTakeFirst();
  }

  // Active tenant by slug, used by the PUBLIC booking page to resolve which
  // workspace a `/book/:tenantSlug/...` URL belongs to. Only ACTIVE tenants are
  // bookable (a suspended/cancelled workspace should not accept new meetings).
  async findActiveBySlug(slug: string): Promise<TenantRow | undefined> {
    return db
      .selectFrom("tenants")
      .selectAll()
      .where("slug", "=", slug)
      .where("status", "=", "ACTIVE")
      .executeTakeFirst();
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      brand_color: string;
      domain: string | null;
      email_domain: string | null;
      white_label: boolean;
      config: Record<string, unknown> | null;
    }>
  ): Promise<TenantRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.brand_color !== undefined) patch.brand_color = data.brand_color;
    if (data.domain !== undefined) patch.domain = data.domain;
    if (data.email_domain !== undefined) patch.email_domain = data.email_domain;
    if (data.white_label !== undefined) patch.white_label = data.white_label;
    if (data.config !== undefined) {
      patch.config = data.config ? JSON.stringify(data.config) : null;
    }
    return db
      .updateTable("tenants")
      .set(patch)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async usage(tenantId: string) {
    const [usersCount, leadsCount, contactsCount, dealsCount, openDealValue] = await Promise.all([
      this.count("users", tenantId),
      this.count("leads", tenantId),
      this.count("contacts", tenantId),
      this.count("deals", tenantId),
      db
        .selectFrom("deals")
        .select(db.fn.sum<number>("value").as("total"))
        .where("tenant_id", "=", tenantId)
        .where("status", "=", "OPEN")
        .executeTakeFirst()
        .then((r) => Number(r?.total ?? 0)),
    ]);
    return {
      users: usersCount,
      leads: leadsCount,
      contacts: contactsCount,
      deals: dealsCount,
      openDealValue,
    };
  }

  private async count(
    table: "users" | "leads" | "contacts" | "deals",
    tenantId: string
  ): Promise<number> {
    const row = await db
      .selectFrom(table)
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async listActivePlans() {
    return db
      .selectFrom("plans")
      .select(["key", "name", "description", "price_monthly", "currency", "modules", "limits"])
      .where("is_active", "=", true)
      .orderBy("sort_order", "asc")
      .execute();
  }
}

export default new TenantsRepository();
