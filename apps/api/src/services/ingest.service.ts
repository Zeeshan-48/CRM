import { sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import { BadRequestError, UnauthorizedError } from "../errors";
import ingestRepository from "../repositories/ingest.repository";
import leadsRepository from "../repositories/leads.repository";
import tenantsRepository from "../repositories/tenants.repository";
import { normalizePhone } from "../utils/phone";
import engineService from "./engine.service";
import leadsService from "./leads.service";

// A filled honeypot field marks a bot: forms hide these, only bots fill them.
const HONEYPOT_FIELDS = ["_gotcha", "honeypot", "_honey", "bot-field"];

// Payload keys we map onto real lead fields; everything else is preserved into
// notes so no submitted data is silently dropped.
const CONSUMED_KEYS = new Set([
  ...HONEYPOT_FIELDS,
  "name",
  "full_name",
  "fullname",
  "first_name",
  "firstname",
  "last_name",
  "lastname",
  "email",
  "email_address",
  "work_email",
  "phone",
  "phone_number",
  "mobile",
  "company",
  "company_name",
  "organization",
  "city",
  "country",
  "source",
  "campaign",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "tags",
  "notes",
  "message",
  "external_id",
  "id",
  "leadgen_id",
  "idempotency_key",
]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

const pick = (body: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const val = str(body[k]);
    if (val) return val;
  }
  return "";
};

export interface MappedLead {
  name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  source: string;
  campaign: string;
  notes: string;
  tags: string[];
  externalId: string | null;
  honeypot: boolean;
}

export interface IngestContext {
  tenantId: string;
  apiKeyId: string | null;
  apiKeyCreatedBy: string | null;
  defaultSource: string;
  // ---- Connected-product context ----
  // Present for every API-key authenticated call (authenticateApiKey resolves
  // exactly one app per key). Absent only on the no-code token lead route, which
  // predates connected products and captures leads without any product context.
  appId?: string;
  appName?: string;
  /** TEST-environment traffic is ingested but excluded from lead scoring. */
  environment?: "LIVE" | "TEST";
}

export interface IngestResult {
  ok: true;
  leadId: string | null;
  deduped: boolean;
  spam?: boolean;
}

class IngestService {
  // ---- Payload mapping ----

  mapPayload(raw: unknown, defaultSource: string): MappedLead {
    const body =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

    const honeypot = HONEYPOT_FIELDS.some((f) => str(body[f]).length > 0);

    const first = pick(body, "first_name", "firstname");
    const last = pick(body, "last_name", "lastname");
    const name =
      pick(body, "name", "full_name", "fullname") ||
      [first, last].filter(Boolean).join(" ");

    const email = pick(body, "email", "email_address", "work_email").toLowerCase();
    const rawPhone = pick(body, "phone", "phone_number", "mobile");
    const phone = rawPhone ? normalizePhone(rawPhone) : "";
    const company = pick(body, "company", "company_name", "organization");
    const city = pick(body, "city");
    const country = pick(body, "country");
    const source = pick(body, "source") || defaultSource;
    const campaign = pick(body, "campaign", "utm_campaign");

    const tags: string[] = [];
    if (Array.isArray(body.tags)) {
      for (const t of body.tags) if (str(t)) tags.push(str(t));
    }
    const utmSource = pick(body, "utm_source");
    const utmMedium = pick(body, "utm_medium");
    if (utmSource) tags.push(`utm:${utmSource}`);
    if (utmMedium) tags.push(`utm:${utmMedium}`);

    // Notes: explicit message/notes, the company, and any unmapped custom fields.
    const noteLines: string[] = [];
    const message = pick(body, "notes", "message");
    if (message) noteLines.push(message);
    if (company) noteLines.push(`Company: ${company}`);
    for (const [k, v] of Object.entries(body)) {
      if (CONSUMED_KEYS.has(k)) continue;
      const val = str(v);
      if (val) noteLines.push(`${k}: ${val}`);
    }

    const externalId =
      pick(body, "idempotency_key", "external_id", "leadgen_id", "id") || null;

    return {
      name,
      email,
      phone,
      city,
      country,
      source,
      campaign,
      notes: noteLines.join("\n"),
      tags,
      externalId,
      honeypot,
    };
  }

  // ---- Ingest ----

  async ingestLead(ctx: IngestContext, raw: unknown): Promise<IngestResult> {
    const mapped = this.mapPayload(raw, ctx.defaultSource);
    const payload =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

    // Honeypot: silently accept so bots learn nothing, but create no lead.
    if (mapped.honeypot) {
      await this.record(ctx, mapped, "SPAM", null, "honeypot triggered", payload);
      return { ok: true, leadId: null, deduped: false, spam: true };
    }

    if (!mapped.name && !mapped.email && !mapped.phone) {
      await this.record(ctx, mapped, "REJECTED", null, "no name, email or phone", payload);
      throw new BadRequestError("Provide at least a name, email or phone");
    }

    // Idempotency: a prior event for this external_id short-circuits redeliveries.
    if (mapped.externalId) {
      const prior = await ingestRepository.findByExternalId(ctx.tenantId, mapped.externalId);
      if (prior) {
        return { ok: true, leadId: prior.lead_id, deduped: true };
      }
    }

    // Dedup: an existing lead with the same email / phone is updated, not
    // duplicated (the web-lead norm), and the existing id is returned.
    const existing = await leadsRepository.findByEmailOrPhone(
      ctx.tenantId,
      mapped.email,
      mapped.phone
    );
    if (existing) {
      await this.enrichExisting(ctx, existing.id, mapped);
      await this.record(ctx, mapped, "DEDUPED", existing.id, null, payload);
      engineService.audit(ctx.tenantId, ctx.apiKeyCreatedBy, "lead.ingested", "lead", existing.id, {
        source: mapped.source,
        deduped: true,
        via: ctx.apiKeyId ? "api_key" : "token",
      });
      return { ok: true, leadId: existing.id, deduped: true };
    }

    // New lead: reuse the same write path as the UI (capacity -> score ->
    // lead.created automation -> auto-assign -> journey enroll).
    const actorId = await this.resolveActor(ctx.tenantId, ctx.apiKeyCreatedBy);
    let lead;
    try {
      lead = await leadsService.create(ctx.tenantId, actorId, {
        name: mapped.name,
        email: mapped.email,
        phone: mapped.phone,
        city: mapped.city,
        country: mapped.country,
        source: mapped.source,
        campaign: mapped.campaign,
        notes: mapped.notes,
        tags: mapped.tags,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "create failed";
      await this.record(ctx, mapped, "REJECTED", null, reason, payload);
      throw err;
    }

    // Stamp provenance (best-effort; never fails the ingest).
    await db
      .updateTable("leads")
      .set({ external_id: mapped.externalId, external_source: mapped.source })
      .where("id", "=", lead.id)
      .where("tenant_id", "=", ctx.tenantId)
      .execute()
      .catch(() => undefined);

    await this.record(ctx, mapped, "CREATED", lead.id, null, payload);
    engineService.audit(ctx.tenantId, ctx.apiKeyCreatedBy, "lead.ingested", "lead", lead.id, {
      source: mapped.source,
      deduped: false,
      via: ctx.apiKeyId ? "api_key" : "token",
    });
    return { ok: true, leadId: lead.id, deduped: false };
  }

  // Fill only-empty fields on a matched lead and merge tags. Never overwrites
  // data a human already entered.
  private async enrichExisting(
    ctx: IngestContext,
    leadId: string,
    mapped: MappedLead
  ): Promise<void> {
    const lead = await leadsRepository.findById(leadId, ctx.tenantId);
    if (!lead) return;
    const patch: Parameters<typeof leadsRepository.update>[2] = {};
    if (!lead.email && mapped.email) patch.email = mapped.email;
    if (!lead.phone && mapped.phone) patch.phone = mapped.phone;
    if (!lead.city && mapped.city) patch.city = mapped.city;
    if (!lead.campaign && mapped.campaign) patch.campaign = mapped.campaign;

    if (mapped.tags.length) {
      const current = Array.isArray(lead.tags) ? (lead.tags as unknown[]).map(String) : [];
      const merged = Array.from(new Set([...current, ...mapped.tags]));
      if (merged.length !== current.length) patch.tags = merged;
    }
    if (mapped.notes) {
      const stamp = new Date().toISOString().slice(0, 10);
      patch.notes = `${lead.notes ? `${lead.notes}\n\n` : ""}[Re-submitted ${stamp} via ${mapped.source}]\n${mapped.notes}`;
    }
    if (Object.keys(patch).length) {
      await leadsRepository.update(leadId, ctx.tenantId, patch);
    }
  }

  // A real active user to own the lead + attribute audits. Prefers the API key's
  // creator, then any ADMIN, then any active user.
  private async resolveActor(tenantId: string, createdBy: string | null): Promise<string> {
    if (createdBy) {
      const u = await db
        .selectFrom("users")
        .select(["id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", createdBy)
        .where("status", "=", "ACTIVE")
        .executeTakeFirst();
      if (u) return u.id;
    }
    const admin = await db
      .selectFrom("users")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "ACTIVE")
      .where("role", "=", "ADMIN")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (admin) return admin.id;
    const any = await db
      .selectFrom("users")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "ACTIVE")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (any) return any.id;
    throw new BadRequestError("Workspace has no active user to own ingested leads");
  }

  private async record(
    ctx: IngestContext,
    mapped: MappedLead,
    status: "CREATED" | "DEDUPED" | "REJECTED" | "SPAM",
    leadId: string | null,
    error: string | null,
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      await ingestRepository.createEvent({
        tenant_id: ctx.tenantId,
        api_key_id: ctx.apiKeyId,
        source: mapped.source,
        external_id: mapped.externalId,
        status,
        lead_id: leadId,
        error,
        payload,
      });
    } catch {
      // A duplicate external_id (idempotency race) or any log failure must not
      // break the response; the lead itself is already handled.
    }
  }

  // ---- Per-tenant ingest token (no-code URL variant) ----

  private tokenFromConfig(config: Record<string, unknown> | null): string | null {
    const t = config && typeof config === "object" ? config["ingestToken"] : null;
    return typeof t === "string" && t ? t : null;
  }

  // Returns the token, minting + persisting one on first read.
  async getOrCreateToken(tenantId: string): Promise<string> {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new BadRequestError("Workspace not found");
    const config = (tenant.config as Record<string, unknown> | null) ?? null;
    const existing = this.tokenFromConfig(config);
    if (existing) return existing;
    return this.rotateToken(tenantId, null);
  }

  async rotateToken(tenantId: string, actorId: string | null): Promise<string> {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new BadRequestError("Workspace not found");
    const token = `lit_${ulid()}`;
    const config =
      tenant.config && typeof tenant.config === "object"
        ? (tenant.config as Record<string, unknown>)
        : {};
    await tenantsRepository.update(tenantId, { config: { ...config, ingestToken: token } });
    if (actorId) {
      engineService.audit(tenantId, actorId, "ingest.token_rotated", "tenant", tenantId);
    }
    return token;
  }

  // Resolves the tenant that owns an ingest token (constant-time-ish compare via
  // a direct match on the extracted JSON field). Returns the tenant id or throws.
  async tenantForToken(token: string): Promise<string> {
    const t = token.trim();
    if (!t || !t.startsWith("lit_")) throw new UnauthorizedError("Invalid ingest token");
    const row = await db
      .selectFrom("tenants")
      .select(["id", "status"])
      .where(sql<boolean>`config->>'ingestToken' = ${t}`)
      .executeTakeFirst();
    if (!row) throw new UnauthorizedError("Invalid ingest token");
    if (row.status !== "ACTIVE") throw new UnauthorizedError("Workspace is not active");
    return row.id;
  }

  async listEvents(tenantId: string, limit = 50) {
    return ingestRepository.list(tenantId, limit);
  }
}

export default new IngestService();
