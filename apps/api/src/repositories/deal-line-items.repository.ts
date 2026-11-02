import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, deal_line_items } from "../db/types";

export type DealLineItemRow = Selectable<deal_line_items>;

export interface CreateLineItemData {
  tenant_id: string;
  deal_id: string;
  product_id: string | null;
  offer_id: string | null;
  name: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  total_minor: number;
  currency: string;
  sort_order: number;
}

class DealLineItemsRepository {
  async listForDeal(
    tenantId: string,
    dealId: string,
    trx?: Transaction<DB>
  ): Promise<DealLineItemRow[]> {
    return (trx || db)
      .selectFrom("deal_line_items")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("deal_id", "=", dealId)
      .orderBy("sort_order", "asc")
      .orderBy("created_at", "asc")
      .execute();
  }

  /** Batch load for a pipeline view: one query, no N+1 across a board. */
  async listForDeals(tenantId: string, dealIds: string[]): Promise<DealLineItemRow[]> {
    if (!dealIds.length) return [];
    return db
      .selectFrom("deal_line_items")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("deal_id", "in", dealIds)
      .execute();
  }

  async findById(
    id: string,
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<DealLineItemRow | undefined> {
    return (trx || db)
      .selectFrom("deal_line_items")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async create(data: CreateLineItemData, trx?: Transaction<DB>): Promise<DealLineItemRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("deal_line_items")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        deal_id: data.deal_id,
        product_id: data.product_id,
        offer_id: data.offer_id,
        name: data.name,
        quantity: data.quantity,
        unit_price_minor: data.unit_price_minor,
        discount_minor: data.discount_minor,
        total_minor: data.total_minor,
        currency: data.currency,
        sort_order: data.sort_order,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    patch: Partial<Omit<CreateLineItemData, "tenant_id" | "deal_id">>,
    trx?: Transaction<DB>
  ): Promise<DealLineItemRow | undefined> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    for (const key of [
      "product_id",
      "offer_id",
      "name",
      "quantity",
      "unit_price_minor",
      "discount_minor",
      "total_minor",
      "currency",
      "sort_order",
    ] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }

    return (trx || db)
      .updateTable("deal_line_items")
      .set(set)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("deal_line_items")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  /** Revenue by product across won deals, for analytics. */
  async revenueByProduct(
    tenantId: string,
    options: { since?: Date; limit?: number } = {}
  ): Promise<
    Array<{ product_id: string | null; name: string; units: number; revenue_minor: number; deals: number }>
  > {
    let query = db
      .selectFrom("deal_line_items")
      .innerJoin("deals", "deals.id", "deal_line_items.deal_id")
      .where("deal_line_items.tenant_id", "=", tenantId)
      .where("deals.status", "=", "WON");
    if (options.since) query = query.where("deals.closed_at", ">=", options.since);

    const rows = await query
      .select((eb) => [
        "deal_line_items.product_id as product_id",
        "deal_line_items.name as name",
        eb.fn.sum<string>("deal_line_items.quantity").as("units"),
        eb.fn.sum<string>("deal_line_items.total_minor").as("revenue_minor"),
        eb.fn.count<string>("deal_line_items.deal_id").distinct().as("deals"),
      ])
      .groupBy(["deal_line_items.product_id", "deal_line_items.name"])
      .orderBy("revenue_minor", "desc")
      .limit(Math.min(100, Math.max(1, options.limit ?? 25)))
      .execute();

    // Kysely surfaces PostgreSQL bigint and numeric aggregates as strings.
    const num = (v: unknown): number =>
      typeof v === "string" ? parseInt(v, 10) : Number(v ?? 0);

    return rows.map((r) => ({
      product_id: r.product_id,
      name: r.name,
      units: num(r.units),
      revenue_minor: num(r.revenue_minor),
      deals: num(r.deals),
    }));
  }
}

export default new DealLineItemsRepository();
