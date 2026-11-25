import { Worker } from "bullmq";
import { ulid } from "ulid";
import { LIMIT_CODES } from "../constants/modules.const";
import { db } from "../db/connection";
import { createQueueConnection, isQueueEnabled } from "../queue/connection";
import {
  LEAD_IMPORT_QUEUE_NAME,
  type LeadImportJobData,
  type LeadImportProgress,
  setLeadImportProgress,
  closeLeadImportQueue,
  registerLeadImportProcessor,
} from "../queue/lead-import.queue";
import leadsRepository, { BulkCreateLeadData, LeadRow } from "../repositories/leads.repository";
import { scoreLead } from "../services/ai/heuristics";
import engineService from "../services/engine.service";
import entitlementsService from "../services/entitlements.service";
import leadsService from "../services/leads.service";
import logger from "../utils/logger";
import { normalizePhone } from "../utils/phone";

let worker: Worker | null = null;
const CONCURRENCY = 2;
const CHUNK_SIZE = 250;
const CSV_IMPORT_TAG = "import:csv";

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
};

export const processLeadImportJob = async (
  data: LeadImportJobData,
  onProgress?: (percent: number) => Promise<void>
): Promise<void> => {
  const { jobId, tenantId, actorId, rows } = data;
  logger.info(`[lead-import-worker] Starting import jobId=${jobId} (rows=${rows.length}) for tenant=${tenantId}`);

  const now = new Date();
  const progress: LeadImportProgress = {
    jobId,
    tenantId,
    actorId,
    status: "processing",
    total: rows.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    percent: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await setLeadImportProgress(jobId, progress);

  try {
    // 1. Capacity check
    const currentLeads = await leadsRepository.countByTenant(tenantId);
    await entitlementsService.ensureCapacity(
      tenantId,
      LIMIT_CODES.LEADS,
      currentLeads,
      rows.length,
      "leads"
    );

    // 2. Preload existing identifiers
    const existing = await leadsRepository.existingIdentifiers(tenantId);
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();

    const totalRows = rows.length;
    let totalImported = 0;
    let totalSkipped = 0;

    // 3. Process in chunks of CHUNK_SIZE
    for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const toInsert: BulkCreateLeadData[] = [];
      let chunkSkipped = 0;

      for (const raw of chunk) {
        const b = (raw ?? {}) as Record<string, unknown>;
        const email = typeof b.email === "string" ? b.email.trim() : "";
        const phone = typeof b.phone === "string" ? normalizePhone(b.phone) : "";
        const emailKey = email.toLowerCase();

        const dupInFile =
          (!!emailKey && seenEmails.has(emailKey)) || (!!phone && seenPhones.has(phone));
        const dupInDb =
          (!!emailKey && existing.emails.has(emailKey)) || (!!phone && existing.phones.has(phone));

        if (dupInFile || dupInDb) {
          chunkSkipped++;
          continue;
        }

        if (emailKey) seenEmails.add(emailKey);
        if (phone) seenPhones.add(phone);

        const source = typeof b.source === "string" && b.source ? b.source : "CSV Upload";
        const tags = parseStringArray(b.tags);
        const notes = typeof b.notes === "string" ? b.notes : "";

        const score = scoreLead(
          { id: "", source, tags, notes, budget: false, last_activity_at: now, created_at: now },
          [],
          []
        );

        if (!tags.some((t) => t.toLowerCase() === CSV_IMPORT_TAG.toLowerCase())) {
          tags.push(CSV_IMPORT_TAG);
        }

        toInsert.push({
          tenant_id: tenantId,
          name: typeof b.name === "string" && b.name ? b.name : "Unknown",
          email,
          phone,
          city: typeof b.city === "string" ? b.city : "",
          country: typeof b.country === "string" ? b.country : "India",
          source,
          tags,
          notes,
          budget: false,
          score_total: score.total,
          score_grade: score.grade,
          score_breakdown: score,
        });
      }

      // Insert chunk
      let insertedChunk: LeadRow[] = [];
      if (toInsert.length > 0) {
        insertedChunk = await leadsRepository.bulkCreate(toInsert);
        // Also register newly inserted into existing sets
        for (const ins of insertedChunk) {
          if (ins.email) existing.emails.add(ins.email.toLowerCase());
          if (ins.phone) existing.phones.add(ins.phone);
        }

        // Run per-chunk automation safely
        await executeImportAutomationChunk(tenantId, actorId, insertedChunk);
      }

      totalImported += insertedChunk.length;
      totalSkipped += chunkSkipped;

      const processedCount = Math.min(totalRows, i + chunk.length);
      const percent = Math.round((processedCount / totalRows) * 100);

      progress.processed = processedCount;
      progress.imported = totalImported;
      progress.skipped = totalSkipped;
      progress.percent = percent;
      progress.updatedAt = new Date().toISOString();

      await setLeadImportProgress(jobId, progress);
      if (onProgress) await onProgress(percent);
    }

    // 4. Complete
    progress.status = "completed";
    progress.percent = 100;
    progress.updatedAt = new Date().toISOString();
    await setLeadImportProgress(jobId, progress);

    // Audit log
    engineService.audit(tenantId, actorId, "lead.bulk_import", "lead", undefined, {
      count: totalImported,
      skipped: totalSkipped,
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
  leads: LeadRow[]
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
    if (!hasFlows && strategy === "MANUAL") return;

    for (const lead of leads) {
      try {
        if (hasFlows) {
          await engineService.emit(tenantId, actorId, "lead.created", { lead });
        }
        if (strategy !== "MANUAL") {
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
