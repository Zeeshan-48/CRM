import { Queue, Worker } from "bullmq";
import {
  closeQueueConnections,
  createQueueConnection,
  isQueueEnabled,
} from "../queue/connection";
import logger from "../utils/logger";
import { SCHEDULED_JOBS, type ScheduledJob } from "./registry";

// One queue holds every recurring sweep as a BullMQ *job scheduler* (repeatable
// job). The schedule lives in Redis, so it survives process restarts and fires
// each tick exactly once even across multiple worker nodes, the durability +
// single-node fix. Worker concurrency runs several distinct sweeps in parallel;
// each handler's own re-entrancy guard prevents a slow sweep from overlapping
// itself.
const QUEUE_NAME = "crm-jobs";
const CONCURRENCY = 4;

let queue: Queue | null = null;
let worker: Worker | null = null;
const intervals: NodeJS.Timeout[] = [];

const runSafely = async (job: ScheduledJob): Promise<void> => {
  try {
    await job.handler();
  } catch (err) {
    logger.warn(`job ${job.name} failed: ${String(err)}`);
  }
};

// Starts the durable BullMQ scheduler when Redis is available; otherwise falls
// back to in-process setInterval timers (dev without Redis, and under tests),
// preserving the original behaviour. Returns the backend actually used.
export const startScheduler = async (): Promise<"bullmq" | "interval"> => {
  if (!isQueueEnabled()) {
    for (const job of SCHEDULED_JOBS) {
      const timer = setInterval(() => void runSafely(job), job.everyMs);
      timer.unref();
      intervals.push(timer);
    }
    logger.info(`Background jobs: interval fallback (${SCHEDULED_JOBS.length} jobs, no Redis)`);
    return "interval";
  }

  const byName = new Map(SCHEDULED_JOBS.map((j) => [j.name, j]));
  queue = new Queue(QUEUE_NAME, {
    connection: createQueueConnection(),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
  });

  // Upsert one repeatable scheduler per job, idempotent by id, so this is safe
  // to run on every boot.
  for (const job of SCHEDULED_JOBS) {
    await queue.upsertJobScheduler(job.name, { every: job.everyMs }, { name: job.name });
  }

  // Drop schedulers left behind by renamed/removed jobs so Redis stays in sync
  // with the registry.
  const existing = await queue.getJobSchedulers();
  for (const s of existing) {
    if (s.key && !byName.has(s.key)) {
      await queue.removeJobScheduler(s.key);
      logger.info(`Removed orphaned job scheduler "${s.key}"`);
    }
  }

  worker = new Worker(
    QUEUE_NAME,
    async (bullJob) => {
      const job = byName.get(bullJob.name);
      if (job) await job.handler();
    },
    { connection: createQueueConnection(), concurrency: CONCURRENCY }
  );
  worker.on("failed", (bullJob, err) =>
    logger.warn(`job ${bullJob?.name ?? "?"} failed: ${err.message}`)
  );
  worker.on("error", (err) => logger.warn(`job worker error: ${err.message}`));

  logger.info(`Background jobs: BullMQ scheduler (${SCHEDULED_JOBS.length} repeatable jobs)`);
  return "bullmq";
};

export const stopScheduler = async (): Promise<void> => {
  for (const timer of intervals) clearInterval(timer);
  intervals.length = 0;
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  await closeQueueConnections();
};
