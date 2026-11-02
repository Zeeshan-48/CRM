import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { calendar_connections } from "../db/types";

export type CalendarConnectionRow = Selectable<calendar_connections>;

export interface UpsertConnectionData {
  tenant_id: string;
  user_id: string;
  provider?: string;
  account_email?: string | null;
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expires_at?: Date | null;
  scope?: string | null;
  status?: string;
  last_error?: string | null;
}

const PROVIDER = "GOOGLE";

// Per-user link to an external calendar. All lookups are scoped by tenant +
// user + provider so one user's connection is never visible to another.
class CalendarConnectionsRepository {
  async find(
    tenantId: string,
    userId: string,
    provider = PROVIDER
  ): Promise<CalendarConnectionRow | undefined> {
    return db
      .selectFrom("calendar_connections")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .where("provider", "=", provider)
      .executeTakeFirst();
  }

  // Insert or update the single (tenant, user, provider) row. On reconnect we
  // keep the existing refresh token when Google omits one (it only returns a
  // refresh token on the first consent), so callers pass null to preserve it.
  async upsert(data: UpsertConnectionData): Promise<CalendarConnectionRow> {
    const provider = data.provider ?? PROVIDER;
    const now = new Date();
    const existing = await this.find(data.tenant_id, data.user_id, provider);

    if (existing) {
      return db
        .updateTable("calendar_connections")
        .set({
          account_email: data.account_email ?? existing.account_email,
          access_token_encrypted:
            data.access_token_encrypted ?? existing.access_token_encrypted,
          refresh_token_encrypted:
            data.refresh_token_encrypted ?? existing.refresh_token_encrypted,
          token_expires_at:
            data.token_expires_at !== undefined
              ? data.token_expires_at
              : existing.token_expires_at,
          scope: data.scope ?? existing.scope,
          status: data.status ?? "CONNECTED",
          last_error: data.last_error ?? null,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return db
      .insertInto("calendar_connections")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        user_id: data.user_id,
        provider,
        account_email: data.account_email ?? null,
        access_token_encrypted: data.access_token_encrypted ?? null,
        refresh_token_encrypted: data.refresh_token_encrypted ?? null,
        token_expires_at: data.token_expires_at ?? null,
        scope: data.scope ?? null,
        sync_enabled: true,
        status: data.status ?? "CONNECTED",
        last_error: data.last_error ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Persist a freshly-refreshed access token + expiry (refresh token unchanged).
  async updateAccessToken(
    id: string,
    accessTokenEncrypted: string,
    expiresAt: Date
  ): Promise<void> {
    await db
      .updateTable("calendar_connections")
      .set({
        access_token_encrypted: accessTokenEncrypted,
        token_expires_at: expiresAt,
        status: "CONNECTED",
        last_error: null,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
  }

  // Mark a connection as errored (e.g. refresh token revoked) without deleting
  // it, so the UI can prompt a reconnect.
  async markError(id: string, message: string): Promise<void> {
    await db
      .updateTable("calendar_connections")
      .set({ status: "ERROR", last_error: message.slice(0, 500), updated_at: new Date() })
      .where("id", "=", id)
      .execute();
  }

  async remove(tenantId: string, userId: string, provider = PROVIDER): Promise<void> {
    await db
      .deleteFrom("calendar_connections")
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .where("provider", "=", provider)
      .execute();
  }
}

export default new CalendarConnectionsRepository();
