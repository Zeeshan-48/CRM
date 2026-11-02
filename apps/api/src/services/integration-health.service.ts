import { deriveAppHealth, parseCapabilities } from "../constants/connected-apps.const";
import { NotFoundError } from "../errors";
import activityEventsRepository from "../repositories/activity-events.repository";
import connectedAppsRepository from "../repositories/connected-apps.repository";
import eventDefinitionsRepository from "../repositories/event-definitions.repository";
import productsRepository from "../repositories/products.repository";

export interface IntegrationHealthReport {
  app: { key: string; name: string; environment: string; status: string };
  health: string;
  health_detail: string | null;
  last_event_at: Date | null;
  last_catalog_sync_at: Date | null;
  events_24h: number;
  catalog: { products: number; offers: number };
  event_definitions: { total: number; needs_review: number };
  warnings: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Self-service diagnostics for an integrating team.
 *
 * The point is that a developer wiring this up can answer "is my integration
 * working?" without opening a support ticket or asking us to check a log. Every
 * warning names a concrete next action rather than just describing a state.
 */
class IntegrationHealthService {
  async report(tenantId: string, appId: string): Promise<IntegrationHealthReport> {
    const app = await connectedAppsRepository.findByIdUnscoped(appId);
    if (!app || app.tenant_id !== tenantId) {
      throw new NotFoundError("Connected product not found");
    }

    const since = new Date(Date.now() - DAY_MS);
    const [counts, definitions, needsReview, products, offers] = await Promise.all([
      activityEventsRepository.healthCounts(tenantId, appId, since),
      eventDefinitionsRepository.listForApp(tenantId, appId),
      eventDefinitionsRepository.countNeedingReview(tenantId, appId),
      productsRepository.count(tenantId, { appId }),
      productsRepository.listOffers(tenantId, { appId }),
    ]);

    const { health, detail } = deriveAppHealth(app);
    const capabilities = parseCapabilities(app.capabilities);
    const warnings: string[] = [];

    if (!app.last_event_at) {
      warnings.push(
        "No events received yet. Send a test event to POST /ingest/events with your secret key."
      );
    }

    if (counts.orphaned > 0) {
      warnings.push(
        `${counts.orphaned} event(s) in the last 24h had no identity we could match. ` +
          "Call POST /ingest/identify with an email so they attach to a person."
      );
    }

    if (counts.rejected > 0) {
      warnings.push(
        `${counts.rejected} event(s) in the last 24h were rejected. Check the payload inspector in the CRM.`
      );
    }

    if (needsReview > 0) {
      warnings.push(
        `${needsReview} event name(s) were auto-registered and are awaiting review. ` +
          "They are stored but do not affect lead scoring until an admin activates them."
      );
    }

    if (capabilities.catalog && products === 0) {
      warnings.push(
        "This product declares a catalog but none is published. PUT your products to /ingest/catalog."
      );
    }

    if (app.catalog_mode === "PULL" && !app.catalog_pull_url) {
      warnings.push("Catalog mode is PULL but no feed URL is configured.");
    }

    if (app.environment === "TEST") {
      warnings.push(
        "This product is in TEST mode. Events are stored and visible but do not affect lead scoring."
      );
    }

    return {
      app: {
        key: app.key,
        name: app.name,
        environment: app.environment,
        status: app.status,
      },
      health,
      health_detail: detail,
      last_event_at: app.last_event_at,
      last_catalog_sync_at: app.last_catalog_sync_at,
      events_24h: counts.total,
      catalog: { products, offers: offers.length },
      event_definitions: { total: definitions.length, needs_review: needsReview },
      warnings,
    };
  }
}

export default new IntegrationHealthService();
