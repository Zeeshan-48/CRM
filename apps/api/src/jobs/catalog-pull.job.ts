import connectedAppsRepository from "../repositories/connected-apps.repository";
import catalogSyncService from "../services/catalog-sync.service";
import logger from "../utils/logger";

// How stale a PULL-mode catalog may get before the sweep refetches it. The job
// itself runs more often than this so a newly configured app is picked up
// promptly rather than waiting a full interval.
const PULL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Bounded per tick so one sweep can never fan out to hundreds of outbound
// requests at once. Apps are ordered by oldest sync first, so nothing starves.
const MAX_PER_TICK = 10;

/**
 * Refetches the catalog for connected products configured in PULL mode.
 *
 * Sequential rather than parallel on purpose: these are outbound calls to
 * tenant-controlled endpoints, each already timeout- and size-capped, and a
 * background sweep has no deadline. Serialising keeps the blast radius of a slow
 * feed to one worker slot instead of ten.
 *
 * pullCatalog never throws: it records the failure on the app's health so a
 * broken feed shows up in the integration console rather than only in the logs.
 */
export const runCatalogPull = async (): Promise<void> => {
  const apps = await connectedAppsRepository.listPullable(MAX_PER_TICK * 3);
  if (!apps.length) return;

  const now = Date.now();
  const due = apps
    .filter((app) => {
      if (!app.catalog_pull_url) return false;
      if (!app.last_catalog_sync_at) return true;
      return now - new Date(app.last_catalog_sync_at).getTime() >= PULL_INTERVAL_MS;
    })
    .slice(0, MAX_PER_TICK);

  if (!due.length) return;

  logger.info(`catalog-pull: refreshing ${due.length} feed(s)`);
  for (const app of due) {
    await catalogSyncService.pullCatalog(app.tenant_id, app.id, app.catalog_pull_url as string);
  }
};
