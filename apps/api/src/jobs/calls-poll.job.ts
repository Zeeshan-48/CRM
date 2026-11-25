import { db } from "../db/connection";
import { enqueueRecordingDownload } from "../queue/recordings.queue";
import telephonyRepository from "../repositories/telephony.repository";
import telephonyResolverService from "../services/telephony-resolver.service";
import twilioClient from "../services/twilio.client";
import logger from "../utils/logger";

let running = false;

// Polls non-terminal Twilio calls for their final status + duration, and sweeps
// unmirrored recordings (HTTP provider URLs) into the background recording queue.
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
    // Resolve creds once per tenant.
    const credsCache = new Map<string, Awaited<ReturnType<typeof telephonyResolverService.resolve>>>();
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
            call_status: diag.status,
            duration_sec: diag.durationSec,
            call_error: diag.error,
          });
        }
      } catch (err) {
        logger.warn(`calls poll ${c.twilio_call_sid}: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`calls poll failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
