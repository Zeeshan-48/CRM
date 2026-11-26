import { ulid } from "ulid";
import config from "../config";
import logger from "../utils/logger";
import { getPlatformPlivoWebhookToken } from "../utils/plivo-signature";

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
    appId?: string;
  }): Promise<PlacedPlivoCall> {
    if (simulated() || !this.keyed(params.creds)) {
      return { callUuid: `sim_plivo_${ulid()}`, status: "queued", simulated: true };
    }

    const payload: Record<string, any> = {
      from: params.from,
      to: params.to,
    };

    // Plivo rules: answer_url and app_id are mutually exclusive.
    if (params.answerUrl) {
      payload.answer_url = params.answerUrl;
      payload.answer_method = "GET";
      if (params.hangupUrl) {
        payload.hangup_url = params.hangupUrl;
        payload.hangup_method = "POST";
      }
    } else if (params.appId || config.PLIVO_APPLICATION_ID) {
      payload.app_id = params.appId || config.PLIVO_APPLICATION_ID;
    }

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

    let parsed: URL;
    try {
      parsed = new URL(recordingUrl);
    } catch {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "plivo.com" && !host.endsWith(".plivo.com"))) {
      logger.warn(`plivo recording url rejected (protocol=${parsed.protocol}, host=${host})`);
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

  /**
   * Programmatically create a SIP WebRTC endpoint for an agent on demand.
   */
  async createEndpoint(params: {
    creds: PlivoCreds;
    username: string;
    password: string;
    alias: string;
    appId?: string;
  }): Promise<{
    endpointId: string;
    username: string;
    alias: string;
    sipUri: string;
  }> {
    if (simulated() || !this.keyed(params.creds)) {
      const suffix = Math.random().toString(36).slice(2, 8);
      const fakeUser = `${params.username}${suffix}`;
      const sipHost = ["phone", "plivo", "com"].join(".");
      return {
        endpointId: `sim_ep_${ulid()}`,
        username: fakeUser,
        alias: params.alias,
        sipUri: `sip:${fakeUser}@${sipHost}`,
      };
    }

    const payload: Record<string, any> = {
      username: params.username,
      password: params.password,
      alias: params.alias,
    };
    if (params.appId || config.PLIVO_APPLICATION_ID) {
      payload.app_id = params.appId || config.PLIVO_APPLICATION_ID;
    }

    const res = await fetch(`${this.base(params.creds)}/Endpoint/`, {
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
      throw new Error(`Plivo createEndpoint failed (HTTP ${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      endpoint_id: string;
      username: string;
      alias: string;
      sip_uri: string;
    };

    return {
      endpointId: String(data.endpoint_id),
      username: String(data.username),
      alias: String(data.alias),
      sipUri: String(data.sip_uri),
    };
  }

  /**
   * Automatically configures Plivo Application with the live public webhook URLs.
   * Completely eliminates any manual configuration in Plivo Console.
   */
  async syncApplicationWebhook(params: {
    creds?: PlivoCreds;
    appId?: string;
    publicUrl: string;
    webhookToken?: string;
  }): Promise<{ ok: boolean; message?: string; error?: string }> {
    const creds = params.creds || {
      authId: config.PLIVO_AUTH_ID || "",
      authToken: config.PLIVO_AUTH_TOKEN || "",
    };
    if (simulated() || !this.keyed(creds)) {
      return { ok: true, message: "Simulation active - skipped Plivo cloud sync" };
    }

    const appId = params.appId || config.PLIVO_APPLICATION_ID;
    if (!appId || !params.publicUrl) {
      return { ok: false, error: "Missing Plivo Application ID or Public URL" };
    }

    const effectiveToken = params.webhookToken || getPlatformPlivoWebhookToken(creds.authId);
    const tokenPart = effectiveToken ? `/${encodeURIComponent(effectiveToken)}` : "";
    const answerUrl = `${params.publicUrl}/api/v1/telephony/webhooks/plivo${tokenPart}/answer`;
    const hangupUrl = `${params.publicUrl}/api/v1/telephony/webhooks/plivo${tokenPart}/hangup`;

    const payload = {
      answer_url: answerUrl,
      answer_method: "POST",
      hangup_url: hangupUrl,
      hangup_method: "POST",
      fallback_answer_url: answerUrl,
      fallback_method: "POST",
    };

    try {
      const res = await fetch(`${this.base(creds)}/Application/${appId}/`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(creds),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        logger.warn(`[Plivo Cloud] Failed to sync Application ${appId} (HTTP ${res.status}): ${text}`);
        return { ok: false, error: text };
      }

      logger.info(`[Plivo Cloud] Successfully auto-synced Application ${appId} webhooks to ${params.publicUrl}`);
      return { ok: true, message: "Plivo Application webhooks synced successfully" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Plivo Cloud] Sync error for Application ${appId}: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * Automatically links a purchased phone number to the Plivo Application.
   */
  async linkNumberToApplication(params: {
    creds?: PlivoCreds;
    phoneNumber: string;
    appId?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const creds = params.creds || {
      authId: config.PLIVO_AUTH_ID || "",
      authToken: config.PLIVO_AUTH_TOKEN || "",
    };
    if (simulated() || !this.keyed(creds)) return { ok: true };

    const appId = params.appId || config.PLIVO_APPLICATION_ID;
    if (!appId) {
      return { ok: false, error: "Missing Plivo Application ID" };
    }
    const cleanNumber = params.phoneNumber.replace(/[^0-9]/g, "");

    try {
      const res = await fetch(`${this.base(creds)}/Number/${cleanNumber}/`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(creds),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ app_id: appId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        logger.warn(`[Plivo Cloud] Failed to link number ${cleanNumber} to App ${appId}: ${text}`);
        return { ok: false, error: text };
      }
      logger.info(`[Plivo Cloud] Successfully linked number ${cleanNumber} to Application ${appId}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export default new PlivoClientService();

