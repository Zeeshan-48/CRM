import logger from "../utils/logger";
import { startScheduler, stopScheduler } from "./scheduler";
import { startEventsConsumer, stopEventsConsumer } from "./ses-events.consumer";
import { startInboundConsumer, stopInboundConsumer } from "./ses-inbound.consumer";

// Background work runs on the single jobs worker (the one started with
// RUN_JOBS=true). The recurring sweeps are driven by a durable BullMQ scheduler
//, or an in-process interval fallback when Redis is absent (see scheduler.ts).
// The two SES SQS consumers keep their own durable long-poll lifecycle.
export const startJobs = async (): Promise<void> => {
  startEventsConsumer();
  startInboundConsumer();
  await startScheduler();
  logger.info(`Background jobs started on worker ${process.pid}`);
};

export const stopJobs = async (): Promise<void> => {
  stopEventsConsumer();
  stopInboundConsumer();
  await stopScheduler();
};
