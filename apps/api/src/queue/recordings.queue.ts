import { Queue } from "bullmq";
import { createQueueConnection, isQueueEnabled } from "./connection";
import telephonyService from "../services/telephony.service";
import logger from "../utils/logger";

export const RECORDINGS_QUEUE_NAME = "crm-recordings";

export interface RecordingJobData {
  tenantId: string;
  callId: string;
  provider?: string;
  recordingUrl: string;
}

let recordingsQueue: Queue | null = null;

export const getRecordingsQueue = (): Queue => {
  if (!recordingsQueue) {
    recordingsQueue = new Queue(RECORDINGS_QUEUE_NAME, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        attempts: 4,
        backoff: {
          type: "exponential",
          delay: 4000,
        },
        removeOnComplete: true,
        removeOnFail: 200,
      },
    });
  }
  return recordingsQueue;
};

export const enqueueRecordingDownload = async (data: RecordingJobData): Promise<void> => {
  if (!isQueueEnabled()) {
    // When Redis is disabled (e.g. dev/test mode), mirror asynchronously in-process
    void telephonyService.recordingUrl(data.tenantId, data.callId).catch((err) => {
      logger.warn(`Direct recording mirror failed for call ${data.callId}: ${String(err)}`);
    });
    return;
  }

  try {
    const queue = getRecordingsQueue();
    // Unique job ID by callId so we never duplicate mirroring for the same call
    await queue.add("mirror-recording", data, {
      jobId: `recording-${data.callId}`,
    });
    logger.info(`[recording-queue] Enqueued recording download for callId=${data.callId}`);
  } catch (err) {
    logger.error(`[recording-queue] Failed to enqueue recording for callId=${data.callId}: ${String(err)}`);
    // Fallback: don't lose the recording if Redis enqueue fails
    void telephonyService.recordingUrl(data.tenantId, data.callId).catch((e) => {
      logger.warn(`Fallback recording mirror failed for call ${data.callId}: ${String(e)}`);
    });
  }
};

export const closeRecordingsQueue = async (): Promise<void> => {
  if (recordingsQueue) {
    await recordingsQueue.close();
    recordingsQueue = null;
  }
};
