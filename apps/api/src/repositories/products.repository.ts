import { Selectable, Transaction, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, product_offers, product_prices, products } from "../db/types";

export type ProductRow = Selectable<products>;
export type ProductPriceRow = Selectable<product_prices>;
export type ProductOfferRow = Selectable<product_offers>;

export interface ProductFilters {
  q?: string | null;
  appId?: string | null;
  category?: string | null;
  status?: string | null;
  source?: string | null;
  limit?: number;
  offset?: number;
}

export interface UpsertProductData {
  tenant_id: string;
  app_id: string | null;
  external_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  family: string | null;
  url: string | null;
  media: unknown;
  attributes: unknown;
  highlights: string[] | null;
  status: string;
  source: string;
  sort_order: number;
}

export interface UpsertPriceData {
  currency: string;
  amount_minor: number;
  compare_at_minor: number | null;
  billing_period: string;
  price_book: string;
  is_default: boolean;
}

export interface UpsertOfferData {
  tenant_id: string;
  app_id: string | null;
  product_id: string | null;
  code: string | null;
  name: string;
  description: string | null;
  terms: string | null;
  discount_type: string;
  discount_value: number;
  currency: string | null;
  applies_to: unknown;
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  status: string;
}

// PG JSON columns via Kysely take a JSON string. Passing an object double-
// serializes; passing a pre-stringified value again would too. One helper so
// the rule lives in one place.
const asJson = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);

class ProductsRepository {
  // ---- Products ----

  async list(tenantId: string, filters: ProductFilters = {}): Promise<ProductRow[]> {
    let query = db.selectFrom("products").selectAll().where("tenant_id", "=", tenantId);

    if (filters.appId) query = query.where("app_id", "=", filters.appId);
    if (filters.category) query = query.where("category", "=", filters.category);
    if (filters.source) query = query.where("source", "=", filters.source);
    // Default to hiding archived rows: an archived product is history, not
    // something an agent should be pitching.
    query = filters.status
      ? query.where("status", "=", filters.status)
      : query.where("status", "!=", "ARCHIVED");

    if (filters.q) {
      const term = `%${filters.q}%`;
      query = query.where((eb) =>
        eb.or([
          eb("name", "ilike", term),
          eb("description", "ilike", term),
          eb("sku", "ilike", term),
          eb("category", "ilike", term),
        ])
      );
    }

    return query
      .orderBy("sort_order", "asc")
      .orderBy("name", "asc")
      .limit(Math.min(filters.limit ?? 100, 200))
      .offset(filters.offset ?? 0)
      .execute();
  }

  async count(tenantId: string, filters: ProductFilters = {}): Promise<number> {
    let query = db
      .selectFrom("products")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId);

    if (filters.appId) query = query.where("app_id", "=", filters.appId);
    if (filters.category) query = query.where("category", "=", filters.category);
    if (filters.source) query = query.where("source", "=", filters.source);
    query = filters.status
      ? query.where("status", "=", filters.status)
      : query.where("status", "!=", "ARCHIVED");
    if (filters.q) {
      const term = `%${filters.q}%`;
      query = query.where((eb) =>
        eb.or([
          eb("name", "ilike", term),
          eb("description", "ilike", term),
          eb("sku", "ilike", term),
          eb("category", "ilike", term),
        ])
      );
    }

    const row = await query.executeTakeFirst();
    // Kysely surfaces PostgreSQL bigint as a string; parse before arithmetic.
    const raw = row?.count;
    return typeof raw === "string" ? parseInt(raw, 10) : Number(raw ?? 0);
  }

  async findById(
    id: string,
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<ProductRow | undefined> {
    return (trx || db)
      .selectFrom("products")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findByExternalId(
    tenantId: string,
    appId: string,
    externalId: string,
    trx?: Transaction<DB>
  ): Promise<ProductRow | undefined> {
    return (trx || db)
      .selectFrom("products")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("external_id", "=", externalId)
      .executeTakeFirst();
  }

  async listCategories(tenantId: string): Promise<string[]> {
    const rows = await db
      .selectFrom("products")
      .select("category")
      .distinct()
      .where("tenant_id", "=", tenantId)
      .where("category", "is not", null)
      .where("status", "!=", "ARCHIVED")
      .orderBy("category", "asc")
      .execute();
    return rows.map((r) => r.category).filter((c): c is string => !!c);
  }

  async create(data: UpsertProductData, trx?: Transaction<DB>): Promise<ProductRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("products")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        app_id: data.app_id,
        external_id: data.external_id,
        sku: data.sku,
        name: data.name,
        description: data.description,
        category: data.category,
        family: data.family,
        url: data.url,
        media: asJson(data.media),
        attributes: asJson(data.attributes),
        highlights: asJson(data.highlights),
        status: data.status,
        source: data.source,
        sort_order: data.sort_order,
        total_sales: 0,
        synced_at: data.source === "SYNCED" ? now : null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    patch: Partial<Omit<UpsertProductData, "tenant_id">>,
    trx?: Transaction<DB>
  ): Promise<ProductRow | undefined> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    const direct: Array<keyof typeof patch> = [
      "sku",
      "name",
      "description",
      "category",
      "family",
      "url",
      "status",
      "sort_order",
      "external_id",
    ];
    for (const key of direct) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.media !== undefined) set.media = asJson(patch.media);
    if (patch.attributes !== undefined) set.attributes = asJson(patch.attributes);
    if (patch.highlights !== undefined) set.highlights = asJson(patch.highlights);

    return (trx || db)
      .updateTable("products")
      .set(set)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /** Marks a synced product as freshly seen, without touching its content. */
  async touchSynced(id: string, trx?: Transaction<DB>): Promise<void> {
    const now = new Date();
    await (trx || db)
      .updateTable("products")
      .set({ synced_at: now, updated_at: now })
      .where("id", "=", id)
      .execute();
  }

  /**
   * REPLACE-mode cleanup: archives synced products the feed no longer lists.
   *
   * ARCHIVES rather than deletes, deliberately. A deleted product would orphan
   * the deal line items and events that reference it, destroying history because
   * a producer had one bad sync. Archived rows disappear from the catalog UI but
   * every reference still resolves.
   */
  async archiveMissing(
    tenantId: string,
    appId: string,
    keepIds: string[],
    trx?: Transaction<DB>
  ): Promise<number> {
    let query = (trx || db)
      .updateTable("products")
      .set({ status: "ARCHIVED", updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("source", "=", "SYNCED")
      .where("status", "!=", "ARCHIVED");

    if (keepIds.length) query = query.where("id", "not in", keepIds);

    const result = await query.executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    // Prices are owned by the product; nothing else in the schema is, so this
    // is the full cascade.
    await db
      .deleteFrom("product_prices")
      .where("tenant_id", "=", tenantId)
      .where("product_id", "=", id)
      .execute();
    const result = await db
      .deleteFrom("products")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  // ---- Prices ----

  /** Batch load for a product list. One query, no N+1 across the catalog page. */
  async pricesFor(
    tenantId: string,
    productIds: string[],
    trx?: Transaction<DB>
  ): Promise<ProductPriceRow[]> {
    if (!productIds.length) return [];
    return (trx || db)
      .selectFrom("product_prices")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("product_id", "in", productIds)
      .execute();
  }

  // ---- Bulk paths used by catalog sync ----
  //
  // A 500-product feed done row-by-row would be ~2000 round trips inside one
  // transaction. These collapse the price side to two statements and the insert
  // side to one, which is the difference between a sync that takes seconds and
  // one that holds a transaction open long enough to matter.

  async listByApp(
    tenantId: string,
    appId: string,
    trx?: Transaction<DB>
  ): Promise<ProductRow[]> {
    return (trx || db)
      .selectFrom("products")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .execute();
  }

  async createMany(
    rows: UpsertProductData[],
    trx?: Transaction<DB>
  ): Promise<ProductRow[]> {
    if (!rows.length) return [];
    const now = new Date();
    return (trx || db)
      .insertInto("products")
      .values(
        rows.map((data) => ({
          id: ulid(),
          tenant_id: data.tenant_id,
          app_id: data.app_id,
          external_id: data.external_id,
          sku: data.sku,
          name: data.name,
          description: data.description,
          category: data.category,
          family: data.family,
          url: data.url,
          media: asJson(data.media),
          attributes: asJson(data.attributes),
          highlights: asJson(data.highlights),
          status: data.status,
          source: data.source,
          sort_order: data.sort_order,
          total_sales: 0,
          synced_at: data.source === "SYNCED" ? now : null,
          created_at: now,
          updated_at: now,
        }))
      )
      .returningAll()
      .execute();
  }

  async deletePricesForProducts(
    tenantId: string,
    productIds: string[],
    trx?: Transaction<DB>
  ): Promise<void> {
    if (!productIds.length) return;
    await (trx || db)
      .deleteFrom("product_prices")
      .where("tenant_id", "=", tenantId)
      .where("product_id", "in", productIds)
      .execute();
  }

  async insertPricesBulk(
    tenantId: string,
    rows: Array<UpsertPriceData & { product_id: string }>,
    trx?: Transaction<DB>
  ): Promise<void> {
    if (!rows.length) return;
    const now = new Date();
    await (trx || db)
      .insertInto("product_prices")
      .values(
        rows.map((p) => ({
          id: ulid(),
          tenant_id: tenantId,
          product_id: p.product_id,
          price_book: p.price_book,
          currency: p.currency,
          amount_minor: p.amount_minor,
          compare_at_minor: p.compare_at_minor,
          billing_period: p.billing_period,
          is_default: p.is_default,
          created_at: now,
          updated_at: now,
        }))
      )
      .execute();
  }

  /**
   * Replaces a product's whole price set in one transaction.
   *
   * Replace rather than merge: a feed that drops a currency means that currency
   * is no longer offered, and leaving the stale row would keep quoting a price
   * the product will not honour.
   */
  async replacePrices(
    tenantId: string,
    productId: string,
    prices: UpsertPriceData[],
    trx?: Transaction<DB>
  ): Promise<void> {
    const run = async (t: Transaction<DB>) => {
      await t
        .deleteFrom("product_prices")
        .where("tenant_id", "=", tenantId)
        .where("product_id", "=", productId)
        .execute();
      if (!prices.length) return;

      const now = new Date();
      await t
        .insertInto("product_prices")
        .values(
          prices.map((p) => ({
            id: ulid(),
            tenant_id: tenantId,
            product_id: productId,
            price_book: p.price_book,
            currency: p.currency,
            amount_minor: p.amount_minor,
            compare_at_minor: p.compare_at_minor,
            billing_period: p.billing_period,
            is_default: p.is_default,
            created_at: now,
            updated_at: now,
          }))
        )
        .execute();
    };

    if (trx) return run(trx);
    return db.transaction().execute(run);
  }

  // ---- Offers ----

  async listOffers(
    tenantId: string,
    filters: { appId?: string | null; productId?: string | null; includeInactive?: boolean } = {}
  ): Promise<ProductOfferRow[]> {
    let query = db.selectFrom("product_offers").selectAll().where("tenant_id", "=", tenantId);
    if (filters.appId) query = query.where("app_id", "=", filters.appId);
    if (filters.productId) query = query.where("product_id", "=", filters.productId);
    if (!filters.includeInactive) query = query.where("status", "!=", "DISABLED");
    return query.orderBy("created_at", "desc").execute();
  }

  /**
   * Offers that could apply to any product right now: not disabled, and either
   * open-ended or not yet expired. The precise window and applies_to test is a
   * pure function (utils/catalog-pricing), so this only narrows the rows the
   * resolver has to consider.
   */
  async listCandidateOffers(tenantId: string, appId?: string | null): Promise<ProductOfferRow[]> {
    let query = db
      .selectFrom("product_offers")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "!=", "DISABLED")
      .where((eb) => eb.or([eb("ends_at", "is", null), eb("ends_at", ">=", new Date())]));
    if (appId) query = query.where("app_id", "=", appId);
    return query.execute();
  }

  async findOfferById(
    id: string,
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<ProductOfferRow | undefined> {
    return (trx || db)
      .selectFrom("product_offers")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async findOfferByCode(
    tenantId: string,
    appId: string | null,
    code: string,
    trx?: Transaction<DB>
  ): Promise<ProductOfferRow | undefined> {
    let query = (trx || db)
      .selectFrom("product_offers")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("code", "=", code);
    query = appId ? query.where("app_id", "=", appId) : query.where("app_id", "is", null);
    return query.executeTakeFirst();
  }

  async createOffer(data: UpsertOfferData, trx?: Transaction<DB>): Promise<ProductOfferRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("product_offers")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        app_id: data.app_id,
        product_id: data.product_id,
        code: data.code,
        name: data.name,
        description: data.description,
        terms: data.terms,
        discount_type: data.discount_type,
        discount_value: data.discount_value,
        currency: data.currency,
        applies_to: asJson(data.applies_to),
        starts_at: data.starts_at,
        ends_at: data.ends_at,
        max_redemptions: data.max_redemptions,
        redemptions_used: 0,
        status: data.status,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateOffer(
    id: string,
    tenantId: string,
    patch: Partial<Omit<UpsertOfferData, "tenant_id">>,
    trx?: Transaction<DB>
  ): Promise<ProductOfferRow | undefined> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    const direct: Array<keyof typeof patch> = [
      "app_id",
      "product_id",
      "code",
      "name",
      "description",
      "terms",
      "discount_type",
      "discount_value",
      "currency",
      "starts_at",
      "ends_at",
      "max_redemptions",
      "status",
    ];
    for (const key of direct) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.applies_to !== undefined) set.applies_to = asJson(patch.applies_to);

    return (trx || db)
      .updateTable("product_offers")
      .set(set)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteOffer(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("product_offers")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  /**
   * Atomic redemption increment. Uses a conditional UPDATE rather than
   * read-modify-write so two cluster workers cannot both slip past the cap.
   * Returns false when the offer is already exhausted.
   */
  async consumeRedemption(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .updateTable("product_offers")
      .set((eb) => ({ redemptions_used: eb("redemptions_used", "+", 1), updated_at: new Date() }))
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where((eb) =>
        eb.or([
          eb("max_redemptions", "is", null),
          eb("max_redemptions", "<=", 0),
          sql<boolean>`"redemptions_used" < "max_redemptions"`,
        ])
      )
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0) > 0;
  }

  /** Deletes every catalog row owned by one connected app. */
  async deleteForApp(tenantId: string, appId: string): Promise<void> {
    await db.transaction().execute(async (trx) => {
      const ids = await trx
        .selectFrom("products")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("app_id", "=", appId)
        .execute();
      const productIds = ids.map((r) => r.id);
      if (productIds.length) {
        await trx
          .deleteFrom("product_prices")
          .where("tenant_id", "=", tenantId)
          .where("product_id", "in", productIds)
          .execute();
      }
      await trx
        .deleteFrom("product_offers")
        .where("tenant_id", "=", tenantId)
        .where("app_id", "=", appId)
        .execute();
      await trx
        .deleteFrom("products")
        .where("tenant_id", "=", tenantId)
        .where("app_id", "=", appId)
        .execute();
    });
  }
}

export default new ProductsRepository();
