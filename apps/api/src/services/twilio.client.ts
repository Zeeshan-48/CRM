import twilio, { Twilio } from "twilio";
import config from "../config";
import logger from "../utils/logger";

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface PlacedCall {
  callSid: string;
  status: string;
  simulated: boolean;
}

export interface CallStatus {
  status: string;
  durationSec: number;
}

export interface CallDiagnostics {
  status: string;
  durationSec: number;
  // A human-readable reason a call failed (recipient leg status + Twilio error
  // code when available), or null when the call succeeded / is still in progress.
  error: string | null;
}

// Call statuses Twilio will not move past.
const TERMINAL = ["completed", "failed", "busy", "no-answer", "canceled"];

// Simulated when under tests, or when TELEPHONY_SIMULATE is set so the whole
// flow is demoable in dev without a Twilio account.
const simulated = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true" || config.TELEPHONY_SIMULATE;

// Escapes a value for safe inclusion in TwiML XML. Phone numbers are also
// format-validated upstream; this is defense in depth.
const xmlEscape = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Twilio seam. Instantiated per call with the resolved account's credentials
// (tenant BYO or platform default). Simulated when unkeyed or under tests, so the
// suite never places a real call.
class TwilioClientService {
  isDefaultLive(): boolean {
    return (
      Boolean(
        config.TWILIO_ACCOUNT_SID &&
          config.TWILIO_AUTH_TOKEN &&
          config.TWILIO_DEFAULT_FROM_NUMBER
      ) && !simulated()
    );
  }

  isSimulated(): boolean {
    return simulated();
  }

  private client(creds: TwilioCreds): Twilio {
    return twilio(creds.accountSid, creds.authToken);
  }

  private keyed(creds: TwilioCreds): boolean {
    return Boolean(creds.accountSid && creds.authToken && creds.fromNumber);
  }

  // Validate creds by fetching the account. Returns ok=false with a message
  // rather than throwing, so the settings UI can show the reason.
  async validateCredentials(
    accountSid: string,
    authToken: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (simulated()) return { ok: true };
    try {
      await twilio(accountSid, authToken).api.v2010.accounts(accountSid).fetch();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "validation failed" };
    }
  }

  // Confirm the from-number belongs to the account.
  async ownsNumber(accountSid: string, authToken: string, fromNumber: string): Promise<boolean> {
    if (simulated()) return true;
    try {
      const nums = await twilio(accountSid, authToken).incomingPhoneNumbers.list({
        phoneNumber: fromNumber,
        limit: 1,
      });
      return nums.length > 0;
    } catch {
      return false;
    }
  }

  // Click-to-call bridge: ring the agent first, then dial the lead. Inline TwiML
  // means no public webhook URL is required.
  async placeBridgeCall(params: {
    creds: TwilioCreds;
    agentPhone: string;
    leadPhone: string;
  }): Promise<PlacedCall> {
    if (simulated() || !this.keyed(params.creds)) {
      return { callSid: `sim_${Date.now()}`, status: "queued", simulated: true };
    }
    const twiml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Dial callerId="${xmlEscape(params.creds.fromNumber)}">` +
      `<Number>${xmlEscape(params.leadPhone)}</Number></Dial></Response>`;
    const call = await this.client(params.creds).calls.create({
      to: params.agentPhone,
      from: params.creds.fromNumber,
      twiml,
    });
    return { callSid: call.sid, status: call.status ?? "queued", simulated: false };
  }

  // Polls a call's current state. Returns null for simulated calls.
  async fetchCall(creds: TwilioCreds, callSid: string): Promise<CallStatus | null> {
    if (simulated() || callSid.startsWith("sim_") || !this.keyed(creds)) return null;
    try {
      const call = await this.client(creds).calls(callSid).fetch();
      return { status: call.status ?? "unknown", durationSec: Number(call.duration ?? 0) };
    } catch (err) {
      logger.warn(`twilio fetchCall failed: ${String(err)}`);
      return null;
    }
  }

  // Like fetchCall, but once the (parent/agent) call is terminal it also works
  // out WHY a bridge failed: it inspects the child <Dial> leg to the recipient
  // and, best-effort, the Twilio Debugger alert for the exact error code. This
  // is what surfaces "the recipient was never dialed / leg failed / error 13225"
  // so a failed click-to-call is no longer a black box.
  async fetchCallDiagnostics(
    creds: TwilioCreds,
    callSid: string
  ): Promise<CallDiagnostics | null> {
    if (simulated() || callSid.startsWith("sim_") || !this.keyed(creds)) return null;
    try {
      const client = this.client(creds);
      const call = await client.calls(callSid).fetch();
      const status = call.status ?? "unknown";
      const durationSec = Number(call.duration ?? 0);

      // Only do the heavier failure analysis once the agent leg is terminal.
      if (!TERMINAL.includes(status)) return { status, durationSec, error: null };

      const sids = new Set<string>([callSid]);
      let summary: string | null = null;

      // The <Dial> spawns a child call to the recipient; its status tells us
      // whether the recipient was reached at all.
      try {
        const children = await client.calls.list({ parentCallSid: callSid, limit: 5 });
        for (const ch of children) sids.add(ch.sid);
        if (children.length === 0) {
          if (status === "completed") {
            summary =
              "Recipient was never dialed, the call ended on your (agent) leg. On a Twilio trial this is the 'press a key to execute your code' prompt: the call drops unless the recipient leg can be placed (commonly the recipient number is not a Verified Caller ID on this trial project, or trial credit is exhausted).";
          }
        } else {
          const child = children[0];
          if (["failed", "busy", "no-answer", "canceled"].includes(child.status)) {
            summary = `Recipient leg ${child.status} (dialed ${child.to ?? "?"}).`;
          }
        }
      } catch (e) {
        logger.warn(`twilio child-leg lookup ${callSid}: ${String(e)}`);
      }

      // Twilio Debugger alerts carry the exact error code (e.g. 13225 = number
      // not verified on a trial). Best-effort: the API may be restricted.
      try {
        const alerts = await client.monitor.v1.alerts.list({ logLevel: "error", limit: 30 });
        const hit = alerts.find((a) => a.resourceSid && sids.has(a.resourceSid));
        if (hit) {
          const code = hit.errorCode ? `[Twilio ${hit.errorCode}] ` : "";
          const txt = (hit.alertText ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
          summary = `${code}${txt}`.trim() || summary;
        }
      } catch {
        /* alerts API restricted / unavailable, keep the child-leg summary */
      }

      return { status, durationSec, error: summary };
    } catch (err) {
      logger.warn(`twilio fetchCallDiagnostics ${callSid}: ${String(err)}`);
      return null;
    }
  }
}

export default new TwilioClientService();
