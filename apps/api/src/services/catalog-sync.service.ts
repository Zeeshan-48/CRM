import { db } from "../db/connection";
import { BadRequestError } from "../errors";
import connectedAppsRepository from "../repositories/connected-apps.repository";
import productsRepository, {
  type UpsertPriceData,
  type UpsertProductData,
} from "../repositories/products.repository";
import { guardedFetch } from "../utils/http-guard";
import logger from "../utils/logger";
import {
  CatalogMappingError,
  mapOffers,
  mapProducts,
  type MappedOffer,
  type MappedProduct,
} from "./catalog-mapping";
import engineService from "./engine.service";

export interface CatalogSyncContext {
  tenantId: string;
  appId: string;
  actorId: string | null;
}

export interface CatalogSyncResult {
  ok: true;
  mode: string;
  received: number;
  created: number;
  updated: number;
  archived: number;
}

export interface OfferSyncResult {
  ok: true;
  received: number;
  created: number;
  updated: number;
  skipped: number;
}

// A catalog feed is legitimately bigger than a status payload, so raise the
// guarded fetch cap for PULL mode. Still bounded (guardedFetch hard-caps at 8MB)
// and still SSRF-guarded, timeout-capped and redirect-blocked.
const PULL_MAX_BYTES = 8_000_000;
const PULL_TIMEOUT_MS = 20_000;

const toRow = (
  tenantId: string,
  appId: string,
  p: MappedProduct
): UpsertProductData => ({
  tenant_id: tenantId,
  app_id: appId,
  external_id: p.external_id,
  sku: p.sku,
  name: p.name,
  description: p.description,
  category: p.category,
  family: p.family,
  url: p.url,
  media: p.media,
  attributes: p.attributes,
  highlights: p.highlights,
  status: p.status,
  source: "SYNCED",
  sort_order: p.sort_order,
});

class CatalogSyncService {
  /**
   * Upserts a product catalog from a connected app.
   *
   * Keyed on `external_id` within (tenant, app), so a producer can re-send the
   * same feed forever and converge rather than duplicate.
   *
   * REPLACE mode ARCHIVES products missing from the payload; it never deletes
   * them. A deleted product would orphan the deal line items and events that
   * reference it, destroying sales history because a feed had one bad run.
   *
   * The whole sync runs in one transaction: a half-applied REPLACE would archive
   * products that the same payload was about to restore.
   */
  async syncProducts(ctx: CatalogSyncContext, body: unknown): Promise<CatalogSyncResult> {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const mode = String(payload.mode ?? "UPSERT").toUpperCase();
    if (mode !== "UPSERT" && mode !== "REPLACE") {
      throw new BadRequestError("mode must be UPSERT or REPLACE");
    }

    let mapped: MappedProduct[];
    try {
      mapped = mapProducts(payload.products);
    } catch (err) {
      // Mapping errors are the producer's fault and name the exact field, so
      // surface them verbatim as a 400 rather than as an opaque failure.
      if (err instanceof CatalogMappingError) throw new BadRequestError(err.message);
      throw err;
    }

    const result = await db.transaction().execute(async (trx) => {
      const existing = await productsRepository.listByApp(ctx.tenantId, ctx.appId, trx);
      const byExternalId = new Map(
        existing.filter((r) => r.external_id).map((r) => [r.external_id as string, r])
      );

      const toCreate: UpsertProductData[] = [];
      const touchedIds: string[] = [];
      const pricesByExternalId = new Map<string, MappedProduct["prices"]>();

      for (const product of mapped) {
        pricesByExternalId.set(product.external_id, product.prices);
        const current = byExternalId.get(product.external_id);
        if (!current) {
          toCreate.push(toRow(ctx.tenantId, ctx.appId, product));
          continue;
        }
        // A product that was archived by a previous REPLACE and has reappeared
        // in the feed comes back with its history and references intact.
        await productsRepository.update(
          current.id,
          ctx.tenantId,
          { ...toRow(ctx.tenantId, ctx.appId, product) },
          trx
        );
        await productsRepository.touchSynced(current.id, trx);
        touchedIds.push(current.id);
      }

      const created = await productsRepository.createMany(toCreate, trx);
      for (const row of created) touchedIds.push(row.id);

      // Prices are replaced wholesale, not merged: a currency the feed stopped
      // listing is a currency the product no longer honours, and leaving the
      // stale row would keep quoting a price that bounces at checkout.
      const idByExternalId = new Map<string, string>();
      for (const row of [...existing, ...created]) {
        if (row.external_id) idByExternalId.set(row.external_id, row.id);
      }

      const priceRows: Array<UpsertPriceData & { product_id: string }> = [];
      for (const [externalId, prices] of pricesByExternalId) {
        const productId = idByExternalId.get(externalId);
        if (!productId) continue;
        for (const price of prices) priceRows.push({ ...price, product_id: productId });
      }

      const repricedIds = Array.from(pricesByExternalId.keys())
        .map((e) => idByExternalId.get(e))
        .filter((id): id is string => !!id);
      await productsRepository.deletePricesForProducts(ctx.tenantId, repricedIds, trx);
      await productsRepository.insertPricesBulk(ctx.tenantId, priceRows, trx);

      let archived = 0;
      if (mode === "REPLACE") {
        archived = await productsRepository.archiveMissing(
          ctx.tenantId,
          ctx.appId,
          touchedIds,
          trx
        );
      }

      return {
        created: created.length,
        updated: mapped.length - created.length,
        archived,
      };
    });

    // Instrumentation only: never awaited inside the business transaction.
    connectedAppsRepository
      .touchCatalogSync(ctx.appId)
      .catch((err) => logger.warn(`catalog sync stamp failed: ${String(err)}`));
    engineService.audit(ctx.tenantId, ctx.actorId, "catalog.synced", "connected_app", ctx.appId, {
      mode,
      ...result,
    });

    return { ok: true, mode, received: mapped.length, ...result };
  }

  /**
   * Upserts offers and coupons for a connected app.
   *
   * Coupons are keyed on `code` within (tenant, app). Codeless offers have no
   * natural key, so they are matched on name to keep a repeated feed idempotent
   * rather than accumulating duplicates every run.
   */
  async syncOffers(ctx: CatalogSyncContext, body: unknown): Promise<OfferSyncResult> {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    let mapped: MappedOffer[];
    try {
      mapped = mapOffers(payload.offers);
    } catch (err) {
      if (err instanceof CatalogMappingError) throw new BadRequestError(err.message);
      throw err;
    }

    const products = await productsRepository.listByApp(ctx.tenantId, ctx.appId);
    const idByExternalId = new Map(
      products.filter((p) => p.external_id).map((p) => [p.external_id as string, p.id])
    );

    const existing = await productsRepository.listOffers(ctx.tenantId, {
      appId: ctx.appId,
      includeInactive: true,
    });
    const byCode = new Map(
      existing.filter((o) => o.code).map((o) => [(o.code as string).toLowerCase(), o])
    );
    const byName = new Map(existing.filter((o) => !o.code).map((o) => [o.name.toLowerCase(), o]));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const offer of mapped) {
      // External product ids the producer used are meaningless to the CRM until
      // they are resolved to our own ids. Unknown ones are dropped rather than
      // silently widening the offer to the whole catalog.
      const resolvedIds = offer.external_product_ids
        .map((e) => idByExternalId.get(e))
        .filter((id): id is string => !!id);

      // A single-product offer is stored on product_id; a multi-product one goes
      // through applies_to. Both are read by the same pure resolver.
      const singleProductId = resolvedIds.length === 1 ? resolvedIds[0] : null;
      const appliesTo =
        resolvedIds.length > 1 || offer.applies_to
          ? {
              product_ids: resolvedIds.length > 1 ? resolvedIds : [],
              categories: offer.applies_to?.categories ?? [],
            }
          : null;

      // The producer scoped this offer to products we have never seen. Applying
      // it would make it workspace-wide, which is the opposite of the intent.
      if (offer.external_product_ids.length && !resolvedIds.length) {
        skipped += 1;
        continue;
      }

      const data = {
        tenant_id: ctx.tenantId,
        app_id: ctx.appId,
        product_id: singleProductId,
        code: offer.code,
        name: offer.name,
        description: offer.description,
        terms: offer.terms,
        discount_type: offer.discount_type,
        discount_value: offer.discount_value,
        currency: offer.currency,
        applies_to: appliesTo,
        starts_at: offer.starts_at,
        ends_at: offer.ends_at,
        max_redemptions: offer.max_redemptions,
        status: offer.status,
      };

      const match = offer.code
        ? byCode.get(offer.code.toLowerCase())
        : byName.get(offer.name.toLowerCase());

      if (match) {
        await productsRepository.updateOffer(match.id, ctx.tenantId, data);
        updated += 1;
      } else {
        await productsRepository.createOffer(data);
        created += 1;
      }
    }

    connectedAppsRepository
      .touchCatalogSync(ctx.appId)
      .catch((err) => logger.warn(`offer sync stamp failed: ${String(err)}`));
    engineService.audit(ctx.tenantId, ctx.actorId, "catalog.offers_synced", "connected_app", ctx.appId, {
      created,
      updated,
      skipped,
    });

    return { ok: true, received: mapped.length, created, updated, skipped };
  }

  /**
   * PULL mode: the CRM fetches the app's feed instead of waiting to be pushed.
   * Used by the catalog-pull sweep. Records a health error on the app rather
   * than throwing, because a background sweep has nobody to throw to.
   */
  async pullCatalog(tenantId: string, appId: string, url: string): Promise<void> {
    try {
      const res = await guardedFetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        maxBytes: PULL_MAX_BYTES,
        timeoutMs: PULL_TIMEOUT_MS,
      });
      if (!res.ok) {
        await connectedAppsRepository.setHealth(appId, "ERROR", `Catalog feed returned ${res.status}`);
        return;
      }
      if (!res.json || typeof res.json !== "object") {
        await connectedAppsRepository.setHealth(appId, "ERROR", "Catalog feed did not return JSON");
        return;
      }

      const body = res.json as Record<string, unknown>;
      await this.syncProducts(
        { tenantId, appId, actorId: null },
        { mode: body.mode ?? "REPLACE", products: body.products }
      );
      if (Array.isArray(body.offers)) {
        await this.syncOffers({ tenantId, appId, actorId: null }, { offers: body.offers });
      }
      await connectedAppsRepository.setHealth(appId, "OK", null);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "catalog pull failed";
      logger.warn(`catalog pull failed for app ${appId}: ${reason}`);
      await connectedAppsRepository
        .setHealth(appId, "ERROR", reason.slice(0, 500))
        .catch(() => undefined);
    }
  }
}

export default new CatalogSyncService();
