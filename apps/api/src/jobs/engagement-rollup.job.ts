import engagementRepository from "../repositories/engagement.repository";
import engagementService from "../services/engagement.service";
import logger from "../utils/logger";

// How stale a rollup may get before the sweep refreshes it.
//
// This sweep exists because intent DECAYS with time, not just with events. A
// lead who was HOT last week and has done nothing since must cool down on their
// own, and no incoming event will trigger that recompute precisely because
// nothing is happening. Without the sweep the signals feed would fill up with
// leads who went quiet a month ago.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

// Bounded per tick. Each profile is a couple of indexed queries, and the sweep
// runs often enough that a large workspace still converges quickly.
const MAX_PER_TICK = 200;

export const runEngagementRollup = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await engagementRepository.listStale(cutoff, MAX_PER_TICK);
  if (!stale.length) return;

  let refreshed = 0;
  for (const profile of stale) {
    try {
      await engagementService.recompute(profile.tenant_id, profile.id);
      refreshed += 1;
    } catch (err) {
      // One bad profile must not stop the sweep for everyone else.
      logger.warn(`engagement-rollup: profile ${profile.id} failed: ${String(err)}`);
    }
  }

  logger.info(`engagement-rollup: refreshed ${refreshed}/${stale.length} profile(s)`);
};
