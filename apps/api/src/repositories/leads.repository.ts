import { Selectable, Transaction, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, lead_documents, leads } from "../db/types";
import type { lead_grade, lead_status } from "../db/enums";

export type LeadRow = Selectable<leads>;
export type LeadDocumentRow = Selectable<lead_documents>;

export interface LeadsListParams {
  q?: string;
  source?: string;
  /** Exact tag the lead must carry (e.g. "CSV Import"). */
  tag?: string;
  status?: lead_status;
  owner?: string;
  grade?: lead_grade;
  /** ISO cutoff, only leads created at/after this instant. */
  createdFrom?: string;
  /** ISO cutoff, only leads with activity at/after this instant. */
  lastActivityFrom?: string;
  /** ISO cutoff, only leads with activity at/before this instant. */
  lastActivityTo?: string;
  page?: number;
  limit?: number;
}

export interface CreateLeadData {
  tenant_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string;
  source?: string;
  campaign?: string | null;
  status?: lead_status;
  owner_id?: string | null;
  tags?: string[];
  socials?: Record<string, unknown> | null;
  notes?: string | null;
  budget?: boolean;
}

// A lead row for bulk insert, carrying its precomputed score so the importer
// never has to issue a follow-up UPDATE per row.
export interface BulkCreateLeadData extends CreateLeadData {
  score_total: number;
  score_grade: lead_grade;
  score_breakdown: unknown;
}

class LeadsRepository {
  async list(tenantId: string, params: LeadsListParams = {}) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(500, Math.max(1, params.limit ?? 100));
    const offset = (page - 1) * limit;

    let base = db.selectFrom("leads").where("tenant_id", "=", tenantId);
    if (params.source) base = base.where("source", "=", params.source);
    // Tag match via jsonb containment: the lead's `tags` array must include the
    // requested tag. Used by the "CSV Import" filter (and any tag) in the UI.
    if (params.tag)
      base = base.where(sql<boolean>`tags @> ${JSON.stringify([params.tag])}::jsonb`);
    if (params.status) base = base.where("status", "=", params.status);
    // "unassigned" is a sentinel for leads with no owner; any other value is an
    // exact owner-id match.
    if (params.owner === "unassigned") base = base.where("owner_id", "is", null);
    else if (params.owner) base = base.where("owner_id", "=", params.owner);
    if (params.grade) base = base.where("score_grade", "=", params.grade);
    if (params.createdFrom)
      base = base.where("created_at", ">=", new Date(params.createdFrom));
    // A lead that has never had activity keeps a null last_activity_at, so it is
    // (correctly) excluded from an "active since" window.
    if (params.lastActivityFrom)
      base = base.where(
        "last_activity_at",
        ">=",
        new Date(params.lastActivityFrom),
      );
    if (params.lastActivityTo)
      base = base.where(
        "last_activity_at",
        "<=",
        new Date(params.lastActivityTo),
      );
    if (params.q) {
      const s = `%${params.q}%`;
      base = base.where((eb) =>
        eb.or([
          eb("name", "ilike", s),
          eb("email", "ilike", s),
          eb("phone", "ilike", s),
          eb("city", "ilike", s),
          eb("source", "ilike", s),
        ])
      );
    }

    const countRow = await base
      .select(db.fn.count<number>("id").as("n"))
      .executeTakeFirst();
    const rows = await base
      .selectAll()
      .orderBy("score_total", "desc")
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    return { leads: rows, total: Number(countRow?.n ?? 0), page, limit };
  }

  async findById(id: string, tenantId: string): Promise<LeadRow | undefined> {
    return db
      .selectFrom("leads")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  // Case-insensitive lookup by email within a tenant. Used by public booking to
  // reuse an existing lead instead of creating a duplicate.
  async findByEmail(tenantId: string, email: string): Promise<LeadRow | undefined> {
    const trimmed = email.trim();
    if (!trimmed) return undefined;
    return db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("email", "ilike", trimmed)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  // Dedup lookup for inbound ingestion: match on email (case-insensitive) OR an
  // exact normalized phone. Newest match wins. Returns undefined when neither
  // identifier is provided.
  async findByEmailOrPhone(
    tenantId: string,
    email: string | null | undefined,
    phone: string | null | undefined
  ): Promise<LeadRow | undefined> {
    const e = (email ?? "").trim();
    const p = (phone ?? "").trim();
    if (!e && !p) return undefined;
    return db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where((eb) => {
        const ors = [];
        if (e) ors.push(eb("email", "ilike", e));
        if (p) ors.push(eb("phone", "=", p));
        return eb.or(ors);
      })
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }

  async findByIds(ids: string[], tenantId: string): Promise<LeadRow[]> {
    if (ids.length === 0) return [];
    return db
      .selectFrom("leads")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "in", ids)
      .execute();
  }

  async countByTenant(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("leads")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // Distinct, non-empty `source` values actually present on this tenant's leads.
  // Powers the Source filter so that any source a lead really has, including
  // arbitrary values that arrived via CSV import ("Webinar", "Website", …), is
  // selectable, not just the fixed built-in list.
  async distinctSources(tenantId: string): Promise<string[]> {
    const rows = await db
      .selectFrom("leads")
      .select("source")
      .distinct()
      .where("tenant_id", "=", tenantId)
      .where("source", "is not", null)
      .where("source", "!=", "")
      .execute();
    return rows.map((r) => r.source).filter((s): s is string => !!s);
  }

  // Tags worth offering in the Tag filter: only those shared by 2+ leads, so the
  // dropdown surfaces real segments (and the auto-applied "CSV Import" marker)
  // rather than the flood of per-lead one-off tags (external IDs like
  // "EUR-00886", etc.). Ranked by how many leads carry them, capped for a usable
  // list. Unnests the jsonb `tags` array, groups, and counts in SQL.
  async distinctTags(tenantId: string, limit = 50): Promise<string[]> {
    const rows = await sql<{ tag: string }>`
      SELECT tag
      FROM leads, jsonb_array_elements_text(tags) AS tag
      WHERE tenant_id = ${tenantId}
        AND jsonb_typeof(tags) = 'array'
        AND btrim(tag) <> ''
      GROUP BY tag
      HAVING count(*) >= 2
      ORDER BY count(*) DESC, tag ASC
      LIMIT ${limit}
    `.execute(db);
    return rows.rows.map((r) => r.tag);
  }

  async create(data: CreateLeadData, trx?: Transaction<DB>): Promise<LeadRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("leads")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        email: data.email ?? "",
        phone: data.phone ?? "",
        city: data.city ?? "",
        country: data.country ?? "India",
        source: data.source ?? "API",
        campaign: data.campaign ?? "",
        status: data.status ?? "NEW",
        owner_id: data.owner_id ?? null,
        tags: JSON.stringify(data.tags ?? []),
        socials: JSON.stringify(data.socials ?? {}),
        notes: data.notes ?? "",
        budget: data.budget ?? false,
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Loads every existing lead identifier for a tenant in one query, for fast
  // in-memory dedup during bulk import (avoids one lookup per row). Emails are
  // lower-cased; phones are compared as stored (already normalized).
  async existingIdentifiers(
    tenantId: string
  ): Promise<{ emails: Set<string>; phones: Set<string> }> {
    const rows = await db
      .selectFrom("leads")
      .select(["email", "phone"])
      .where("tenant_id", "=", tenantId)
      .execute();
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const r of rows) {
      if (r.email) emails.add(r.email.trim().toLowerCase());
      if (r.phone) phones.add(r.phone.trim());
    }
    return { emails, phones };
  }

  // Inserts many leads (with precomputed scores) in chunked multi-row INSERTs,
  // instead of one round-trip per lead. Returns the inserted rows.
  async bulkCreate(rows: BulkCreateLeadData[]): Promise<LeadRow[]> {
    if (rows.length === 0) return [];
    const now = new Date();
    const values = rows.map((data) => ({
      id: ulid(),
      tenant_id: data.tenant_id,
      name: data.name,
      email: data.email ?? "",
      phone: data.phone ?? "",
      city: data.city ?? "",
      country: data.country ?? "India",
      source: data.source ?? "API",
      campaign: data.campaign ?? "",
      status: data.status ?? "NEW",
      owner_id: data.owner_id ?? null,
      tags: JSON.stringify(data.tags ?? []),
      notes: data.notes ?? "",
      budget: data.budget ?? false,
      score_total: data.score_total,
      score_grade: data.score_grade,
      score_breakdown: JSON.stringify(data.score_breakdown),
      scored_at: now,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    }));

    // Chunk to stay well under Postgres' bind-parameter ceiling (~65k).
    const CHUNK = 500;
    const inserted: LeadRow[] = [];
    for (let i = 0; i < values.length; i += CHUNK) {
      const batch = values.slice(i, i + CHUNK);
      const rowsBack = await db.insertInto("leads").values(batch).returningAll().execute();
      inserted.push(...rowsBack);
    }
    return inserted;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<{
      name: string;
      email: string;
      phone: string;
      city: string;
      country: string;
      source: string;
      campaign: string;
      status: lead_status;
      tags: string[];
      socials: Record<string, unknown>;
      notes: string;
      budget: boolean;
      owner_id: string | null;
      converted_contact_id: string | null;
      converted_deal_id: string | null;
      last_activity_at: Date;
    }>,
    trx?: Transaction<DB>
  ): Promise<LeadRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    const direct = [
      "name",
      "email",
      "phone",
      "city",
      "country",
      "source",
      "campaign",
      "status",
      "notes",
      "budget",
      "owner_id",
      "converted_contact_id",
      "converted_deal_id",
      "last_activity_at",
    ] as const;
    for (const key of direct) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (data.tags !== undefined) patch.tags = JSON.stringify(data.tags);
    if (data.socials !== undefined) patch.socials = JSON.stringify(data.socials);

    return (trx || db)
      .updateTable("leads")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .deleteFrom("leads")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  // ---- Lead detail aggregate (activities, messages, deals, calls, docs) ----

  async detailRelations(tenantId: string, leadId: string) {
    const [activities, messages, deals, calls, documents] = await Promise.all([
      db
        .selectFrom("activities")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("messages")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .orderBy("at", "asc")
        .execute(),
      db
        .selectFrom("deals")
        .leftJoin("stages", "stages.id", "deals.stage_id")
        .selectAll("deals")
        .select("stages.name as stage_name")
        .where("deals.tenant_id", "=", tenantId)
        .where("deals.lead_id", "=", leadId)
        .execute(),
      db
        .selectFrom("voice_calls")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .orderBy("created_at", "desc")
        .execute(),
      this.documents(tenantId, leadId),
    ]);
    return { activities, messages, deals, calls, documents };
  }

  // ---- Documents ----

  async documents(tenantId: string, leadId: string): Promise<LeadDocumentRow[]> {
    return db
      .selectFrom("lead_documents")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("lead_id", "=", leadId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async addDocument(data: {
    tenant_id: string;
    lead_id: string;
    name: string;
    doc_type?: string | null;
    file_key?: string | null;
    url?: string | null;
    uploaded_by?: string | null;
  }): Promise<LeadDocumentRow> {
    return db
      .insertInto("lead_documents")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        lead_id: data.lead_id,
        name: data.name,
        doc_type: data.doc_type ?? "file",
        file_key: data.file_key ?? null,
        url: data.url ?? null,
        uploaded_by: data.uploaded_by ?? null,
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

export default new LeadsRepository();
