import { db } from "../db/connection";
import { BadRequestError, NotFoundError } from "../errors";
import dealLineItemsRepository, {
  type DealLineItemRow,
} from "../repositories/deal-line-items.repository";
import productsRepository from "../repositories/products.repository";
import { discountFor, resolvePrice, type OfferLike } from "../utils/catalog-pricing";
import logger from "../utils/logger";
import { formatMoney, minorToMajor, normalizeCurrency, toMinorUnits } from "../utils/money";
import engineService from "./engine.service";

export interface LineItemView {
  id: string;
  deal_id: string;
  product_id: string | null;
  offer_id: string | null;
  name: string;
  quantity: number;
  unit_price_minor: number;
  unit_price_display: string;
  discount_minor: number;
  discount_display: string;
  total_minor: number;
  total_display: string;
  currency: string;
  sort_order: number;
}

const toView = (row: DealLineItemRow): LineItemView => {
  const currency = normalizeCurrency(row.currency);
  return {
    id: row.id,
    deal_id: row.deal_id,
    product_id: row.product_id,
    offer_id: row.offer_id,
    name: row.name,
    quantity: row.quantity,
    unit_price_minor: row.unit_price_minor,
    unit_price_display: formatMoney(row.unit_price_minor, currency),
    discount_minor: row.discount_minor,
    discount_display: formatMoney(row.discount_minor, currency),
    total_minor: row.total_minor,
    total_display: formatMoney(row.total_minor, currency),
    currency,
    sort_order: row.sort_order,
  };
};

/**
 * Line totals. Discount is applied per unit, then multiplied, so a "20% off"
 * offer on quantity 3 discounts all three rather than one.
 */
const lineTotal = (quantity: number, unitPriceMinor: number, discountMinor: number): number =>
  Math.max(0, (unitPriceMinor - discountMinor) * quantity);

/**
 * Products on a deal (Salesforce OpportunityLineItem).
 *
 * Without this, "product integration" never reaches the pipeline: you cannot ask
 * which product a deal is for, or report revenue by product.
 */
class DealLineItemsService {
  async list(tenantId: string, dealId: string) {
    await this.assertDeal(tenantId, dealId);
    const rows = await dealLineItemsRepository.listForDeal(tenantId, dealId);
    const items = rows.map(toView);
    const currency = items[0]?.currency ?? "INR";
    const totalMinor = items.reduce((sum, i) => sum + i.total_minor, 0);

    return {
      items,
      subtotal_minor: items.reduce((sum, i) => sum + i.unit_price_minor * i.quantity, 0),
      discount_minor: items.reduce((sum, i) => sum + i.discount_minor * i.quantity, 0),
      total_minor: totalMinor,
      total_display: formatMoney(totalMinor, currency),
      currency,
    };
  }

  /**
   * Adds a product to a deal.
   *
   * The unit price and any offer discount are resolved SERVER-side from the
   * catalog, not taken from the client, so an agent cannot quietly change what a
   * product costs by editing a request. An explicit `unit_price_minor` override
   * is allowed (negotiated pricing is real) but it is a deliberate field, not a
   * silent default.
   */
  async add(
    tenantId: string,
    actorId: string,
    dealId: string,
    body: Record<string, unknown>
  ) {
    const deal = await this.assertDeal(tenantId, dealId);

    const productId = typeof body.product_id === "string" ? body.product_id : null;
    const quantityRaw = Number(body.quantity ?? 1);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.trunc(quantityRaw) : 1;

    let name = typeof body.name === "string" ? body.name.trim() : "";
    let currency = normalizeCurrency(body.currency ?? deal.currency);
    let unitPrice = toMinorUnits(body.unit_price_minor);
    let discount = 0;
    let offerId: string | null = null;

    if (productId) {
      const product = await productsRepository.findById(productId, tenantId);
      if (!product) throw new NotFoundError("Product not found");
      name = name || product.name;

      if (unitPrice === null) {
        const prices = await productsRepository.pricesFor(tenantId, [productId]);
        const resolved = resolvePrice(
          prices.map((p) => ({
            currency: p.currency,
            amount_minor: p.amount_minor,
            compare_at_minor: p.compare_at_minor,
            billing_period: p.billing_period,
            is_default: p.is_default,
          })),
          currency
        );
        if (!resolved) {
          throw new BadRequestError(
            `"${product.name}" has no published price. Add a price, or set unit_price_minor explicitly.`
          );
        }
        unitPrice = resolved.amount_minor;
        currency = normalizeCurrency(resolved.currency);
      }

      // Apply an offer if one was named, and verify it actually applies to this
      // product rather than trusting the caller.
      const requestedOfferId = typeof body.offer_id === "string" ? body.offer_id : null;
      if (requestedOfferId) {
        const offer = await productsRepository.findOfferById(requestedOfferId, tenantId);
        if (!offer) throw new NotFoundError("Offer not found");
        discount = discountFor(unitPrice, offer as unknown as OfferLike, currency);
        if (discount <= 0) {
          throw new BadRequestError("That offer does not apply to this product");
        }
        offerId = offer.id;
      }
    }

    if (!name) throw new BadRequestError("A line item needs a product or a name");
    if (unitPrice === null) {
      throw new BadRequestError("A line item needs a unit_price_minor or a priced product");
    }

    const row = await dealLineItemsRepository.create({
      tenant_id: tenantId,
      deal_id: dealId,
      product_id: productId,
      offer_id: offerId,
      name: name.slice(0, 300),
      quantity,
      unit_price_minor: unitPrice,
      discount_minor: discount,
      total_minor: lineTotal(quantity, unitPrice, discount),
      currency,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
    });

    await this.syncDealValue(tenantId, dealId);
    engineService.audit(tenantId, actorId, "deal.line_item_added", "deal", dealId, {
      productId,
      name: row.name,
    });

    // Redeeming here rather than at close: the code is spent the moment it is
    // committed to a deal, which is what a capped campaign actually means.
    if (offerId) {
      void productsRepository
        .consumeRedemption(offerId, tenantId)
        .catch((err) => logger.warn(`offer redemption failed: ${String(err)}`));
    }

    return this.list(tenantId, dealId);
  }

  async update(
    tenantId: string,
    actorId: string,
    dealId: string,
    itemId: string,
    body: Record<string, unknown>
  ) {
    await this.assertDeal(tenantId, dealId);
    const existing = await dealLineItemsRepository.findById(itemId, tenantId);
    if (!existing || existing.deal_id !== dealId) throw new NotFoundError("Line item not found");

    const quantityRaw = Number(body.quantity ?? existing.quantity);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.trunc(quantityRaw) : 1;
    const unitPrice = toMinorUnits(body.unit_price_minor) ?? existing.unit_price_minor;
    const discount = toMinorUnits(body.discount_minor) ?? existing.discount_minor;
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 300)
        : existing.name;

    await dealLineItemsRepository.update(itemId, tenantId, {
      name,
      quantity,
      unit_price_minor: unitPrice,
      discount_minor: Math.min(discount, unitPrice),
      total_minor: lineTotal(quantity, unitPrice, Math.min(discount, unitPrice)),
      sort_order: typeof body.sort_order === "number" ? body.sort_order : existing.sort_order,
    });

    await this.syncDealValue(tenantId, dealId);
    engineService.audit(tenantId, actorId, "deal.line_item_updated", "deal", dealId, { itemId });
    return this.list(tenantId, dealId);
  }

  async remove(tenantId: string, actorId: string, dealId: string, itemId: string) {
    await this.assertDeal(tenantId, dealId);
    const deleted = await dealLineItemsRepository.delete(itemId, tenantId);
    if (!deleted) throw new NotFoundError("Line item not found");

    await this.syncDealValue(tenantId, dealId);
    engineService.audit(tenantId, actorId, "deal.line_item_removed", "deal", dealId, { itemId });
    return this.list(tenantId, dealId);
  }

  /**
   * Keeps `deals.value` in step with the line items.
   *
   * Derived WHEN line items exist, and left alone when they do not, so every
   * existing deal and every existing report keeps working exactly as before.
   *
   * This is the one place catalog money (minor units) crosses into the CRM's
   * major-unit world, and it rounds. That is a known, documented seam: see
   * utils/money.minorToMajor and docs/product-integration-plan.md.
   */
  private async syncDealValue(tenantId: string, dealId: string): Promise<void> {
    const items = await dealLineItemsRepository.listForDeal(tenantId, dealId);
    if (!items.length) return;

    const currency = normalizeCurrency(items[0].currency);
    const totalMinor = items.reduce((sum, i) => sum + i.total_minor, 0);

    await db
      .updateTable("deals")
      .set({
        value: minorToMajor(totalMinor, currency),
        currency,
        updated_at: new Date(),
      })
      .where("id", "=", dealId)
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  private async assertDeal(tenantId: string, dealId: string) {
    const deal = await db
      .selectFrom("deals")
      .select(["id", "currency", "value"])
      .where("id", "=", dealId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    if (!deal) throw new NotFoundError("Deal not found");
    return deal;
  }

  /** Revenue by product across won deals. Feeds the analytics dashboard. */
  async revenueByProduct(tenantId: string, days?: number) {
    const since =
      days && Number.isFinite(days) ? new Date(Date.now() - days * 86_400_000) : undefined;
    const rows = await dealLineItemsRepository.revenueByProduct(tenantId, { since });
    return rows.map((r) => ({
      ...r,
      revenue_display: formatMoney(r.revenue_minor, "INR"),
    }));
  }
}

export default new DealLineItemsService();
