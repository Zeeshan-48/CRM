// MUST be first: pg serializes Date objects with local getters, so the whole
// process is pinned to UTC before anything imports pg.
process.env.TZ = "UTC";

import cluster, { Worker } from "cluster";
import os from "os";
import app from "./app";
import config, { assertProductionConfig } from "./config";
import { closeDB, waitForDBConnection } from "./db/connection";
import { closeRedis } from "./db/redis";
import { startJobs, stopJobs } from "./jobs";
import logger from "./utils/logger";

assertProductionConfig();

const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 10;
const SHUTDOWN_TIMEOUT_MS = 30_000;

const startMaster = (): void => {
  const numWorkers = config.isProduction ? os.cpus().length : 1;
  logger.info(`Master ${process.pid}: forking ${numWorkers} worker(s)`);

  let shuttingDown = false;
  const restartTimestamps: number[] = [];

  // Exactly one worker owns the background jobs (events consumer + pollers).
  let jobsWorkerId: number | null = null;
  const forkWorker = (withJobs: boolean): void => {
    const worker = cluster.fork(withJobs ? { RUN_JOBS: "true" } : {});
    if (withJobs) jobsWorkerId = worker.id;
  };

  for (let i = 0; i < numWorkers; i++) forkWorker(i === 0);

  cluster.on("exit", (worker: Worker, code: number, signal: string) => {
    if (shuttingDown) return;
    const wasJobsWorker = worker.id === jobsWorkerId;
    const now = Date.now();
    while (restartTimestamps.length && now - restartTimestamps[0] > RESTART_WINDOW_MS) {
      restartTimestamps.shift();
    }
    if (restartTimestamps.length >= MAX_RESTARTS_PER_WINDOW) {
      logger.error(
        `Worker ${worker.process.pid} died (code ${code}, signal ${signal}) but restart budget is exhausted; not restarting`
      );
      return;
    }
    restartTimestamps.push(now);
    logger.warn(
      `Worker ${worker.process.pid} died (code ${code}, signal ${signal}); restarting`
    );
    // Preserve the jobs role if the worker that owned it died.
    forkWorker(wasJobsWorker);
  });

  const shutdownMaster = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Master ${process.pid}: ${signal} received; signalling workers`);
    for (const id of Object.keys(cluster.workers ?? {})) {
      cluster.workers?.[id]?.process.kill(signal);
    }
  };
  process.on("SIGTERM", () => shutdownMaster("SIGTERM"));
  process.on("SIGINT", () => shutdownMaster("SIGINT"));
};

const startWorker = async (): Promise<void> => {
  process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
    // Client disconnects mid-response are not fatal.
    if (err.code === "EPIPE" || err.code === "ECONNRESET") {
      logger.warn(`Ignored socket error: ${err.code}`);
      return;
    }
    logger.error(`uncaughtException: ${err.stack ?? err.message}`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(`unhandledRejection: ${String(reason)}`);
  });

  await waitForDBConnection();

  const port = Number(config.PORT);
  const server = app.listen(port, () => {
    logger.info(`Worker ${process.pid} listening on :${port} (${config.NODE_ENV})`);
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Only the worker forked with RUN_JOBS runs the background jobs.
  if (process.env.RUN_JOBS === "true") void startJobs();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Worker ${process.pid}: ${signal} received; draining connections`);

    const forceTimer = setTimeout(() => {
      logger.error(`Worker ${process.pid}: forced shutdown after ${SHUTDOWN_TIMEOUT_MS}ms`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    if (process.env.RUN_JOBS === "true") await stopJobs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeRedis();
    await closeDB();
    logger.info(`Worker ${process.pid}: graceful shutdown complete`);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

if (cluster.isPrimary) {
  startMaster();
} else {
  void startWorker();
}
