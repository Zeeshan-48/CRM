import telephonyRepository, {
  TERMINAL_CALL_STATUSES,
} from "../repositories/telephony.repository";
import callIntelligenceService from "../services/call-intelligence.service";
import exotelClient from "../services/exotel.client";
import telephonyResolverService from "../services/telephony-resolver.service";
import logger from "../utils/logger";

let running = false;

// Reconciliation for Exotel calls. Webhooks are the primary path; this sweep is
// the safety net for two gaps Exotel's own docs call out:
//   1. A StatusCallback/Passthru that never arrived (network, redeploy) leaves
//      a call stuck non-terminal -> fetch its real state from the Call API.
//   2. Duration and RecordingUrl finalize a couple of minutes AFTER the
//      terminal callback -> retry the recording mirror for a window.
// Fully inert when no tenant is on Exotel (both queries return nothing) and
// under tests (the client is simulated and sim_ rows are filtered out in SQL).
export async function runExotelSync(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const credsCache = new Map<
      string,
      Awaited<ReturnType<typeof telephonyResolverService.resolveExotel>>
    >();
    const resolveCached = async (tenantId: string) => {
      let resolved = credsCache.get(tenantId);
      if (!resolved) {
        resolved = await telephonyResolverService.resolveExotel(tenantId);
        credsCache.set(tenantId, resolved);
      }
      return resolved;
    };

    // Pass 1: calls that never went terminal.
    const stale = await telephonyRepository.staleExotelCalls(new Date(Date.now() - 2 * 60_000));
    for (const call of stale) {
      try {
        const resolved = await resolveCached(call.tenant_id);
        if (resolved.mode === "none") continue;
        const details = await exotelClient.fetchCall(resolved.creds, call.external_call_id);
        if (!details?.status) continue;
        await telephonyRepository.updateCallByExternalId(call.external_call_id, {
          call_status: details.status,
          ...(details.durationSec ? { duration_sec: details.durationSec } : {}),
          ...(details.recordingUrl ? { recording_url: details.recordingUrl } : {}),
        });
        if (TERMINAL_CALL_STATUSES.includes(details.status)) {
          await callIntelligenceService.processCall(call.id);
        }
      } catch (err) {
        logger.warn(`exotel sync ${call.external_call_id}: ${String(err)}`);
      }
    }

    // Pass 2: terminal calls whose recording is still the provider's authed
    // http URL (mirror retry window: 2 hours).
    const unmirrored = await telephonyRepository.exotelCallsMissingMirror(
      new Date(Date.now() - 2 * 3600_000)
    );
    for (const call of unmirrored) {
      try {
        await callIntelligenceService.processCall(call.id);
      } catch (err) {
        logger.warn(`exotel mirror retry ${call.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`exotel sync failed: ${String(err)}`);
  } finally {
    running = false;
  }
}
