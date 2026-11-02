import agentsService from "../services/agents.service";
import logger from "../utils/logger";

let running = false;

// Drives the sales agent's automation for every tenant that has opted in:
// enrols fresh signals and advances due sequence touches (drafting the next
// message, auto-sending only when the tenant enabled it). Idempotent per tick
// and re-entrancy-guarded. Scheduled by src/jobs/scheduler.ts.
export async function runSalesAgent(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { enrolled, drafted } = await agentsService.runSalesAutomation(new Date());
    if (enrolled || drafted) {
      logger.info(`sales agent: enrolled ${enrolled}, drafted ${drafted} touch(es)`);
    }
  } catch (err) {
    logger.warn(`sales agent tick failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
