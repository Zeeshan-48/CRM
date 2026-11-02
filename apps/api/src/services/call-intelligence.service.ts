import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import { ulid } from "ulid";
import config from "../config";
import { db } from "../db/connection";
import type { message_direction } from "../db/enums";
import telephonyRepository from "../repositories/telephony.repository";
import logger from "../utils/logger";
import { aiProvider } from "./ai/provider";
import { sentiment } from "./ai/heuristics";
import engineService from "./engine.service";
import exotelClient from "./exotel.client";
import scoringService from "./scoring.service";
import storageService from "./storage.service";
import telephonyResolverService from "./telephony-resolver.service";

// Post-call pipeline for human telephony calls: mirror the recording into our
// own storage, transcribe it when the platform has an AI key, summarize, and
// write the CRM side effects (activity, last-activity bump, rescoring).
//
// Everything here runs AFTER the call, fired-and-forgotten from webhooks and
// retried by the exotel-sync sweep. Nothing in this file may ever block or fail
// a webhook response.

interface IntelligenceState {
  attempted_user_ids?: string[];
  intelligence_done?: boolean;
  transcription_failed?: boolean;
  [key: string]: unknown;
}

const parseState = (raw: unknown): IntelligenceState => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as IntelligenceState;
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as IntelligenceState) : {};
};

// Transcription is skipped under tests (no network) even though the rest of
// the pipeline runs, so webhook tests still exercise mirroring + side effects.
const underTest = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true";

class CallIntelligenceService {
  /**
   * Idempotent: `structured_data.intelligence_done` guards the side effects, so
   * a StatusCallback, a Passthru and the sweep can all call this for the same
   * call and the activity is written exactly once.
   */
  async processCall(callId: string): Promise<void> {
    try {
      const call = await db
        .selectFrom("voice_calls")
        .selectAll()
        .where("id", "=", callId)
        .executeTakeFirst();
      if (!call || call.provider !== "exotel") return;

      const state = parseState(call.structured_data);

      // ---- 1. Mirror the recording (Exotel URLs require basic auth) ----
      let recordingKey =
        call.recording_url && !call.recording_url.startsWith("http")
          ? call.recording_url
          : null;
      let audio: Buffer | null = null;

      if (call.recording_url?.startsWith("http") && call.external_call_id) {
        const resolved = await telephonyResolverService.resolveExotel(call.tenant_id);
        if (resolved.mode === "tenant") {
          audio = await exotelClient.downloadRecording(resolved.creds, call.recording_url);
          if (audio) {
            const key = `telephony/${call.tenant_id}/${call.external_call_id}.mp3`;
            try {
              await storageService.upload({ key, body: audio, contentType: "audio/mpeg" });
              recordingKey = key;
            } catch (err) {
              // Keep the Exotel URL so the sweep retries the mirror; the rest
              // of the pipeline can still run off the in-memory buffer.
              logger.warn(`call recording mirror failed for ${callId}: ${String(err)}`);
            }
          }
        }
      }

      // Side effects and transcription run exactly once; the mirror alone may
      // retry after that (RecordingUrl often lands minutes after the terminal
      // callback, so intelligence_done + an http URL is the normal sweep case,
      // not an error).
      if (state.intelligence_done) {
        if (recordingKey && call.recording_url?.startsWith("http") && call.external_call_id) {
          await telephonyRepository.updateCallByExternalId(call.external_call_id, {
            recording_url: recordingKey,
          });
        }
        return;
      }

      // ---- 2. Transcribe + summarize (fail-soft; metadata-only without AI) ----
      let transcriptText: string | null = null;
      if (audio && !underTest() && !state.transcription_failed) {
        transcriptText = await this.transcribe(audio);
        if (transcriptText === null) state.transcription_failed = true;
      }

      let summary: string | null = call.summary;
      let sentimentLabel: string | null = call.sentiment_label;
      let sentimentScore: number | null = call.sentiment_score;
      let transcript: Array<{ speaker: string; text: string }> | null = null;

      if (transcriptText) {
        try {
          summary = await aiProvider.summarize(transcriptText);
        } catch {
          summary = transcriptText.slice(0, 280);
        }
        const senti = sentiment(transcriptText);
        sentimentLabel = senti.label;
        sentimentScore = senti.score;
        // One flat "call" speaker: Exotel's dual-channel recording is a single
        // file to us; the existing CallRow transcript UI renders this fine.
        transcript = [{ speaker: "call", text: transcriptText }];
      }

      // ---- 3. Side effects, exactly once ----
      state.intelligence_done = true;
      await telephonyRepository.updateCallByExternalId(call.external_call_id ?? "", {
        recording_url: recordingKey ?? call.recording_url,
        summary,
        sentiment_label: sentimentLabel,
        sentiment_score: sentimentScore,
        ...(transcript ? { transcript } : {}),
        ...(call.outcome ? {} : { outcome: "COMPLETED" }),
        structured_data: state,
      });

      await this.recordSideEffects(call, {
        summary: summary ?? "Phone call",
        durationSec: call.duration_sec ?? 0,
      });
    } catch (err) {
      logger.warn(`call intelligence for ${callId}: ${String(err)}`);
    }
  }

  private async transcribe(audio: Buffer): Promise<string | null> {
    try {
      if (config.OPENAI_API_KEY) {
        const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
        const result = await client.audio.transcriptions.create({
          model: "whisper-1",
          file: await toFile(audio, "call.mp3", { type: "audio/mpeg" }),
        });
        return result.text?.trim() || null;
      }
      if (config.GEMINI_API_KEY) {
        const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
        const res = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: "Transcribe this sales call verbatim. Output only the transcript text, no preamble.",
                },
                { inlineData: { mimeType: "audio/mp3", data: audio.toString("base64") } },
              ],
            },
          ],
        });
        return res.text?.trim() || null;
      }
      return null;
    } catch (err) {
      logger.warn(`call transcription failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * The CRM footprint of a finished human call. Public so the manual-log path
   * (agent dialed from their personal SIM) reuses it verbatim.
   */
  async recordSideEffects(
    call: {
      id: string;
      tenant_id: string;
      lead_id: string | null;
      contact_id: string | null;
      agent_user_id: string | null;
      direction: string;
    },
    info: { summary: string; durationSec: number; notes?: string | null }
  ): Promise<void> {
    try {
      const now = new Date();
      await db
        .insertInto("activities")
        .values({
          id: ulid(),
          tenant_id: call.tenant_id,
          type: "CALL",
          direction: (call.direction === "INBOUND" ? "INBOUND" : "OUTBOUND") as message_direction,
          subject: call.direction === "INBOUND" ? "Inbound phone call" : "Phone call",
          notes: info.notes ?? info.summary,
          owner_id: call.agent_user_id,
          lead_id: call.lead_id,
          contact_id: call.contact_id,
          duration_sec: info.durationSec,
          ai_generated: false,
          created_at: now,
          updated_at: now,
        })
        .execute();

      if (call.lead_id) {
        await db
          .updateTable("leads")
          .set({ last_activity_at: now, updated_at: now })
          .where("id", "=", call.lead_id)
          .where("tenant_id", "=", call.tenant_id)
          .execute();
        scoringService.recomputeInBackground(call.tenant_id, call.lead_id);
      }
      if (call.contact_id) {
        await db
          .updateTable("contacts")
          .set({ last_activity_at: now, updated_at: now })
          .where("id", "=", call.contact_id)
          .where("tenant_id", "=", call.tenant_id)
          .execute();
      }

      if (call.agent_user_id) {
        engineService.audit(
          call.tenant_id,
          call.agent_user_id,
          "telephony.call_processed",
          "voice_call",
          call.id,
          {}
        );
      }
    } catch (err) {
      // A side-effect failure must never lose the call data itself.
      logger.warn(`call side effects for ${call.id}: ${String(err)}`);
    }
  }
}

export default new CallIntelligenceService();
