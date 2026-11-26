import config from "../config";
import { db } from "../db/connection";
import { enqueueRecordingDownload } from "../queue/recordings.queue";
import logger from "../utils/logger";
import telephonyService from "./telephony.service";

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
  async configForToken(token?: string, callId?: string): Promise<PlivoConfigRow | null> {
    if (token && token !== "platform_default_webhook_token") {
      const row = await db
        .selectFrom("tenant_telephony")
        .select(["id", "tenant_id", "provider", "account_sid", "from_number", "webhook_token", "status"])
        .where("webhook_token", "=", token)
        .where("provider", "=", "PLIVO")
        .executeTakeFirst();
      if (row) return row;
    }

    // Fallback: If platform credentials are active or callId exists in voice_calls
    if (callId) {
      const call = await db
        .selectFrom("voice_calls")
        .select(["tenant_id", "from_number"])
        .where("id", "=", callId)
        .executeTakeFirst();
      if (call) {
        return {
          id: "platform_plivo",
          tenant_id: call.tenant_id,
          provider: "PLIVO",
          account_sid: config.PLIVO_AUTH_ID || null,
          from_number: call.from_number ?? config.PLIVO_DEFAULT_FROM_NUMBER ?? null,
          webhook_token: token || "platform_default_webhook_token",
          status: "ACTIVE",
        };
      }
    }

    if (config.PLIVO_AUTH_ID) {
      return {
        id: "platform_plivo",
        tenant_id: "",
        provider: "PLIVO",
        account_sid: config.PLIVO_AUTH_ID,
        from_number: config.PLIVO_DEFAULT_FROM_NUMBER || null,
        webhook_token: token || "platform_default_webhook_token",
        status: "ACTIVE",
      };
    }

    return null;
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
  <Record action="${recordingUrl}" callbackUrl="${recordingUrl}" callbackMethod="POST" startOnDialAnswer="true" redirect="false" fileFormat="mp3" maxLength="7200" />
  <Dial callerId="${callerId}" action="${hangupUrl}" method="POST">
    <Number>${leadPhone}</Number>
  </Dial>
</Response>`;
  }

  /**
   * Handles call termination / hangup callbacks from Plivo.
   */
  async handleHangup(cfg: PlivoConfigRow | null, payload: Record<string, any>, callIdFromQuery?: string) {
    const callUuid = String(payload.CallUUID ?? payload.call_uuid ?? payload.ALegUUID ?? payload.ParentCallUUID ?? "");
    const rawDialStatus = String(payload.DialStatus ?? payload.CallStatus ?? payload.call_status ?? "completed")
      .trim()
      .toLowerCase();
    const dialStatus =
      rawDialStatus === "cancel"
        ? "canceled"
        : rawDialStatus === "no_answer"
          ? "no-answer"
          : rawDialStatus || "completed";
    const duration = Math.max(
      0,
      Math.trunc(Number(payload.DialDuration ?? payload.Duration ?? payload.duration ?? 0) || 0)
    );
    const recordingUrl = payload.RecordUrl ?? payload.recording_url ?? null;

    logger.info(`[plivo-webhook] hangup for callUuid=${callUuid}, status=${dialStatus}, duration=${duration}, recordingUrl=${String(recordingUrl)}`);

    let query = db.updateTable("voice_calls").set({
      call_status: dialStatus,
      duration_sec: duration,
      completed_at: new Date(),
      updated_at: new Date(),
    });

    if (recordingUrl) {
      query = query.set({ recording_url: String(recordingUrl) });
    }

    let matchedId = callIdFromQuery;
    let tenantId = cfg?.tenant_id || "";

    if (matchedId && !tenantId) {
      const callRow = await db
        .selectFrom("voice_calls")
        .select(["tenant_id"])
        .where("id", "=", matchedId)
        .executeTakeFirst();
      if (callRow) {
        tenantId = callRow.tenant_id;
      }
    }

    if (matchedId) {
      if (tenantId) {
        await query
          .where("id", "=", matchedId)
          .where("tenant_id", "=", tenantId)
          .execute();
      } else {
        await query.where("id", "=", matchedId).execute();
      }
    } else if (callUuid) {
      const match = await db
        .selectFrom("voice_calls")
        .select(["id", "tenant_id"])
        .where((eb) =>
          eb.or([
            eb("external_call_id", "=", callUuid),
            eb("twilio_call_sid", "=", callUuid),
          ])
        )
        .executeTakeFirst();
      if (match) {
        matchedId = match.id;
        tenantId = tenantId || match.tenant_id;
        await query.where("id", "=", match.id).execute();
      } else if (tenantId) {
        await query
          .where("external_call_id", "=", callUuid)
          .where("tenant_id", "=", tenantId)
          .execute();
      } else {
        await query.where("external_call_id", "=", callUuid).execute();
      }
    }

    if (recordingUrl && matchedId && tenantId) {
      void telephonyService.recordingUrl(tenantId, matchedId).catch((err) => {
        logger.warn(`Failed automatic audio mirror in hangup for ${matchedId}: ${String(err)}`);
      });
    }
  }

  /**
   * Handles recording callback from Plivo.
   */
  async handleRecording(cfg: PlivoConfigRow | null, payload: Record<string, any>, callIdFromQuery?: string) {
    const callUuid = String(payload.CallUUID ?? payload.call_uuid ?? payload.ParentCallUUID ?? payload.ALegUUID ?? "");
    const recordingUrl = payload.RecordUrl ?? payload.recording_url ?? null;

    if (!recordingUrl) return;

    logger.info(`[plivo-webhook] recording ready for callUuid=${callUuid}, callId=${callIdFromQuery}: ${recordingUrl}`);

    let matchedId = callIdFromQuery;
    let tenantId = cfg?.tenant_id || "";

    if (!matchedId && callUuid) {
      const match = await db
        .selectFrom("voice_calls")
        .select(["id", "tenant_id"])
        .where((eb) =>
          eb.or([
            eb("external_call_id", "=", callUuid),
            eb("twilio_call_sid", "=", callUuid),
          ])
        )
        .executeTakeFirst();
      if (match) {
        matchedId = match.id;
        tenantId = tenantId || match.tenant_id;
      }
    }

    if (matchedId && !tenantId) {
      const callRow = await db
        .selectFrom("voice_calls")
        .select(["tenant_id"])
        .where("id", "=", matchedId)
        .executeTakeFirst();
      if (callRow) {
        tenantId = callRow.tenant_id;
      }
    }

    if (matchedId) {
      await db
        .updateTable("voice_calls")
        .set({
          recording_url: String(recordingUrl),
          updated_at: new Date(),
        })
        .where("id", "=", matchedId)
        .execute();

      if (tenantId) {
        void enqueueRecordingDownload({
          tenantId,
          callId: matchedId,
          provider: "plivo",
          recordingUrl: String(recordingUrl),
        });
      }
    } else if (callUuid) {
      await db
        .updateTable("voice_calls")
        .set({
          recording_url: String(recordingUrl),
          updated_at: new Date(),
        })
        .where("external_call_id", "=", callUuid)
        .execute();

      if (tenantId) {
        void enqueueRecordingDownload({
          tenantId,
          callId: callUuid,
          provider: "plivo",
          recordingUrl: String(recordingUrl),
        });
      }
    }
  }
}

export default new PlivoWebhookService();

