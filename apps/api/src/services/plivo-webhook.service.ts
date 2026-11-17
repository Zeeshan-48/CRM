import { db } from "../db/connection";
import logger from "../utils/logger";

interface PlivoConfigRow {
  id: string;
  tenant_id: string;
  provider: string;
  account_sid: string | null;
  from_number: string | null;
  webhook_token: string | null;
  status: string;
}

class PlivoWebhookService {
  async configForToken(token: string): Promise<PlivoConfigRow | null> {
    if (!token) return null;
    const row = await db
      .selectFrom("tenant_telephony")
      .select(["id", "tenant_id", "provider", "account_sid", "from_number", "webhook_token", "status"])
      .where("webhook_token", "=", token)
      .where("provider", "=", "PLIVO")
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * Generates Plivo XML to bridge agent to lead when agent answers.
   */
  generateAnswerXml(params: {
    callerId: string;
    leadPhone: string;
    hangupUrl: string;
    recordingUrl: string;
  }): string {
    const { callerId, leadPhone, hangupUrl, recordingUrl } = params;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" action="${hangupUrl}" callbackUrl="${recordingUrl}" callbackMethod="POST" record="true">
    <Number>${leadPhone}</Number>
  </Dial>
</Response>`;
  }

  /**
   * Handles call termination / hangup callbacks from Plivo.
   */
  async handleHangup(cfg: PlivoConfigRow, payload: Record<string, any>, callIdFromQuery?: string) {
    const callUuid = String(payload.CallUUID ?? payload.call_uuid ?? payload.ALegUUID ?? "");
    const dialStatus = String(payload.DialStatus ?? payload.CallStatus ?? payload.call_status ?? "completed").toLowerCase();
    const duration = Number(payload.DialDuration ?? payload.Duration ?? payload.duration ?? 0);
    const recordingUrl = payload.RecordUrl ?? payload.recording_url ?? null;

    logger.info(`[plivo-webhook] hangup for callUuid=${callUuid}, status=${dialStatus}, duration=${duration}`);

    let query = db.updateTable("voice_calls").set({
      call_status: dialStatus,
      duration_sec: duration,
      completed_at: new Date(),
      updated_at: new Date(),
    });

    if (recordingUrl) {
      query = query.set({ recording_url: String(recordingUrl) });
    }

    if (callIdFromQuery) {
      await query
        .where("id", "=", callIdFromQuery)
        .where("tenant_id", "=", cfg.tenant_id)
        .execute();
    } else if (callUuid) {
      await query
        .where("external_call_id", "=", callUuid)
        .where("tenant_id", "=", cfg.tenant_id)
        .execute();
    }
  }

  /**
   * Handles recording callback from Plivo.
   */
  async handleRecording(cfg: PlivoConfigRow, payload: Record<string, any>, callIdFromQuery?: string) {
    const callUuid = String(payload.CallUUID ?? payload.call_uuid ?? "");
    const recordingUrl = payload.RecordUrl ?? payload.recording_url ?? null;

    if (!recordingUrl) return;

    logger.info(`[plivo-webhook] recording ready for callUuid=${callUuid}: ${recordingUrl}`);

    const query = db.updateTable("voice_calls").set({
      recording_url: String(recordingUrl),
      updated_at: new Date(),
    });

    if (callIdFromQuery) {
      await query
        .where("id", "=", callIdFromQuery)
        .where("tenant_id", "=", cfg.tenant_id)
        .execute();
    } else if (callUuid) {
      await query
        .where("external_call_id", "=", callUuid)
        .where("tenant_id", "=", cfg.tenant_id)
        .execute();
    }
  }
}

export default new PlivoWebhookService();

