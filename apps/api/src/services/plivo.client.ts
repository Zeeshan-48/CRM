import { ulid } from "ulid";
import config from "../config";
import logger from "../utils/logger";

export interface PlivoCreds {
  authId: string;
  authToken: string;
}

export interface PlacedPlivoCall {
  callUuid: string;
  status: string;
  simulated: boolean;
}

export interface PlivoCallDetails {
  status: string;
  durationSec: number;
  recordingUrl: string | null;
}

export const PLIVO_TERMINAL = ["completed", "failed", "busy", "no-answer", "canceled", "rejected"];

const REQUEST_TIMEOUT_MS = 10_000;

const simulated = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true" || (config as any).PLIVO_SIMULATE;

interface RawPlivoCall {
  call_uuid?: string;
  call_status?: string;
  call_duration?: string | number;
  total_duration?: string | number;
  recording_url?: string;
}

class PlivoClientService {
  isSimulated(): boolean {
    return simulated();
  }

  private keyed(creds: PlivoCreds): boolean {
    return Boolean(creds.authId && creds.authToken);
  }

  private authHeader(creds: PlivoCreds): string {
    return `Basic ${Buffer.from(`${creds.authId}:${creds.authToken}`).toString("base64")}`;
  }

  private base(creds: PlivoCreds): string {
    return `https://api.plivo.com/v1/Account/${encodeURIComponent(creds.authId)}`;
  }

  /**
   * Validate Plivo credentials by fetching the Account endpoint.
   */
  async validateCredentials(creds: PlivoCreds): Promise<{ ok: boolean; error?: string }> {
    if (simulated()) return { ok: true };
    if (!this.keyed(creds)) return { ok: false, error: "Missing Plivo Auth ID or Auth Token" };

    try {
      const res = await fetch(`${this.base(creds)}/`, {
        headers: {
          Authorization: this.authHeader(creds),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Plivo rejected the Auth ID or Auth Token" };
      }
      if (!res.ok) {
        return { ok: false, error: `Plivo returned HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  /**
   * Outbound Click-To-Call:
   * Plivo dials the agent's phone (to) displaying the Plivo number (from).
   * Once answered, Plivo triggers answer_url to bridge to the lead's number with dual recording.
   */
  async placeConnectCall(params: {
    creds: PlivoCreds;
    from: string; // Plivo caller ID
    to: string; // Agent's phone
    leadPhone: string;
    answerUrl: string;
    hangupUrl: string;
  }): Promise<PlacedPlivoCall> {
    if (simulated() || !this.keyed(params.creds)) {
      return { callUuid: `sim_plivo_${ulid()}`, status: "queued", simulated: true };
    }

    const payload = {
      from: params.from,
      to: params.to,
      answer_url: params.answerUrl,
      answer_method: "GET",
      hangup_url: params.hangupUrl,
      hangup_method: "POST",
    };

    const res = await fetch(`${this.base(params.creds)}/Call/`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(params.creds),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`Plivo call failed (HTTP ${res.status}): ${text}`);
    }

    const data = (await res.json()) as { request_uuid?: string; message?: string };
    const uuid = data.request_uuid;
    if (!uuid) throw new Error("Plivo returned no request UUID");

    return { callUuid: uuid, status: "queued", simulated: false };
  }

  /**
   * Fetch call metadata from Plivo.
   */
  async fetchCall(creds: PlivoCreds, callUuid: string): Promise<PlivoCallDetails | null> {
    if (simulated() || callUuid.startsWith("sim_") || !this.keyed(creds)) return null;

    try {
      const res = await fetch(`${this.base(creds)}/Call/${encodeURIComponent(callUuid)}/`, {
        headers: {
          Authorization: this.authHeader(creds),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) return null;
      const data = (await res.json()) as RawPlivoCall;
      return {
        status: String(data.call_status ?? ""),
        durationSec: Number(data.call_duration ?? data.total_duration ?? 0) || 0,
        recordingUrl: data.recording_url ? String(data.recording_url) : null,
      };
    } catch (err) {
      logger.warn(`plivo fetchCall ${callUuid}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Download a call recording safely.
   */
  async downloadRecording(creds: PlivoCreds, recordingUrl: string): Promise<Buffer | null> {
    if (simulated() || !this.keyed(creds)) return null;

    let host: string;
    try {
      host = new URL(recordingUrl).hostname;
    } catch {
      return null;
    }

    if (!host.endsWith(".plivo.com")) {
      logger.warn(`plivo recording url rejected (host ${host})`);
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
      logger.warn(`plivo recording download: ${String(err)}`);
      return null;
    }
  }
}

export default new PlivoClientService();

