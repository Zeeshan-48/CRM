import { db } from "../db/connection";
import { enqueueRecordingDownload } from "../queue/recordings.queue";
import telephonyRepository, { TERMINAL_CALL_STATUSES } from "../repositories/telephony.repository";
import plivoClient from "../services/plivo.client";
import telephonyResolverService from "../services/telephony-resolver.service";
import twilioClient from "../services/twilio.client";
import logger from "../utils/logger";

export const QUEUED_STALE_MS = 15 * 60 * 1000;
export const IN_PROGRESS_STALE_MS = 4 * 60 * 60 * 1000;
const PLIVO_POLL_LOOKBACK_MS = 48 * 60 * 60 * 1000;

let running = false;

export const normalizeProviderCallStatus = (raw?: string | null): string => {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "cancel") return "canceled";
  if (s === "no_answer") return "no-answer";
  return s;
};

/**
 * Queries Plivo for non-terminal calls created in the last 48h so missed hangup
 * or recording webhooks are reconciled automatically without hammering Plivo.
 */
export async function reconcilePlivoCalls(now = new Date()): Promise<number> {
  if (plivoClient.isSimulated()) return 0;

  const since = new Date(now.getTime() - PLIVO_POLL_LOOKBACK_MS);
  const calls = await telephonyRepository.pollablePlivoCalls(since, 50);
  if (calls.length === 0) return 0;

  const credsCache = new Map<
    string,
    Awaited<ReturnType<typeof telephonyResolverService.resolvePlivo>>
  >();
  let updated = 0;

  for (const c of calls) {
    try {
      let resolved = credsCache.get(c.tenant_id);
      if (!resolved) {
        resolved = await telephonyResolverService.resolvePlivo(c.tenant_id);
        credsCache.set(c.tenant_id, resolved);
      }
      if (resolved.mode === "none") continue;

      const diag = await plivoClient.fetchCall(resolved.creds, c.external_call_id);
      if (!diag) continue;

      const nextStatus = normalizeProviderCallStatus(diag.status);
      if (!nextStatus) continue;

      const shouldUpdate =
        nextStatus !== c.call_status || TERMINAL_CALL_STATUSES.includes(nextStatus);
      if (shouldUpdate) {
        await telephonyRepository.syncCallStateSafe(
          c.tenant_id,
          c.id,
          {
            call_status: nextStatus,
            duration_sec: diag.durationSec,
            ...(diag.recordingUrl ? { recording_url: diag.recordingUrl } : {}),
          },
          { allowOverwriteTerminal: false }
        );
        updated++;
      }

      if (diag.recordingUrl && diag.recordingUrl.startsWith("http")) {
        await enqueueRecordingDownload({
          tenantId: c.tenant_id,
          callId: c.id,
          provider: "plivo",
          recordingUrl: diag.recordingUrl,
        });
      }
    } catch (err) {
      logger.warn(`plivo poll ${c.external_call_id}: ${String(err)}`);
    }
  }

  return updated;
}

/**
 * Closes non-terminal calls that exceeded safe TTL windows:
 * - Calls that already captured audio or duration become "completed".
 * - Orphaned queued/in-progress calls without callbacks become "failed" with context.
 */
export async function sweepStaleCalls(now = new Date()): Promise<number> {
  const queuedCutoff = new Date(now.getTime() - QUEUED_STALE_MS);
  const inProgressCutoff = new Date(now.getTime() - IN_PROGRESS_STALE_MS);
  const stale = await telephonyRepository.findStaleNonTerminalCalls(
    queuedCutoff,
    inProgressCutoff,
    100
  );
  if (stale.length === 0) return 0;

  let resolvedCount = 0;
  for (const c of stale) {
    const hasCompletedEvidence =
      Boolean(c.recording_url && c.recording_url.trim()) || (c.duration_sec ?? 0) > 0;
    const nextStatus = hasCompletedEvidence ? "completed" : "failed";
    const defaultErr =
      c.call_status === "in-progress"
        ? "Call ended without final status callback"
        : "Call did not connect (status timeout)";

    await telephonyRepository.syncCallStateSafe(
      c.tenant_id,
      c.id,
      {
        call_status: nextStatus,
        completed_at: c.completed_at ?? c.updated_at ?? c.created_at ?? now,
        ...(nextStatus === "failed" ? { call_error: c.call_error || defaultErr } : {}),
      },
      { allowOverwriteTerminal: false }
    );
    resolvedCount++;
  }

  return resolvedCount;
}

// Polls non-terminal Twilio & Plivo calls for their final status + duration,
// sweeps unmirrored recordings into BullMQ, and expires stale orphan calls.
export async function runCallsPoll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // 1. Sweep any calls whose recordings are still hosted on external provider URLs
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const unmirrored = await db
        .selectFrom("voice_calls")
        .select(["id", "tenant_id", "recording_url", "provider"])
        .where("recording_url", "like", "http%")
        .where("created_at", ">", oneHourAgo)
        .limit(10)
        .execute();

      for (const call of unmirrored) {
        if (call.recording_url) {
          await enqueueRecordingDownload({
            tenantId: call.tenant_id,
            callId: call.id,
            provider: call.provider,
            recordingUrl: call.recording_url,
          });
        }
      }
    } catch (sweepErr) {
      logger.warn(`unmirrored recordings sweep failed: ${String(sweepErr)}`);
    }

    // 2. Poll active Twilio calls
    const calls = await telephonyRepository.pollableCalls();
    const credsCache = new Map<
      string,
      Awaited<ReturnType<typeof telephonyResolverService.resolve>>
    >();
    for (const c of calls) {
      try {
        let resolved = credsCache.get(c.tenant_id);
        if (!resolved) {
          resolved = await telephonyResolverService.resolve(c.tenant_id);
          credsCache.set(c.tenant_id, resolved);
        }
        if (resolved.mode === "none") continue;
        const diag = await twilioClient.fetchCallDiagnostics(resolved.creds, c.twilio_call_sid);
        if (diag) {
          await telephonyRepository.updateCallStatus(c.twilio_call_sid, {
            call_status: normalizeProviderCallStatus(diag.status) || diag.status,
            duration_sec: diag.durationSec,
            call_error: diag.error,
          });
        }
      } catch (err) {
        logger.warn(`calls poll ${c.twilio_call_sid}: ${String(err)}`);
      }
    }

    // 3. Reconcile active Plivo calls via Plivo Call API before sweeping
    try {
      await reconcilePlivoCalls();
    } catch (plivoErr) {
      logger.warn(`plivo calls reconcile failed: ${String(plivoErr)}`);
    }

    // 4. Close stale orphan queued / in-progress calls past TTL
    try {
      const swept = await sweepStaleCalls();
      if (swept > 0) {
        logger.info(`[calls-poll] reconciled ${swept} stale call(s) past timeout`);
      }
    } catch (staleErr) {
      logger.warn(`stale calls sweep failed: ${String(staleErr)}`);
    }
  } catch (err) {
    logger.warn(`calls poll failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
