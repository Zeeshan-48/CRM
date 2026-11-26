import type { Request } from "express";
import config from "../config";
import { db } from "../db/connection";
import { enqueueRecordingDownload } from "../queue/recordings.queue";
import { decryptSecret } from "../utils/crypto";
import {
  escapeXml,
  getPlatformPlivoWebhookToken,
  safeEqualString,
  verifyPlivoV2Signature,
} from "../utils/plivo-signature";
import logger from "../utils/logger";
import { getRequestBaseUrl } from "./storage.service";
import telephonyService from "./telephony.service";

interface PlivoConfigRow {
  id: string;
  tenant_id: string;
  provider: string;
  account_sid: string | null;
  auth_token_encrypted?: string | null;
  from_number: string | null;
  webhook_token: string | null;
  status: string;
}

export interface PlivoWebhookAuthResult {
  ok: boolean;
  statusCode: number;
  message?: string;
  cfg: PlivoConfigRow | null;
  resolvedToken: string;
}

class PlivoWebhookService {
  async authenticateWebhook(req: Request, callId?: string): Promise<PlivoWebhookAuthResult> {
    const rawToken = String(req.params.token || req.query.token || "").trim();
    const isPlaceholder = rawToken === "platform_default_webhook_token";
    const explicitToken = rawToken && !isPlaceholder ? rawToken : "";
    const platformToken = getPlatformPlivoWebhookToken();

    let cfg: PlivoConfigRow | null = null;
    let tokenAuthenticated = false;
    const candidateAuthTokens: string[] = [];

    if (explicitToken) {
      const row = await db
        .selectFrom("tenant_telephony")
        .select([
          "id",
          "tenant_id",
          "provider",
          "account_sid",
          "auth_token_encrypted",
          "from_number",
          "webhook_token",
          "status",
        ])
        .where("webhook_token", "=", explicitToken)
        .where("provider", "=", "PLIVO")
        .executeTakeFirst();

      if (row) {
        cfg = row;
        tokenAuthenticated = true;
        if (row.auth_token_encrypted) {
          try {
            const decrypted = decryptSecret(row.auth_token_encrypted);
            if (decrypted) candidateAuthTokens.push(decrypted);
          } catch {
            // corrupted ciphertext ignored
          }
        }
      } else if (platformToken && safeEqualString(explicitToken, platformToken)) {
        tokenAuthenticated = true;
      } else {
        return {
          ok: false,
          statusCode: 404,
          message: "Not found",
          cfg: null,
          resolvedToken: "",
        };
      }
    }

    if (config.PLIVO_AUTH_TOKEN) {
      candidateAuthTokens.push(config.PLIVO_AUTH_TOKEN);
    }

    if (!cfg) {
      cfg = await this.configForToken(explicitToken || rawToken, callId);
    }

    const sigV2 = String(
      req.header("x-plivo-signature-v2") || req.header("x-plivo-signature-ma-v2") || ""
    ).trim();
    const nonceV2 = String(req.header("x-plivo-signature-v2-nonce") || "").trim();
    const sigPresent = Boolean(sigV2 || nonceV2);

    let signatureVerified = false;
    if (sigPresent) {
      const baseUrls = [getRequestBaseUrl(req) || "", config.APP_PUBLIC_URL || ""].filter(Boolean);
      const pathName = req.originalUrl.split("?")[0] || `${req.baseUrl}${req.path}`;
      signatureVerified = verifyPlivoV2Signature({
        baseUrls,
        pathName,
        nonce: nonceV2,
        signatureHeader: sigV2,
        authTokens: candidateAuthTokens,
      });

      if (!signatureVerified) {
        return {
          ok: false,
          statusCode: 401,
          message: "Invalid Plivo signature",
          cfg: null,
          resolvedToken: "",
        };
      }
    }

    if (config.isProduction && !tokenAuthenticated && !signatureVerified) {
      return {
        ok: false,
        statusCode: 401,
        message: "Webhook authentication required",
        cfg: null,
        resolvedToken: "",
      };
    }

    const resolvedToken =
      explicitToken ||
      (cfg?.webhook_token && cfg.webhook_token !== "platform_default_webhook_token"
        ? cfg.webhook_token
        : "") ||
      platformToken ||
      "platform_default_webhook_token";

    return {
      ok: true,
      statusCode: 200,
      cfg,
      resolvedToken,
    };
  }

  async configForToken(token?: string, callId?: string): Promise<PlivoConfigRow | null> {
    if (token && token !== "platform_default_webhook_token") {
      const row = await db
        .selectFrom("tenant_telephony")
        .select([
          "id",
          "tenant_id",
          "provider",
          "account_sid",
          "auth_token_encrypted",
          "from_number",
          "webhook_token",
          "status",
        ])
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
          webhook_token: token || getPlatformPlivoWebhookToken() || "platform_default_webhook_token",
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
        webhook_token: token || getPlatformPlivoWebhookToken() || "platform_default_webhook_token",
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
    const callerId = escapeXml(params.callerId);
    const leadPhone = escapeXml(params.leadPhone);
    const hangupUrl = escapeXml(params.hangupUrl);
    const recordingUrl = escapeXml(params.recordingUrl);
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
      let matchQuery = db
        .selectFrom("voice_calls")
        .select(["id", "tenant_id"])
        .where((eb) =>
          eb.or([
            eb("external_call_id", "=", callUuid),
            eb("twilio_call_sid", "=", callUuid),
          ])
        );
      if (tenantId) {
        matchQuery = matchQuery.where("tenant_id", "=", tenantId);
      }
      const match = await matchQuery.executeTakeFirst();
      if (match) {
        matchedId = match.id;
        tenantId = tenantId || match.tenant_id;
        await query.where("id", "=", match.id).where("tenant_id", "=", tenantId).execute();
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
      let matchQuery = db
        .selectFrom("voice_calls")
        .select(["id", "tenant_id"])
        .where((eb) =>
          eb.or([
            eb("external_call_id", "=", callUuid),
            eb("twilio_call_sid", "=", callUuid),
          ])
        );
      if (tenantId) {
        matchQuery = matchQuery.where("tenant_id", "=", tenantId);
      }
      const match = await matchQuery.executeTakeFirst();
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
      let uq = db
        .updateTable("voice_calls")
        .set({
          recording_url: String(recordingUrl),
          updated_at: new Date(),
        })
        .where("id", "=", matchedId);
      if (tenantId) uq = uq.where("tenant_id", "=", tenantId);
      await uq.execute();

      if (tenantId) {
        void enqueueRecordingDownload({
          tenantId,
          callId: matchedId,
          provider: "plivo",
          recordingUrl: String(recordingUrl),
        });
      }
    } else if (callUuid) {
      let uq = db
        .updateTable("voice_calls")
        .set({
          recording_url: String(recordingUrl),
          updated_at: new Date(),
        })
        .where("external_call_id", "=", callUuid);
      if (tenantId) uq = uq.where("tenant_id", "=", tenantId);
      await uq.execute();

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

