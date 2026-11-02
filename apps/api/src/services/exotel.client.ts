import { ulid } from "ulid";
import config from "../config";
import logger from "../utils/logger";

// Exotel seam, mirroring twilio.client.ts: instantiated per call with the
// resolved tenant's credentials (Exotel is BYO-only, no platform default tier).
// Simulated when unkeyed or under tests, so the suite never touches Exotel.
//
// API shape (official docs): every endpoint lives under
//   https://{subdomain}/v1/Accounts/{sid}/...
// with HTTP Basic auth of api_key:api_token. Requests are form-encoded;
// appending .json to a resource returns JSON.

export interface ExotelCreds {
  sid: string;
  apiKey: string;
  apiToken: string;
  subdomain: string;
}

export interface PlacedExotelCall {
  callSid: string;
  status: string;
  simulated: boolean;
}

export interface ExotelCallDetails {
  status: string;
  durationSec: number;
  recordingUrl: string | null;
}

// The only API hosts Exotel operates. Anything else in a saved config is a
// misconfiguration at best and an SSRF attempt at worst, so it is a 400 at save
// time and a hard skip here.
export const EXOTEL_SUBDOMAINS = ["api.in.exotel.com", "api.exotel.com"] as const;

// Statuses Exotel will not move past (same vocabulary as Twilio, which is why
// telephony.repository's TERMINAL_CALL_STATUSES is reusable).
export const EXOTEL_TERMINAL = ["completed", "failed", "busy", "no-answer", "canceled"];

const REQUEST_TIMEOUT_MS = 10_000;

// Simulated under tests, or when EXOTEL_SIMULATE is set so the whole flow is
// demoable in dev without an Exotel account.
const simulated = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true" || config.EXOTEL_SIMULATE;

interface RawExotelCall {
  Sid?: string;
  Status?: string;
  Duration?: string | number;
  RecordingUrl?: string;
}

class ExotelClientService {
  isSimulated(): boolean {
    return simulated();
  }

  private keyed(creds: ExotelCreds): boolean {
    return Boolean(
      creds.sid &&
        creds.apiKey &&
        creds.apiToken &&
        (EXOTEL_SUBDOMAINS as readonly string[]).includes(creds.subdomain)
    );
  }

  private authHeader(creds: ExotelCreds): string {
    return `Basic ${Buffer.from(`${creds.apiKey}:${creds.apiToken}`).toString("base64")}`;
  }

  private base(creds: ExotelCreds): string {
    return `https://${creds.subdomain}/v1/Accounts/${encodeURIComponent(creds.sid)}`;
  }

  // Validate creds by fetching the account. Returns ok=false with a message
  // rather than throwing, so the settings UI can show the reason.
  async validateCredentials(creds: ExotelCreds): Promise<{ ok: boolean; error?: string }> {
    if (simulated()) return { ok: true };
    if (!this.keyed(creds)) return { ok: false, error: "Missing SID, API key or API token" };
    try {
      const res = await fetch(`${this.base(creds)}.json`, {
        headers: { Authorization: this.authHeader(creds) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Exotel rejected the API key or token" };
      }
      if (!res.ok) return { ok: false, error: `Exotel returned HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "validation failed" };
    }
  }

  /**
   * Outbound click-to-call: Exotel dials `from` (the agent) FIRST, and once
   * they answer, dials `to` (the lead), who sees `callerId` (an ExoPhone, * Exotel mandates a leased virtual number; a personal number is rejected).
   */
  async placeConnectCall(params: {
    creds: ExotelCreds;
    from: string;
    to: string;
    callerId: string;
    statusCallbackUrl: string;
    // Carried verbatim into every callback (<=128 chars); we pass our
    // voice_calls row id so callbacks can find the row even without the Sid.
    customField: string;
  }): Promise<PlacedExotelCall> {
    if (simulated() || !this.keyed(params.creds)) {
      // ulid, not Date.now(): external_call_id is UNIQUE and tests place
      // several simulated calls in the same millisecond.
      return { callSid: `sim_${ulid()}`, status: "queued", simulated: true };
    }

    const body = new URLSearchParams({
      From: params.from,
      To: params.to,
      CallerId: params.callerId,
      Record: "true",
      RecordingChannels: "dual",
      RecordingFormat: "mp3",
      StatusCallback: params.statusCallbackUrl,
      "StatusCallbackEvents[0]": "terminal",
      "StatusCallbackEvents[1]": "answered",
      StatusCallbackContentType: "application/json",
      CustomField: params.customField.slice(0, 128),
    });

    const res = await fetch(`${this.base(params.creds)}/Calls/connect.json`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(params.creds),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`Exotel connect failed (HTTP ${res.status}): ${text}`);
    }

    const payload = (await res.json()) as { Call?: RawExotelCall };
    const call = payload.Call ?? {};
    if (!call.Sid) throw new Error("Exotel connect returned no call Sid");
    return { callSid: call.Sid, status: call.Status ?? "queued", simulated: false };
  }

  /**
   * Fetch a call's current state, the reconciliation path when a
   * StatusCallback never arrived (Duration/RecordingUrl also finalize a couple
   * of minutes after the call ends, later than the terminal callback).
   */
  async fetchCall(creds: ExotelCreds, callSid: string): Promise<ExotelCallDetails | null> {
    if (simulated() || callSid.startsWith("sim_") || !this.keyed(creds)) return null;
    try {
      const res = await fetch(
        `${this.base(creds)}/Calls/${encodeURIComponent(callSid)}.json`,
        {
          headers: { Authorization: this.authHeader(creds) },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );
      if (!res.ok) return null;
      const payload = (await res.json()) as { Call?: RawExotelCall };
      const call = payload.Call;
      if (!call) return null;
      return {
        status: String(call.Status ?? ""),
        durationSec: Number(call.Duration ?? 0) || 0,
        recordingUrl: call.RecordingUrl ? String(call.RecordingUrl) : null,
      };
    } catch (err) {
      logger.warn(`exotel fetchCall ${callSid}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Download a recording. Exotel recording URLs require the same basic auth,
   * which is exactly why the raw URL is never handed to a browser, we mirror
   * to our own storage instead.
   */
  async downloadRecording(creds: ExotelCreds, recordingUrl: string): Promise<Buffer | null> {
    if (simulated() || !this.keyed(creds)) return null;
    let host: string;
    try {
      host = new URL(recordingUrl).hostname;
    } catch {
      return null;
    }
    // The URL comes from an UNSIGNED webhook; without this fence a forged
    // callback could point us at an arbitrary host with our auth header.
    if (!host.endsWith(".exotel.com")) {
      logger.warn(`exotel recording url rejected (host ${host})`);
      return null;
    }
    try {
      const res = await fetch(recordingUrl, {
        headers: { Authorization: this.authHeader(creds) },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      logger.warn(`exotel recording download: ${String(err)}`);
      return null;
    }
  }
}

export default new ExotelClientService();
