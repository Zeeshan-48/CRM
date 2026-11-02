import reputationService from "../services/reputation.service";
import logger from "../utils/logger";

// Sweeps to recover email sending reputation. Scheduled by scheduler.ts.
export async function runReputationRecovery(): Promise<void> {
  try {
    await reputationService.recoverAll();
  } catch (err) {
    logger.warn(`reputation recovery sweep failed: ${String(err)}`);
  }
}
