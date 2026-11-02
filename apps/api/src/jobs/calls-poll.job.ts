import telephonyRepository from "../repositories/telephony.repository";
import telephonyResolverService from "../services/telephony-resolver.service";
import twilioClient from "../services/twilio.client";
import logger from "../utils/logger";

let running = false;

// Polls non-terminal Twilio calls for their final status + duration (V1 uses
// polling instead of webhooks, so no public URL is required). No-op without a
// live Twilio account. Scheduled by scheduler.ts.
export async function runCallsPoll(): Promise<void> {
  if (running) return;
  running = true;
  try {
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
