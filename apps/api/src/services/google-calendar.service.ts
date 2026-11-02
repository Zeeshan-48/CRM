// Google Calendar integration (per-user OAuth), implemented with plain fetch, // no SDK dependency. Every entry point is gated by isEnabled(): with the client
// id/secret unset (or GOOGLE_CALENDAR_ENABLED=false) the whole feature is inert
// and the CRM keeps its native Jitsi + CRM-only-availability behavior.
//
// Phase 1 covers OAuth connect/disconnect + access-token lifecycle. Event push
// (Phase 2) and FreeBusy (Phase 3) build on getValidAccessToken().

import crypto from "crypto";
import config from "../config";
import calendarConnectionsRepository, {
  CalendarConnectionRow,
} from "../repositories/calendar-connections.repository";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import logger from "../utils/logger";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
// Meetings sync onto the connected account's PRIMARY calendar.
const CALENDAR_ID = "primary";

export interface GoogleEventInput {
  title: string;
  description?: string;
  startAt: Date;
  durationMin: number;
  timezone: string;
  online: boolean;
  attendeeEmail?: string | null;
}

export interface GoogleEventResult {
  eventId: string;
  meetUrl: string | null;
}

// Minimal scopes: create/update/delete our own events + read busy blocks, plus
// openid/email so we can label the connection with the account address.
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

// A signed, short-lived OAuth `state` carrying who is connecting, so the public
// callback (no JWT) can attribute the tokens without a server-side session and
// can't be forged (HMAC) or replayed (10-minute expiry).
interface OAuthState {
  tenantId: string;
  userId: string;
  ts: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

class GoogleCalendarService {
  isEnabled(): boolean {
    return Boolean(
      config.GOOGLE_CALENDAR_ENABLED && config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
    );
  }

  private signState(payload: OAuthState): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto
      .createHmac("sha256", config.JWT_SECRET)
      .update(body)
      .digest("base64url");
    return `${body}.${sig}`;
  }

  verifyState(token: string): OAuthState | null {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto
      .createHmac("sha256", config.JWT_SECRET)
      .update(body)
      .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthState;
      if (!parsed.tenantId || !parsed.userId || !parsed.ts) return null;
      if (Date.now() - parsed.ts > STATE_TTL_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  // Build the Google consent URL. access_type=offline + prompt=consent forces a
  // refresh token every time (Google only returns one on first consent unless
  // prompted), so a reconnect always re-establishes offline access.
  getAuthUrl(tenantId: string, userId: string): string {
    const state = this.signState({ tenantId, userId, ts: Date.now() });
    const params = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URL,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  // Exchange the authorization code and persist an encrypted connection for the
  // (tenant, user) in the signed state. Returns the connected account email.
  async handleCallback(code: string, state: string): Promise<{ tenantId: string; email: string | null }> {
    const parsed = this.verifyState(state);
    if (!parsed) throw new Error("invalid or expired OAuth state");

    const tokens = await this.exchangeCode(code);
    const email = this.emailFromIdToken(tokens.id_token) ?? null;
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

    await calendarConnectionsRepository.upsert({
      tenant_id: parsed.tenantId,
      user_id: parsed.userId,
      account_email: email,
      access_token_encrypted: encryptSecret(tokens.access_token),
      // Google omits refresh_token when the user has an existing grant; upsert
      // preserves the stored one when we pass null.
      refresh_token_encrypted: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null,
      token_expires_at: expiresAt,
      scope: tokens.scope ?? null,
      status: "CONNECTED",
    });

    return { tenantId: parsed.tenantId, email };
  }

  private async exchangeCode(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
  }> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URL,
        grant_type: "authorization_code",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !data.access_token) {
      throw new Error(
        `Google token exchange failed: ${res.status} ${JSON.stringify(data.error ?? data)}`
      );
    }
    return data as never;
  }

  // Decode the email claim from the id_token (a JWT) without verifying its
  // signature, it came straight from Google's token endpoint over TLS, so it's
  // trusted for display only. Never used for authorization.
  private emailFromIdToken(idToken?: string): string | null {
    if (!idToken) return null;
    const seg = idToken.split(".")[1];
    if (!seg) return null;
    try {
      const claims = JSON.parse(Buffer.from(seg, "base64url").toString()) as { email?: string };
      return claims.email ?? null;
    } catch {
      return null;
    }
  }

  // Return a usable access token for a connection, refreshing (and persisting)
  // it when it's within 60s of expiry. Throws if the connection has no refresh
  // token or the refresh is rejected (caller decides how to degrade).
  async getValidAccessToken(conn: CalendarConnectionRow): Promise<string> {
    const skewMs = 60 * 1000;
    if (
      conn.access_token_encrypted &&
      conn.token_expires_at &&
      new Date(conn.token_expires_at).getTime() - Date.now() > skewMs
    ) {
      return decryptSecret(conn.access_token_encrypted);
    }
    if (!conn.refresh_token_encrypted) {
      throw new Error("calendar connection has no refresh token; reconnect required");
    }

    const refreshToken = decryptSecret(conn.refresh_token_encrypted);
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      await calendarConnectionsRepository.markError(
        conn.id,
        `refresh failed: ${res.status} ${data.error ?? ""}`
      );
      throw new Error(`Google token refresh failed: ${res.status} ${data.error ?? ""}`);
    }
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
    await calendarConnectionsRepository.updateAccessToken(
      conn.id,
      encryptSecret(data.access_token),
      expiresAt
    );
    return data.access_token;
  }

  // ---- Event push (Phase 2) ----

  // Create an event on the connected account's primary calendar. For ONLINE
  // meetings we request a Google Meet link (conferenceDataVersion=1). Attendees
  // get Google's native invite + reminders (sendUpdates=all). Returns the event
  // id (stored to update/delete later) and the Meet URL when one was created.
  async createEvent(conn: CalendarConnectionRow, input: GoogleEventInput): Promise<GoogleEventResult> {
    const accessToken = await this.getValidAccessToken(conn);
    const endAt = new Date(input.startAt.getTime() + input.durationMin * 60_000);

    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description ?? "",
      start: { dateTime: input.startAt.toISOString(), timeZone: input.timezone },
      end: { dateTime: endAt.toISOString(), timeZone: input.timezone },
    };
    if (input.attendeeEmail) {
      body.attendees = [{ email: input.attendeeEmail }];
    }
    if (input.online) {
      body.conferenceData = {
        createRequest: {
          // Deterministic-ish unique id per create; Google requires a requestId.
          requestId: crypto.randomBytes(12).toString("hex"),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    // sendUpdates=all: Google sends the attendee its native calendar invitation
    // (accept/decline + the meeting on THEIR calendar + auto-reminders) from the
    // owner's connected account. To avoid double-emailing, meeting-invite.service
    // suppresses the CRM's own branded EMAIL for Google-synced meetings (it still
    // sends WhatsApp). For meetings that don't sync to Google (Jitsi fallback),
    // the branded email remains the sole email notification.
    const url = `${CALENDAR_API}/calendars/${CALENDAR_ID}/events?conferenceDataVersion=1&sendUpdates=all`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
      error?: unknown;
    };
    if (!res.ok || !data.id) {
      throw new Error(`Google event create failed: ${res.status} ${JSON.stringify(data.error ?? data)}`);
    }
    const meetUrl =
      data.hangoutLink ??
      data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
      null;
    return { eventId: data.id, meetUrl };
  }

  // Delete a previously-synced event. 404/410 (already gone) is treated as
  // success so cancelling a CRM meeting is idempotent.
  async deleteEvent(conn: CalendarConnectionRow, eventId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(conn);
    const url = `${CALENDAR_API}/calendars/${CALENDAR_ID}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google event delete failed: ${res.status} ${text}`);
    }
  }

  // ---- FreeBusy (Phase 3) ----

  // Busy intervals on the connected calendar within [from, to). One FreeBusy
  // call. A 4s timeout keeps scheduling responsive; callers treat a throw as
  // "unknown -> allow" (fail-open).
  async freeBusyBlocks(
    conn: CalendarConnectionRow,
    from: Date,
    to: Date
  ): Promise<Array<{ start: Date; end: Date }>> {
    const accessToken = await this.getValidAccessToken(conn);
    const res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: CALENDAR_ID }],
      }),
      signal: AbortSignal.timeout(4000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
      error?: unknown;
    };
    if (!res.ok) {
      throw new Error(`Google freeBusy failed: ${res.status} ${JSON.stringify(data.error ?? data)}`);
    }
    return (data.calendars?.[CALENDAR_ID]?.busy ?? []).map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }));
  }

  // Is the connected calendar busy anywhere in [startAt, endAt)? Used to block
  // double-booking against the owner's REAL calendar.
  async isBusy(conn: CalendarConnectionRow, startAt: Date, endAt: Date): Promise<boolean> {
    const blocks = await this.freeBusyBlocks(conn, startAt, endAt);
    return blocks.length > 0;
  }

  // Public-facing connection status for a user (no secrets).
  async status(
    tenantId: string,
    userId: string
  ): Promise<{ connected: boolean; email: string | null; status: string | null }> {
    const conn = await calendarConnectionsRepository.find(tenantId, userId);
    if (!conn) return { connected: false, email: null, status: null };
    return {
      connected: conn.status === "CONNECTED",
      email: conn.account_email,
      status: conn.status,
    };
  }

  // Best-effort revoke at Google, then delete the local connection. Revocation
  // failure never blocks disconnect, the row is removed regardless.
  async disconnect(tenantId: string, userId: string): Promise<void> {
    const conn = await calendarConnectionsRepository.find(tenantId, userId);
    if (conn?.refresh_token_encrypted) {
      try {
        const token = decryptSecret(conn.refresh_token_encrypted);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } catch (err) {
        logger.warn(`Google token revoke skipped for user ${userId}: ${err}`);
      }
    }
    await calendarConnectionsRepository.remove(tenantId, userId);
  }
}

export default new GoogleCalendarService();
