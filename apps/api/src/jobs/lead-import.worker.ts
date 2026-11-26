import { Worker } from "bullmq";
import { ulid } from "ulid";
import { CSV_IMPORT_TAG } from "../constants/lead-import.const";
import { LIMIT_CODES } from "../constants/modules.const";
import { db } from "../db/connection";
import { createQueueConnection, isQueueEnabled } from "../queue/connection";
import {
  LEAD_IMPORT_QUEUE_NAME,
  type LeadImportJobData,
  type LeadImportProgress,
  type SkippedImportRow,
  setLeadImportProgress,
  closeLeadImportQueue,
  registerLeadImportProcessor,
} from "../queue/lead-import.queue";
import leadsRepository, { BulkCreateLeadData, LeadRow } from "../repositories/leads.repository";
import engineService from "../services/engine.service";
import entitlementsService from "../services/entitlements.service";
import {
  notifyAssignedImportOwners,
  prepareBulkImportChunk,
} from "../services/lead-import-batch.service";
import leadsService from "../services/leads.service";
import logger from "../utils/logger";

let worker: Worker | null = null;
const CONCURRENCY = 2;
const CHUNK_SIZE = 250;

export const processLeadImportJob = async (
  data: LeadImportJobData,
  onProgress?: (percent: number) => Promise<void>
): Promise<void> => {
  const { jobId, tenantId, actorId, rows, importType, assignment, skipDuplicates } = data;
  logger.info(
    `[lead-import-worker] Starting import jobId=${jobId} (type=${importType}, mode=${assignment.mode}, rows=${rows.length}) for tenant=${tenantId}`
  );

  const now = new Date();
  const progress: LeadImportProgress = {
    jobId,
    tenantId,
    actorId,
    importType,
    status: "processing",
    total: rows.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    skippedRows: [],
    percent: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await setLeadImportProgress(jobId, progress);

  try {
    const currentLeads = await leadsRepository.countByTenant(tenantId);
    await entitlementsService.ensureCapacity(
      tenantId,
      LIMIT_CODES.LEADS,
      currentLeads,
      rows.length,
      "leads"
    );

    const existing = await leadsRepository.existingIdentifiers(tenantId);
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();

    const totalRows = rows.length;
    let totalImported = 0;
    let totalSkipped = 0;
    let assignIdx = 0;
    const allSkippedRows: SkippedImportRow[] = [];
    const ownerCounts = new Map<string, number>();
    const preserveOwner = assignment.mode !== "default";

    for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const prepared = prepareBulkImportChunk({
        tenantId,
        importType,
        rows: chunk,
        startRowNumber: i + 1,
        existing,
        seenEmails,
        seenPhones,
        skipDuplicates,
        assignment,
        startAssignIndex: assignIdx,
        csvImportTag: CSV_IMPORT_TAG,
      });
      assignIdx = prepared.nextAssignIndex;

      if (allSkippedRows.length < 200 && prepared.skippedRows.length > 0) {
        allSkippedRows.push(...prepared.skippedRows.slice(0, 200 - allSkippedRows.length));
      }

      const toInsert: BulkCreateLeadData[] = prepared.toInsert;
      let insertedChunk: LeadRow[] = [];
      if (toInsert.length > 0) {
        insertedChunk = await leadsRepository.bulkCreate(toInsert);
        for (const ins of insertedChunk) {
          if (ins.email) existing.emails.add(ins.email.toLowerCase());
          if (ins.phone) existing.phones.add(ins.phone);
          if (ins.owner_id) {
            ownerCounts.set(ins.owner_id, (ownerCounts.get(ins.owner_id) ?? 0) + 1);
          }
        }

        await executeImportAutomationChunk(tenantId, actorId, insertedChunk, preserveOwner);
      }

      totalImported += insertedChunk.length;
      totalSkipped += prepared.skipped;

      const processedCount = Math.min(totalRows, i + chunk.length);
      const percent = Math.round((processedCount / totalRows) * 100);

      progress.processed = processedCount;
      progress.imported = totalImported;
      progress.skipped = totalSkipped;
      progress.skippedRows = allSkippedRows;
      progress.percent = percent;
      progress.updatedAt = new Date().toISOString();

      await setLeadImportProgress(jobId, progress);
      if (onProgress) await onProgress(percent);
    }

    progress.status = "completed";
    progress.percent = 100;
    progress.updatedAt = new Date().toISOString();
    await setLeadImportProgress(jobId, progress);

    await notifyAssignedImportOwners(tenantId, actorId, importType, ownerCounts);

    engineService.audit(tenantId, actorId, "lead.bulk_import", "lead", undefined, {
      count: totalImported,
      skipped: totalSkipped,
      importType,
      assignmentMode: assignment.mode,
      ownerIds: assignment.ownerIds ?? [],
      jobId,
    });

    // In-app notification for the user
    try {
      await db
        .insertInto("notifications")
        .values({
          id: ulid(),
          tenant_id: tenantId,
          user_id: actorId,
          text: `Lead import complete: ${totalImported} leads imported (${totalSkipped} duplicates skipped).`,
          link: "/leads",
          read: false,
          created_at: new Date(),
        })
        .execute();
    } catch (notifErr) {
      logger.warn(`Failed to insert import completion notification: ${String(notifErr)}`);
    }

    logger.info(
      `[lead-import-worker] Finished import jobId=${jobId}: ${totalImported} imported, ${totalSkipped} skipped`
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[lead-import-worker] Import failed for jobId=${jobId}: ${errorMsg}`);

    progress.status = "failed";
    progress.error = errorMsg;
    progress.updatedAt = new Date().toISOString();
    await setLeadImportProgress(jobId, progress);

    try {
      await db
        .insertInto("notifications")
        .values({
          id: ulid(),
          tenant_id: tenantId,
          user_id: actorId,
          text: `Lead import failed for batch of ${rows.length} rows: ${errorMsg}`,
          link: "/leads",
          read: false,
          created_at: new Date(),
        })
        .execute();
    } catch {
      // Ignore notification failure on error path
    }

    throw err;
  }
};

registerLeadImportProcessor(processLeadImportJob);

const executeImportAutomationChunk = async (
  tenantId: string,
  actorId: string,
  leads: LeadRow[],
  preserveOwner: boolean
): Promise<void> => {
  if (leads.length === 0) return;
  try {
    const hasFlows = await db
      .selectFrom("workflows")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("trigger", "=", "lead.created")
      .where("active", "=", true)
      .limit(1)
      .executeTakeFirst();

    const strategy = await leadsService.defaultAssignmentStrategy(tenantId);
    if (!hasFlows && (preserveOwner || strategy === "MANUAL")) return;

    for (const lead of leads) {
      try {
        if (hasFlows) {
          await engineService.emit(tenantId, actorId, "lead.created", { lead, preserveOwner });
        }
        if (!preserveOwner && strategy !== "MANUAL") {
          const current = hasFlows
            ? (await leadsRepository.findById(lead.id, tenantId)) ?? lead
            : lead;
          await leadsService.autoAssign(tenantId, actorId, current);
        }
      } catch (err) {
        logger.warn(`import automation error on lead ${lead.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`import automation batch error: ${String(err)}`);
  }
};

export const startLeadImportWorker = async (): Promise<void> => {
  if (!isQueueEnabled()) {
    logger.info("[lead-import-worker] Queue disabled; lead import worker idle");
    return;
  }

  worker = new Worker<LeadImportJobData>(
    LEAD_IMPORT_QUEUE_NAME,
    async (job) => {
      await processLeadImportJob(job.data, async (percent) => {
        await job.updateProgress(percent);
      });
    },
    {
      connection: createQueueConnection(),
      concurrency: CONCURRENCY,
    }
  );

  worker.on("failed", (job, err) => {
    logger.warn(`[lead-import-worker] Job ${job?.data?.jobId ?? "?"} failed: ${err.message}`);
  });

  worker.on("error", (err) => {
    logger.warn(`[lead-import-worker] Worker error: ${err.message}`);
  });

  logger.info(`[lead-import-worker] Started BullMQ lead import worker (concurrency=${CONCURRENCY})`);
};

export const stopLeadImportWorker = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await closeLeadImportQueue();
};
