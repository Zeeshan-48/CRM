import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import connectedAppsRepository from "../repositories/connected-apps.repository";
import productsRepository, {
  type ProductOfferRow,
  type ProductPriceRow,
  type ProductRow,
} from "../repositories/products.repository";
import {
  resolveOffersForProduct,
  resolvePrice,
  savingsPercent,
  type PriceLike,
} from "../utils/catalog-pricing";
import { DEFAULT_CURRENCY, formatMoney, normalizeCurrency, toMinorUnits } from "../utils/money";
import { CatalogMappingError, mapOffer, mapPrices, mapProduct } from "./catalog-mapping";
import engineService from "./engine.service";

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

export interface PriceView {
  currency: string;
  amount_minor: number;
  amount_display: string;
  compare_at_minor: number | null;
  compare_at_display: string | null;
  savings_percent: number;
  billing_period: string;
  is_default: boolean;
}

export interface OfferView {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  terms: string | null;
  discount_type: string;
  discount_value: number;
  discount_minor: number;
  discount_display: string;
  final_minor: number;
  final_display: string;
  days_left: number | null;
  ends_at: Date | null;
  redemptions_left: number | null;
}

export interface ProductView {
  id: string;
  app_id: string | null;
  app_name: string | null;
  external_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  family: string | null;
  url: string | null;
  media: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
  highlights: string[];
  status: string;
  source: string;
  /** SYNCED products are owned by the external system and read-only in the CRM. */
  editable: boolean;
  total_sales: number;
  synced_at: Date | null;
  price: PriceView | null;
  prices: PriceView[];
  offers: OfferView[];
  best_offer: OfferView | null;
  created_at: Date;
  updated_at: Date;
}

const toPriceView = (p: ProductPriceRow | PriceLike): PriceView => {
  const currency = normalizeCurrency(p.currency);
  return {
    currency,
    amount_minor: p.amount_minor,
    amount_display: formatMoney(p.amount_minor, currency),
    compare_at_minor: p.compare_at_minor,
    compare_at_display:
      p.compare_at_minor !== null ? formatMoney(p.compare_at_minor, currency) : null,
    savings_percent: savingsPercent(p as PriceLike),
    billing_period: p.billing_period,
    is_default: p.is_default,
  };
};

class ProductsService {
  // ---- Reads ----

  /**
   * Catalog list for the agent panel: products with their resolved price and
   * every live offer that applies.
   *
   * Prices and offers are batch-loaded once for the whole page rather than per
   * product. A 100-product catalog would otherwise be 200 extra queries, which
   * is the difference between a panel that opens instantly and one an agent
   * stops using.
   */
  async list(
    tenantId: string,
    filters: {
      q?: string;
      appId?: string;
      category?: string;
      status?: string;
      source?: string;
      currency?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const [rows, total, apps] = await Promise.all([
      productsRepository.list(tenantId, filters),
      productsRepository.count(tenantId, filters),
      connectedAppsRepository.list(tenantId),
    ]);

    const productIds = rows.map((r) => r.id);
    const [prices, offers] = await Promise.all([
      productsRepository.pricesFor(tenantId, productIds),
      productsRepository.listCandidateOffers(tenantId, filters.appId ?? null),
    ]);

    const appNames = new Map(apps.map((a) => [a.id, a.name]));
    const pricesByProduct = new Map<string, ProductPriceRow[]>();
    for (const price of prices) {
      const list = pricesByProduct.get(price.product_id) ?? [];
      list.push(price);
      pricesByProduct.set(price.product_id, list);
    }

    const items = rows.map((row) =>
      this.buildView(row, pricesByProduct.get(row.id) ?? [], offers, appNames, filters.currency)
    );

    return { items, total, limit: Math.min(filters.limit ?? 100, 200), offset: filters.offset ?? 0 };
  }

  async get(tenantId: string, id: string, currency?: string): Promise<ProductView> {
    const row = await productsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Product not found");

    const [prices, offers, apps] = await Promise.all([
      productsRepository.pricesFor(tenantId, [id]),
      productsRepository.listCandidateOffers(tenantId, row.app_id),
      connectedAppsRepository.list(tenantId),
    ]);

    return this.buildView(row, prices, offers, new Map(apps.map((a) => [a.id, a.name])), currency);
  }

  async categories(tenantId: string): Promise<string[]> {
    return productsRepository.listCategories(tenantId);
  }

  private buildView(
    row: ProductRow,
    priceRows: ProductPriceRow[],
    offerRows: ProductOfferRow[],
    appNames: Map<string, string>,
    currency?: string
  ): ProductView {
    const priceLikes: PriceLike[] = priceRows.map((p) => ({
      id: p.id,
      currency: p.currency,
      amount_minor: p.amount_minor,
      compare_at_minor: p.compare_at_minor,
      billing_period: p.billing_period,
      is_default: p.is_default,
      price_book: p.price_book,
    }));

    const resolved = resolvePrice(priceLikes, currency ?? null);
    const productLike = { id: row.id, category: row.category };

    const applicable = resolveOffersForProduct(
      offerRows.map((o) => ({
        id: o.id,
        code: o.code,
        name: o.name,
        discount_type: o.discount_type,
        discount_value: o.discount_value,
        currency: o.currency,
        applies_to: o.applies_to,
        product_id: o.product_id,
        starts_at: o.starts_at,
        ends_at: o.ends_at,
        max_redemptions: o.max_redemptions,
        redemptions_used: o.redemptions_used,
        status: o.status,
      })),
      productLike,
      resolved
    );

    const offerCurrency = resolved ? normalizeCurrency(resolved.currency) : "INR";
    const offers: OfferView[] = applicable.map((r) => {
      const source = offerRows.find((o) => o.id === r.offer.id);
      const cap = source?.max_redemptions ?? null;
      return {
        id: String(r.offer.id),
        code: r.offer.code,
        name: r.offer.name ?? "",
        description: source?.description ?? null,
        terms: source?.terms ?? null,
        discount_type: r.offer.discount_type,
        discount_value: r.offer.discount_value,
        discount_minor: r.discount_minor,
        discount_display: formatMoney(r.discount_minor, offerCurrency),
        final_minor: r.final_minor,
        final_display: formatMoney(r.final_minor, offerCurrency),
        days_left: r.days_left,
        ends_at: source?.ends_at ?? null,
        redemptions_left:
          cap && cap > 0 ? Math.max(0, cap - (source?.redemptions_used ?? 0)) : null,
      };
    });

    return {
      id: row.id,
      app_id: row.app_id,
      app_name: row.app_id ? (appNames.get(row.app_id) ?? null) : null,
      external_id: row.external_id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      category: row.category,
      family: row.family,
      url: row.url,
      media: parseJson<Record<string, unknown> | null>(row.media, null),
      attributes: parseJson<Record<string, unknown> | null>(row.attributes, null),
      highlights: parseJson<string[]>(row.highlights, []),
      status: row.status,
      source: row.source,
      editable: row.source === "MANUAL",
      total_sales: row.total_sales,
      synced_at: row.synced_at,
      price: resolved ? toPriceView(resolved) : null,
      prices: priceLikes.map(toPriceView),
      offers,
      best_offer: offers[0] ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // ---- Manual (CRM-native) products ----

  /**
   * Guards every write path. A SYNCED product is owned by the external system:
   * editing it in the CRM would be silently reverted on the next sync, which is
   * worse than refusing, because the agent would believe the change stuck.
   */
  private assertEditable(row: ProductRow): void {
    if (row.source !== "MANUAL") {
      throw new ForbiddenError(
        "This product is synced from a connected product and is read-only here. Edit it in the source system."
      );
    }
  }

  async createManual(tenantId: string, actorId: string, body: Record<string, unknown>) {
    // Reuse the producer mapper so a manually created product is validated by
    // exactly the same rules as a synced one, rather than a parallel ruleset
    // that drifts.
    let mapped;
    try {
      mapped = mapProduct({ ...body, external_id: body.external_id ?? `manual_${Date.now()}` }, 0);
    } catch (err) {
      if (err instanceof CatalogMappingError) throw new BadRequestError(err.message);
      throw err;
    }

    const row = await productsRepository.create({
      tenant_id: tenantId,
      app_id: null,
      external_id: null, // CRM-native rows have no external identity
      sku: mapped.sku,
      name: mapped.name,
      description: mapped.description,
      category: mapped.category,
      family: mapped.family,
      url: mapped.url,
      media: mapped.media,
      attributes: mapped.attributes,
      highlights: mapped.highlights,
      status: mapped.status,
      source: "MANUAL",
      sort_order: mapped.sort_order,
    });

    if (mapped.prices.length) {
      await productsRepository.replacePrices(tenantId, row.id, mapped.prices);
    }

    engineService.audit(tenantId, actorId, "product.created", "product", row.id, {
      name: row.name,
    });
    return this.get(tenantId, row.id);
  }

  async updateManual(
    tenantId: string,
    actorId: string,
    id: string,
    body: Record<string, unknown>
  ) {
    const existing = await productsRepository.findById(id, tenantId);
    if (!existing) throw new NotFoundError("Product not found");
    this.assertEditable(existing);

    let mapped;
    try {
      mapped = mapProduct(
        {
          external_id: "manual",
          name: body.name ?? existing.name,
          ...body,
        },
        0
      );
    } catch (err) {
      if (err instanceof CatalogMappingError) throw new BadRequestError(err.message);
      throw err;
    }

    await productsRepository.update(id, tenantId, {
      sku: mapped.sku,
      name: mapped.name,
      description: mapped.description,
      category: mapped.category,
      family: mapped.family,
      url: mapped.url,
      media: mapped.media,
      attributes: mapped.attributes,
      highlights: mapped.highlights,
      status: mapped.status,
      sort_order: mapped.sort_order,
    });

    if (body.prices !== undefined) {
      await productsRepository.replacePrices(tenantId, id, mapped.prices);
    }

    engineService.audit(tenantId, actorId, "product.updated", "product", id);
    return this.get(tenantId, id);
  }

  async setPrices(tenantId: string, actorId: string, id: string, body: Record<string, unknown>) {
    const existing = await productsRepository.findById(id, tenantId);
    if (!existing) throw new NotFoundError("Product not found");
    this.assertEditable(existing);

    let prices;
    try {
      prices = mapPrices(body.prices, existing.name);
    } catch (err) {
      if (err instanceof CatalogMappingError) throw new BadRequestError(err.message);
      throw err;
    }

    await productsRepository.replacePrices(tenantId, id, prices);
    engineService.audit(tenantId, actorId, "product.prices_updated", "product", id, {
      count: prices.length,
    });
    return this.get(tenantId, id);
  }

  async removeManual(tenantId: string, actorId: string, id: string) {
    const existing = await productsRepository.findById(id, tenantId);
    if (!existing) throw new NotFoundError("Product not found");
    this.assertEditable(existing);

    await productsRepository.delete(id, tenantId);
    engineService.audit(tenantId, actorId, "product.deleted", "product", id, {
      name: existing.name,
    });
    return { ok: true };
  }

  // ---- Offers ----

  async listOffers(tenantId: string, filters: { appId?: string; productId?: string } = {}) {
    const rows = await productsRepository.listOffers(tenantId, {
      appId: filters.appId ?? null,
      productId: filters.productId ?? null,
      includeInactive: true,
    });
    return rows.map((o) => ({
      ...o,
      applies_to: parseJson<Record<string, unknown> | null>(o.applies_to, null),
      redemptions_left:
        o.max_redemptions && o.max_redemptions > 0
          ? Math.max(0, o.max_redemptions - o.redemptions_used)
          : null,
      // Pre-formatted so every money string in the UI comes from one formatter.
      // A FLAT discount_value is MINOR units; the offers list used to divide it by
      // 100 in the page and print "Flat 5000.00 INR off" instead of "₹5,000".
      discount_display:
        o.discount_type === "PERCENT"
          ? `${o.discount_value}% off`
          : `${formatMoney(o.discount_value, o.currency ?? DEFAULT_CURRENCY)} off`,
    }));
  }

  async createOffer(tenantId: string, actorId: string, body: Record<string, unknown>) {
    let mapped;
    try {
      mapped = mapOffer(body, 0);
    } catch (err) {
      if (err instanceof CatalogMappingError) throw new BadRequestError(err.message);
      throw err;
    }

    if (mapped.code) {
      const clash = await productsRepository.findOfferByCode(tenantId, null, mapped.code);
      if (clash) throw new ConflictError(`The coupon code "${mapped.code}" already exists`);
    }

    const productId = typeof body.product_id === "string" ? body.product_id : null;
    if (productId) {
      const product = await productsRepository.findById(productId, tenantId);
      if (!product) throw new NotFoundError("Product not found");
    }

    const row = await productsRepository.createOffer({
      tenant_id: tenantId,
      app_id: null,
      product_id: productId,
      code: mapped.code,
      name: mapped.name,
      description: mapped.description,
      terms: mapped.terms,
      discount_type: mapped.discount_type,
      discount_value: mapped.discount_value,
      currency: mapped.currency,
      applies_to: mapped.applies_to,
      starts_at: mapped.starts_at,
      ends_at: mapped.ends_at,
      max_redemptions: mapped.max_redemptions,
      status: mapped.status,
    });

    engineService.audit(tenantId, actorId, "offer.created", "offer", row.id, { code: row.code });
    return row;
  }

  async updateOffer(
    tenantId: string,
    actorId: string,
    id: string,
    body: Record<string, unknown>
  ) {
    const existing = await productsRepository.findOfferById(id, tenantId);
    if (!existing) throw new NotFoundError("Offer not found");
    if (existing.app_id) {
      throw new ForbiddenError(
        "This offer is synced from a connected product and is read-only here."
      );
    }

    let mapped;
    try {
      mapped = mapOffer({ ...existing, ...body }, 0);
    } catch (err) {
      if (err instanceof CatalogMappingError) throw new BadRequestError(err.message);
      throw err;
    }

    const updated = await productsRepository.updateOffer(id, tenantId, {
      code: mapped.code,
      name: mapped.name,
      description: mapped.description,
      terms: mapped.terms,
      discount_type: mapped.discount_type,
      discount_value: mapped.discount_value,
      currency: mapped.currency,
      applies_to: mapped.applies_to,
      starts_at: mapped.starts_at,
      ends_at: mapped.ends_at,
      max_redemptions: mapped.max_redemptions,
      status: mapped.status,
    });
    if (!updated) throw new NotFoundError("Offer not found");

    engineService.audit(tenantId, actorId, "offer.updated", "offer", id);
    return updated;
  }

  async removeOffer(tenantId: string, actorId: string, id: string) {
    const existing = await productsRepository.findOfferById(id, tenantId);
    if (!existing) throw new NotFoundError("Offer not found");
    if (existing.app_id) {
      throw new ForbiddenError(
        "This offer is synced from a connected product and is read-only here."
      );
    }
    await productsRepository.deleteOffer(id, tenantId);
    engineService.audit(tenantId, actorId, "offer.deleted", "offer", id, { code: existing.code });
    return { ok: true };
  }

  /**
   * Validates a coupon code an agent typed against a specific product, and
   * returns what it is actually worth. Used by the catalog panel and by the
   * deal line-item builder so both agree on the number.
   */
  async validateCoupon(tenantId: string, productId: string, code: string, currency?: string) {
    const trimmed = String(code || "").trim();
    if (!trimmed) throw new BadRequestError("Enter a coupon code");

    const product = await this.get(tenantId, productId, currency);
    const match = product.offers.find(
      (o) => o.code && o.code.toLowerCase() === trimmed.toLowerCase()
    );
    if (!match) {
      // Deliberately one message for "no such code", "expired" and "does not
      // apply to this product": all three mean the same thing to the agent, and
      // enumerating which would leak the offer catalog.
      return { valid: false as const, reason: "That code is not valid for this product right now." };
    }
    return { valid: true as const, offer: match, product_id: productId };
  }

  // ---- Amount helper used by the deal line-item builder ----

  /** Resolves the unit price a line item should use for a product. */
  async unitPriceFor(
    tenantId: string,
    productId: string,
    currency?: string
  ): Promise<{ amount_minor: number; currency: string } | null> {
    const prices = await productsRepository.pricesFor(tenantId, [productId]);
    if (!prices.length) return null;
    const resolved = resolvePrice(
      prices.map((p) => ({
        currency: p.currency,
        amount_minor: p.amount_minor,
        compare_at_minor: p.compare_at_minor,
        billing_period: p.billing_period,
        is_default: p.is_default,
      })),
      currency ?? null
    );
    if (!resolved) return null;
    return {
      amount_minor: toMinorUnits(resolved.amount_minor) ?? 0,
      currency: normalizeCurrency(resolved.currency),
    };
  }
}

export default new ProductsService();
