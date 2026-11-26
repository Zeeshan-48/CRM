import { Worker } from "bullmq";
import { createQueueConnection, isQueueEnabled } from "../queue/connection";
import {
  WORKFLOW_DELIVERY_QUEUE_NAME,
  type WorkflowDeliveryJobData,
  closeWorkflowDeliveryQueue,
} from "../queue/workflow-delivery.queue";
import engineService from "../services/engine.service";
import logger from "../utils/logger";

let worker: Worker | null = null;
const CONCURRENCY = 5;

export const startWorkflowDeliveryWorker = async (): Promise<void> => {
  if (!isQueueEnabled()) {
    logger.info("[workflow-delivery-worker] Queue disabled; workflow delivery worker idle");
    return;
  }

  worker = new Worker<WorkflowDeliveryJobData>(
    WORKFLOW_DELIVERY_QUEUE_NAME,
    async (job) => {
      await engineService.processQueuedDelivery(job.data);
    },
    {
      connection: createQueueConnection(),
      concurrency: CONCURRENCY,
    }
  );

  worker.on("failed", (job, err) => {
    logger.warn(
      `[workflow-delivery-worker] Job ${job?.data?.kind ?? "?"} failed (attempt ${job?.attemptsMade ?? 0}): ${err.message}`
    );
  });

  worker.on("error", (err) => {
    logger.warn(`[workflow-delivery-worker] Worker error: ${err.message}`);
  });

  logger.info(
    `[workflow-delivery-worker] Started BullMQ workflow delivery worker (concurrency=${CONCURRENCY})`
  );
};

export const stopWorkflowDeliveryWorker = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await closeWorkflowDeliveryQueue();
};
