import { Queue } from "bullmq";
import type {
  LeadImportAssignmentSpec,
  LeadImportType,
} from "../constants/lead-import.const";
import { getRedis } from "../db/redis";
import { createQueueConnection, isQueueEnabled } from "./connection";
import logger from "../utils/logger";

export const LEAD_IMPORT_QUEUE_NAME = "crm-lead-import";

export interface SkippedImportRow {
  rowNumber: number;
  name: string;
  email: string;
  phone: string;
  reason: string;
}

export interface LeadImportJobData {
  jobId: string;
  tenantId: string;
  actorId: string;
  importType: LeadImportType;
  assignment: LeadImportAssignmentSpec;
  skipDuplicates: boolean;
  rows: Record<string, unknown>[];
}

export interface LeadImportProgress {
  jobId: string;
  tenantId: string;
  actorId: string;
  importType?: LeadImportType;
  status: "queued" | "processing" | "completed" | "failed";
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  skippedRows?: SkippedImportRow[];
  percent: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

let importQueue: Queue | null = null;
const memoryStore = new Map<string, LeadImportProgress>();

type LeadImportHandler = (data: LeadImportJobData) => Promise<void>;
let fallbackProcessor: LeadImportHandler | null = null;

export const registerLeadImportProcessor = (fn: LeadImportHandler): void => {
  fallbackProcessor = fn;
};

export const getLeadImportQueue = (): Queue => {
  if (!importQueue) {
    importQueue = new Queue(LEAD_IMPORT_QUEUE_NAME, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "fixed",
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }
  return importQueue;
};

const progressKey = (jobId: string) => `lead-import:progress:${jobId}`;

export const setLeadImportProgress = async (
  jobId: string,
  progress: LeadImportProgress
): Promise<void> => {
  memoryStore.set(jobId, progress);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(progressKey(jobId), JSON.stringify(progress), "EX", 86400); // 24hr TTL
    } catch (err) {
      logger.warn(`Failed to cache lead import progress in redis for ${jobId}: ${String(err)}`);
    }
  }
};

export const getLeadImportProgress = async (
  jobId: string
): Promise<LeadImportProgress | null> => {
  const redis = getRedis();
  if (redis) {
    try {
      const data = await redis.get(progressKey(jobId));
      if (data) {
        return JSON.parse(data) as LeadImportProgress;
      }
    } catch (err) {
      logger.warn(`Failed to read lead import progress from redis for ${jobId}: ${String(err)}`);
    }
  }
  return memoryStore.get(jobId) ?? null;
};

export const enqueueLeadImport = async (data: LeadImportJobData): Promise<void> => {
  const initialProgress: LeadImportProgress = {
    jobId: data.jobId,
    tenantId: data.tenantId,
    actorId: data.actorId,
    importType: data.importType,
    status: "queued",
    total: data.rows.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    skippedRows: [],
    percent: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await setLeadImportProgress(data.jobId, initialProgress);

  if (!isQueueEnabled()) {
    // When BullMQ is not enabled, process directly in background without blocking caller
    if (fallbackProcessor) {
      void fallbackProcessor(data).catch((err: unknown) => {
        logger.error(`Fallback lead import failed for jobId=${data.jobId}: ${String(err)}`);
      });
    }
    return;
  }

  try {
    const queue = getLeadImportQueue();
    await queue.add("import-batch", data, {
      jobId: `import-${data.jobId}`,
    });
    logger.info(`[lead-import-queue] Enqueued lead import jobId=${data.jobId} with ${data.rows.length} rows`);
  } catch (err) {
    logger.error(`[lead-import-queue] Failed to enqueue import jobId=${data.jobId}: ${String(err)}`);
    // Fallback: run directly so import does not get lost
    if (fallbackProcessor) {
      void fallbackProcessor(data).catch((e: unknown) => {
        logger.error(`Fallback lead import failed for jobId=${data.jobId}: ${String(e)}`);
      });
    }
  }
};

export const closeLeadImportQueue = async (): Promise<void> => {
  if (importQueue) {
    await importQueue.close();
    importQueue = null;
  }
};
