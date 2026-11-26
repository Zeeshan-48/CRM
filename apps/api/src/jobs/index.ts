import logger from "../utils/logger";
import { startLeadImportWorker, stopLeadImportWorker } from "./lead-import.worker";
import { startRecordingWorker, stopRecordingWorker } from "./recording-mirror.worker";
import { startScheduler, stopScheduler } from "./scheduler";
import { startEventsConsumer, stopEventsConsumer } from "./ses-events.consumer";
import { startInboundConsumer, stopInboundConsumer } from "./ses-inbound.consumer";
import {
  startWorkflowDeliveryWorker,
  stopWorkflowDeliveryWorker,
} from "./workflow-delivery.worker";

// Background work runs on the single jobs worker (the one started with
// RUN_JOBS=true). The recurring sweeps are driven by a durable BullMQ scheduler
//, or an in-process interval fallback when Redis is absent (see scheduler.ts).
// Dedicated BullMQ workers handle asynchronous audio mirroring, bulk lead imports,
// and outbound workflow email/WhatsApp delivery.
// The two SES SQS consumers keep their own durable long-poll lifecycle.
export const startJobs = async (): Promise<void> => {
  startEventsConsumer();
  startInboundConsumer();
  await startScheduler();
  await startRecordingWorker();
  await startLeadImportWorker();
  await startWorkflowDeliveryWorker();
  logger.info(`Background jobs & workers started on worker ${process.pid}`);
};

export const stopJobs = async (): Promise<void> => {
  stopEventsConsumer();
  stopInboundConsumer();
  await stopWorkflowDeliveryWorker();
  await stopLeadImportWorker();
  await stopRecordingWorker();
  await stopScheduler();
};
