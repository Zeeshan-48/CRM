import { Worker } from "bullmq";
import { createQueueConnection, isQueueEnabled } from "../queue/connection";
import { RECORDINGS_QUEUE_NAME, type RecordingJobData, closeRecordingsQueue } from "../queue/recordings.queue";
import telephonyService from "../services/telephony.service";
import logger from "../utils/logger";

let worker: Worker | null = null;
const CONCURRENCY = 3;

export const startRecordingWorker = async (): Promise<void> => {
  if (!isQueueEnabled()) {
    logger.info("[recording-worker] Queue disabled; recording mirror worker idle");
    return;
  }

  worker = new Worker<RecordingJobData>(
    RECORDINGS_QUEUE_NAME,
    async (job) => {
      const { tenantId, callId, provider } = job.data;
      logger.info(
        `[recording-worker] Processing recording download: call=${callId}, tenant=${tenantId}, provider=${provider ?? "unknown"} (attempt ${job.attemptsMade + 1})`
      );

      const res = await telephonyService.recordingUrl(tenantId, callId);
      if (!res.url) {
        throw new Error(`Recording audio file not yet downloadable for call ${callId}`);
      }

      logger.info(`[recording-worker] Call ${callId} audio successfully mirrored and ready: ${res.url}`);
    },
    {
      connection: createQueueConnection(),
      concurrency: CONCURRENCY,
    }
  );

  worker.on("failed", (job, err) => {
    logger.warn(
      `[recording-worker] Job failed for call ${job?.data?.callId ?? "?"} (attempt ${job?.attemptsMade ?? 0}): ${err.message}`
    );
  });

  worker.on("error", (err) => {
    logger.warn(`[recording-worker] Worker error: ${err.message}`);
  });

  logger.info(`[recording-worker] Started BullMQ recording mirror worker (concurrency=${CONCURRENCY})`);
};

export const stopRecordingWorker = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await closeRecordingsQueue();
};
