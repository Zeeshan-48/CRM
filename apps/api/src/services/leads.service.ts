import { ulid } from "ulid";
import {
  CSV_IMPORT_TAG,
  getLeadAccountCandidate,
  isLeadImportType,
  normalizeExtraFieldsForType,
  type LeadImportAssignmentSpec,
  type LeadImportType,
} from "../constants/lead-import.const";
import { LIMIT_CODES } from "../constants/modules.const";
import { db } from "../db/connection";
import type { lead_status } from "../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { enqueueLeadImport, getLeadImportProgress } from "../queue/lead-import.queue";
import identitiesRepository from "../repositories/identities.repository";
import leadsRepository, {
  BulkCreateLeadData,
  LeadRow,
  LeadsListParams,
} from "../repositories/leads.repository";
import logger from "../utils/logger";
import { normalizePhoneForStore } from "../utils/phone";
import {
  assertCanBulk,
  assertCanManageRecord,
  assertCanReassign,
} from "../utils/record-policy";
import { dealHealth, LeadScore, LEAD_SOURCES, scoreLead } from "./ai/heuristics";
import { isModelGenerated, rememberInsight } from "./ai/insight-cache";
import { aiProvider } from "./ai/provider";
import engagementService from "./engagement.service";
import engineService from "./engine.service";
import entitlementsService from "./entitlements.service";
import {
  notifyAssignedImportOwners,
  prepareBulkImportChunk,
  validateImportAccess,
  validateImportAssignment,
} from "./lead-import-batch.service";
import scoringService from "./scoring.service";
import storageService from "./storage.service";

export { CSV_IMPORT_TAG };

export const ASSIGNMENT_STRATEGIES = [
  "ROUND_ROBIN",
  "AI",
  "SKILL_BASED",
  "TERRITORY_BASED",
  "MANUAL",
] as const;

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

// Website + social profile links: a free-form { network: url } object. Keeps
// only non-empty string values so blank fields never persist as noise.
const parseSocials = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim()) out[key] = raw.trim();
  }
  return out;
};

const storedScore = (lead: LeadRow): LeadScore => {
  const breakdown = lead.score_breakdown as Partial<LeadScore> | null;
  if (breakdown && typeof breakdown.total === "number") return breakdown as LeadScore;
  return {
    interest: 0,
    intent: 0,
    engagement: 0,
    risk: 0,
    total: lead.score_total,
    grade: lead.score_grade,
  };
};

const withScore = (lead: LeadRow) => ({
  ...lead,
  status: lead.converted_contact_id ? "CONVERTED" : lead.status,
  score: storedScore(lead),
});

class LeadsService {
  // The Source filter/picker list: the built-in sources UNION whatever sources
  // the tenant's leads actually carry. Without the union, CSV-imported leads, // which keep their file's own `source` (e.g. "Webinar", "Website") and only
  // fall back to "CSV Upload" when that cell is blank, are invisible to the
  // filter, because their source isn't in the fixed built-in list.
  async sources(tenantId: string): Promise<string[]> {
    const tenantSources = await leadsRepository.distinctSources(tenantId);
    // "CSV Upload" is superseded by the "CSV Import" tag: imported leads keep
    // their real source (Webinar/Website/…) and are marked with that tag, so
    // "CSV Upload" is only ever set on a blank-source import row. Drop it from
    // the fixed built-ins so it isn't offered as a permanently-empty filter that
    // lures a click and returns 0, it still appears below (via tenantSources)
    // IF a lead genuinely has it.
    const builtins = LEAD_SOURCES.filter((s) => s !== "CSV Upload");
    const seen = new Set<string>();
    const merged: string[] = [];
    // Built-in sources first (stable, familiar order), then any extra real ones.
    for (const s of [...builtins, ...tenantSources]) {
      const key = s.trim();
      if (!key) continue;
      const dedupeKey = key.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push(key);
    }
    return merged;
  }

  // Distinct tags in use across the tenant's leads, for the Tag filter. Sorted,
  // but with the "CSV Import" batch marker pinned first when present so it's easy
  // to find.
  async tags(tenantId: string): Promise<string[]> {
    const tags = await leadsRepository.distinctTags(tenantId);
    const sorted = tags.sort((a, b) => a.localeCompare(b));
    return sorted.sort((a, b) => {
      if (a === CSV_IMPORT_TAG) return -1;
      if (b === CSV_IMPORT_TAG) return 1;
      return 0;
    });
  }

  assignmentStrategies(): readonly string[] {
    return ASSIGNMENT_STRATEGIES;
  }

  async list(tenantId: string, params: LeadsListParams) {
    const result = await leadsRepository.list(tenantId, params);
    return { ...result, leads: result.leads.map(withScore) };
  }

  async detail(tenantId: string, leadId: string) {
    const lead = await leadsRepository.findById(leadId, tenantId);
    if (!lead) throw new NotFoundError("Lead not found");
    const relations = await leadsRepository.detailRelations(tenantId, leadId);
    return { ...withScore(lead), ...relations };
  }

  async create(
    tenantId: string,
    actorId: string,
    body: {
      name?: string;
      email?: string;
      phone?: string;
      city?: string;
      country?: string;
      source?: string;
      campaign?: string;
      notes?: string;
      tags?: string[];
      socials?: unknown;
      budget?: boolean;
      owner_id?: string | null;
      import_type?: string | null;
      extra_fields?: unknown;
    }
  ) {
    if (!body.name && !body.email && !body.phone) {
      throw new BadRequestError("Provide at least a name, email or phone");
    }

    // Enforce uniqueness: a lead's email/phone must not already belong to another
    // lead in this tenant. Compare on the same normalized phone we store.
    const email = body.email?.trim() || undefined;
    const phone = normalizePhoneForStore(body.phone);
    const phoneKey = typeof phone === "string" && phone ? phone : undefined;
    if (email || phoneKey) {
      const existing = await leadsRepository.findByEmailOrPhone(tenantId, email, phoneKey);
      if (existing) {
        const emailClash =
          !!email && !!existing.email && existing.email.toLowerCase() === email.toLowerCase();
        throw new ConflictError(
          emailClash
            ? "A lead with this email already exists."
            : "A lead with this phone number already exists."
        );
      }
    }

    const currentLeads = await leadsRepository.countByTenant(tenantId);
    await entitlementsService.ensureCapacity(
      tenantId,
      LIMIT_CODES.LEADS,
      currentLeads,
      1,
      "leads"
    );

    const lead = await leadsRepository.create({
      tenant_id: tenantId,
      name: body.name || "Unknown",
      email: body.email,
      phone,
      city: body.city,
      country: body.country,
      source: body.source ?? "API",
      campaign: body.campaign,
      owner_id: body.owner_id ?? null,
      tags: body.tags ?? [],
      socials: parseSocials(body.socials) ?? {},
      notes: body.notes,
      budget: !!body.budget,
      import_type: isLeadImportType(body.import_type) ? body.import_type : null,
      extra_fields:
        body.extra_fields && typeof body.extra_fields === "object"
          ? normalizeExtraFieldsForType(body.import_type, body.extra_fields)
          : null,
    });

    const score = await scoringService.recompute(tenantId, lead.id);
    const runs = await engineService.emit(tenantId, actorId, "lead.created", { lead });
    engineService.audit(tenantId, actorId, "lead.created", "lead", lead.id, {
      source: lead.source,
    });

    // Workflows may have re-assigned/tagged the lead; return the fresh row.
    const fresh = await leadsRepository.findById(lead.id, tenantId);
    let current = fresh ?? lead;
    // Auto-assign using the workspace default strategy, unless an explicit owner
    // was supplied (or explicitly unassigned) or a workflow already claimed the lead.
    const assigned =
      body.owner_id === undefined
        ? await this.autoAssign(tenantId, actorId, current)
        : null;
    if (assigned) current = assigned;
    return { ...withScore(current), score: score ?? storedScore(lead), automationRuns: runs.length };
  }

  async bulkImport(
    tenantId: string,
    actorId: string,
    actorRole: string,
    rows: unknown,
    options?: {
      async?: boolean;
      importType?: LeadImportType;
      assignment?: Partial<LeadImportAssignmentSpec>;
      skipDuplicates?: boolean;
    }
  ) {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestError("rows[] required");

    const { importType } = await validateImportAccess(tenantId, options?.importType);
    const assignment = await validateImportAssignment(
      tenantId,
      actorId,
      actorRole,
      options?.assignment
    );
    const skipDuplicates = options?.skipDuplicates !== false;

    const shouldRunAsync = options?.async ?? rows.length > 50;
    if (shouldRunAsync) {
      const jobId = ulid();
      await enqueueLeadImport({
        jobId,
        tenantId,
        actorId,
        importType,
        assignment,
        skipDuplicates,
        rows: rows as Record<string, unknown>[],
      });
      return {
        async: true,
        jobId,
        importType,
        message: "Lead import queued in background worker",
        total: rows.length,
        imported: 0,
        skipped: 0,
      };
    }

    const currentLeads = await leadsRepository.countByTenant(tenantId);
    await entitlementsService.ensureCapacity(
      tenantId,
      LIMIT_CODES.LEADS,
      currentLeads,
      rows.length,
      "leads"
    );

    const existing = await leadsRepository.existingIdentifiers(tenantId);
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();

    const prepared = prepareBulkImportChunk({
      tenantId,
      importType,
      rows: rows as Record<string, unknown>[],
      startRowNumber: 1,
      existing,
      seenEmails,
      seenPhones,
      skipDuplicates,
      assignment,
      startAssignIndex: 0,
      csvImportTag: CSV_IMPORT_TAG,
    });

    const toInsert: BulkCreateLeadData[] = prepared.toInsert;
    const inserted = await leadsRepository.bulkCreate(toInsert);
    const preserveOwner = assignment.mode !== "default";

    void this.runImportAutomation(tenantId, actorId, inserted, preserveOwner);

    const ownerCounts = new Map<string, number>();
    for (const row of inserted) {
      if (row.owner_id) {
        ownerCounts.set(row.owner_id, (ownerCounts.get(row.owner_id) ?? 0) + 1);
      }
    }
    void notifyAssignedImportOwners(tenantId, actorId, importType, ownerCounts);

    engineService.audit(tenantId, actorId, "lead.bulk_import", "lead", undefined, {
      count: inserted.length,
      skipped: prepared.skipped,
      importType,
      assignmentMode: assignment.mode,
      ownerIds: assignment.ownerIds ?? [],
    });
    return {
      imported: inserted.length,
      skipped: prepared.skipped,
      skippedRows: prepared.skippedRows,
      importType,
    };
  }

  async getImportProgress(jobId: string) {
    return getLeadImportProgress(jobId);
  }

  private async runImportAutomation(
    tenantId: string,
    actorId: string,
    leads: LeadRow[],
    preserveOwner = false
  ): Promise<void> {
    try {
      const hasFlows = await this.hasLeadCreatedWorkflow(tenantId);
      const strategy = await this.defaultAssignmentStrategy(tenantId);
      if (!hasFlows && (preserveOwner || strategy === "MANUAL")) return;
      for (const lead of leads) {
        try {
          if (hasFlows) {
            await engineService.emit(tenantId, actorId, "lead.created", { lead, preserveOwner });
          }
          if (!preserveOwner && strategy !== "MANUAL") {
            const current = hasFlows
              ? (await leadsRepository.findById(lead.id, tenantId)) ?? lead
              : lead;
            await this.autoAssign(tenantId, actorId, current);
          }
        } catch (err) {
          logger.warn(`import automation failed for lead ${lead.id}: ${String(err)}`);
        }
      }
    } catch (err) {
      logger.warn(`import automation batch failed: ${String(err)}`);
    }
  }

  // Cheap existence check so import automation can skip the per-lead workflow
  // loop entirely when the tenant has no active lead.created automations.
  private async hasLeadCreatedWorkflow(tenantId: string): Promise<boolean> {
    const row = await db
      .selectFrom("workflows")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("trigger", "=", "lead.created")
      .where("active", "=", true)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  async update(
    tenantId: string,
    leadId: string,
    body: Partial<{
      name: string;
      email: string;
      phone: string;
      city: string;
      country: string;
      source: string;
      campaign: string;
      status: lead_status;
      tags: string[];
      socials: unknown;
      notes: string;
      budget: boolean;
      owner_id: string | null;
      import_type: string | null;
      extra_fields: unknown;
    }>
  ) {
    const existing = await leadsRepository.findById(leadId, tenantId);
    if (!existing) throw new NotFoundError("Lead not found");

    // Block editing a lead's email/phone into one that already belongs to a
    // different lead. Only checked when the identifier actually changes, so
    // saving unrelated fields never trips on a pre-existing duplicate.
    const nextEmail = body.email !== undefined ? body.email.trim() : undefined;
    const nextPhone =
      body.phone !== undefined
        ? (() => {
            const p = normalizePhoneForStore(body.phone);
            return typeof p === "string" ? p : "";
          })()
        : undefined;
    const emailChanged =
      nextEmail !== undefined && nextEmail.toLowerCase() !== (existing.email ?? "").toLowerCase();
    const phoneChanged = nextPhone !== undefined && nextPhone !== (existing.phone ?? "");
    if ((emailChanged && nextEmail) || (phoneChanged && nextPhone)) {
      const clash = await leadsRepository.findByEmailOrPhone(
        tenantId,
        emailChanged ? nextEmail || undefined : undefined,
        phoneChanged ? nextPhone || undefined : undefined
      );
      if (clash && clash.id !== leadId) {
        const emailClash =
          !!nextEmail && !!clash.email && clash.email.toLowerCase() === nextEmail.toLowerCase();
        throw new ConflictError(
          emailClash
            ? "Another lead with this email already exists."
            : "Another lead with this phone number already exists."
        );
      }
    }

    // Pull socials and extra_fields out of the spread so they are sanitized cleanly.
    const { socials, extra_fields, import_type, ...rest } = body;
    const effectiveType = import_type !== undefined ? import_type : existing.import_type;
    const nextStatus = existing.converted_contact_id
      ? "CONVERTED"
      : body.status !== undefined
        ? body.status
        : existing.status;
    const forceUnassign = nextStatus === "DISQUALIFIED";
    const updated = await leadsRepository.update(leadId, tenantId, {
      ...rest,
      status: nextStatus,
      ...(body.phone !== undefined ? { phone: normalizePhoneForStore(body.phone) } : {}),
      ...(socials !== undefined ? { socials: parseSocials(socials) ?? {} } : {}),
      ...(import_type !== undefined
        ? { import_type: isLeadImportType(import_type) ? import_type : null }
        : {}),
      ...(extra_fields !== undefined
        ? { extra_fields: normalizeExtraFieldsForType(effectiveType, extra_fields) }
        : {}),
      ...(forceUnassign ? { owner_id: null } : {}),
      last_activity_at: new Date(),
    });
    if (!updated) throw new NotFoundError("Lead not found");

    const score = await scoringService.recompute(tenantId, leadId);
    const fresh = await leadsRepository.findById(leadId, tenantId);
    return { ...withScore(fresh ?? updated), score: score ?? storedScore(updated) };
  }

  async assign(
    tenantId: string,
    actorId: string,
    actorRole: string,
    leadId: string,
    body: { strategy?: string; ownerId?: string }
  ) {
    const lead = await leadsRepository.findById(leadId, tenantId);
    if (!lead) throw new NotFoundError("Lead not found");
    // Disqualified leads are permanently unassigned, they cannot be assigned to
    // any agent (manually or otherwise).
    if (lead.status === "DISQUALIFIED") {
      throw new BadRequestError("A disqualified lead cannot be assigned.");
    }
    // Reassigning: you may hand off your own lead or claim an unassigned one;
    // only managers/admins can reassign a lead owned by someone else.
    assertCanReassign(actorId, actorRole, lead.owner_id, "lead");

    const strategy = body.strategy ?? "ROUND_ROBIN";
    if (!ASSIGNMENT_STRATEGIES.includes(strategy as (typeof ASSIGNMENT_STRATEGIES)[number])) {
      throw new BadRequestError(`strategy must be one of ${ASSIGNMENT_STRATEGIES.join(", ")}`);
    }

    const { owner, reason } = await this.resolveOwner(tenantId, lead, strategy, body.ownerId);
    if (!owner) throw new BadRequestError("No agent available");

    await leadsRepository.update(leadId, tenantId, { owner_id: owner.id });
    engineService.audit(tenantId, actorId, "lead.assigned", "lead", leadId, {
      strategy,
      to: owner.id,
      ...(reason ? { reason } : {}),
    });
    return {
      ok: true,
      owner: { id: owner.id, name: owner.name },
      strategy,
      ...(reason ? { reason } : {}),
    };
  }

  // Resolves the agent a lead should go to for a given strategy. Shared by the
  // manual `assign()` endpoint and by auto-assignment on lead creation. Every
  // fit-based strategy falls back to round-robin when nothing matches, so a lead
  // is never left unassigned just because no agent declared the right skill or
  // territory. Skill/territory matching is case-insensitive and trimmed.
  private async resolveOwner(
    tenantId: string,
    lead: LeadRow,
    strategy: string,
    explicitOwnerId?: string
  ): Promise<{ owner: { id: string; name: string } | null; reason?: string }> {
    if (strategy === "MANUAL") {
      if (!explicitOwnerId) return { owner: null };
      const manual = await db
        .selectFrom("users")
        .select(["id", "name"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", explicitOwnerId)
        .executeTakeFirst();
      return { owner: manual ?? null };
    }

    const agents = await db
      .selectFrom("users")
      .select(["id", "name", "territory", "skills"])
      .where("tenant_id", "=", tenantId)
      .where("role", "=", "SALES_AGENT")
      .where("status", "=", "ACTIVE")
      .execute();

    if (strategy === "TERRITORY_BASED") {
      const city = (lead.city ?? "").trim().toLowerCase();
      const match = city
        ? agents.find((a) =>
            parseStringArray(a.territory).some((t) => t.trim().toLowerCase() === city)
          )
        : undefined;
      return { owner: match ?? (await engineService.roundRobinAgent(tenantId, "SALES_AGENT")) };
    }

    if (strategy === "SKILL_BASED") {
      const source = (lead.source ?? "").trim().toLowerCase();
      const match = source
        ? agents.find((a) =>
            parseStringArray(a.skills).some((s) => s.trim().toLowerCase() === source)
          )
        : undefined;
      return { owner: match ?? (await engineService.roundRobinAgent(tenantId, "SALES_AGENT")) };
    }

    if (strategy === "AI") {
      // Score-based smart routing (not round-robin): see smartAssign below.
      const smart = await this.smartAssign(tenantId, lead, agents);
      return { owner: smart, reason: smart?.reason };
    }

    // ROUND_ROBIN: least-loaded agent.
    return { owner: await engineService.roundRobinAgent(tenantId, "SALES_AGENT") };
  }

  // The workspace-configured default assignment strategy (tenants.config
  // .leadAssignment.defaultStrategy). "MANUAL" (the default) means new leads are
  // left unassigned unless a workflow or explicit owner claims them.
  async defaultAssignmentStrategy(tenantId: string): Promise<string> {
    const row = await db
      .selectFrom("tenants")
      .select("config")
      .where("id", "=", tenantId)
      .executeTakeFirst();
    const cfg =
      row?.config && typeof row.config === "object"
        ? (row.config as Record<string, unknown>)
        : {};
    const la =
      cfg.leadAssignment && typeof cfg.leadAssignment === "object"
        ? (cfg.leadAssignment as Record<string, unknown>)
        : {};
    const strategy = typeof la.defaultStrategy === "string" ? la.defaultStrategy : "MANUAL";
    return (ASSIGNMENT_STRATEGIES as readonly string[]).includes(strategy) ? strategy : "MANUAL";
  }

  // Auto-assigns a freshly created lead using the workspace default strategy.
  // No-op (returns null) when the default is MANUAL/unset or the lead already has
  // an owner (explicit owner_id, or a workflow assigned it during lead.created).
  async autoAssign(
    tenantId: string,
    actorId: string,
    lead: LeadRow
  ): Promise<LeadRow | null> {
    if (lead.owner_id) return null;
    if (lead.status === "DISQUALIFIED") return null;
    const strategy = await this.defaultAssignmentStrategy(tenantId);
    if (strategy === "MANUAL") return null;
    const { owner, reason } = await this.resolveOwner(tenantId, lead, strategy);
    if (!owner) return null;
    const updated = await leadsRepository.update(lead.id, tenantId, { owner_id: owner.id });
    engineService.audit(tenantId, actorId, "lead.assigned", "lead", lead.id, {
      strategy,
      to: owner.id,
      auto: true,
      ...(reason ? { reason } : {}),
    });
    return updated ?? null;
  }

  // "AI" assignment: a transparent, score-based router (NOT round-robin). Ranks
  // active sales agents for this lead using real CRM signals, closed-won
  // performance, skill match (lead source), territory match (lead city), and
  // current open-lead load. Hot leads weight performance + fit; cooler leads
  // weight even distribution so nobody is overloaded. Returns the chosen agent
  // plus a short, human-readable reason (surfaced in the audit log + response).
  private async smartAssign(
    tenantId: string,
    lead: LeadRow,
    agents: Array<{ id: string; name: string; territory: unknown; skills: unknown }>
  ): Promise<{ id: string; name: string; reason: string } | null> {
    if (agents.length === 0) {
      const fallback = await engineService.roundRobinAgent(tenantId, "SALES_AGENT");
      return fallback ? { ...fallback, reason: "balanced load" } : null;
    }
    const agentIds = agents.map((a) => a.id);

    const [wonRows, loadRows] = await Promise.all([
      db
        .selectFrom("deals")
        .select(["owner_id", db.fn.count<number>("id").as("n")])
        .where("tenant_id", "=", tenantId)
        .where("owner_id", "in", agentIds)
        .where("status", "=", "WON")
        .groupBy("owner_id")
        .execute(),
      db
        .selectFrom("leads")
        .select(["owner_id", db.fn.count<number>("id").as("n")])
        .where("tenant_id", "=", tenantId)
        .where("owner_id", "in", agentIds)
        .where("status", "in", ["NEW", "QUALIFIED"])
        .groupBy("owner_id")
        .execute(),
    ]);

    const wonBy = new Map(wonRows.map((r) => [r.owner_id, Number(r.n)]));
    const loadBy = new Map(loadRows.map((r) => [r.owner_id, Number(r.n)]));
    const maxWon = Math.max(1, ...agents.map((a) => wonBy.get(a.id) ?? 0));
    const maxLoad = Math.max(1, ...agents.map((a) => loadBy.get(a.id) ?? 0));

    const hot = lead.score_grade === "HOT" || Number(lead.score_total ?? 0) >= 75;
    const city = (lead.city ?? "").toLowerCase();
    const source = (lead.source ?? "").toLowerCase();

    const ranked = agents.map((a) => {
      const skills = parseStringArray(a.skills).map((s) => s.toLowerCase());
      const territory = parseStringArray(a.territory).map((t) => t.toLowerCase());
      const skillMatch = source && skills.includes(source) ? 1 : 0;
      const territoryMatch = city && territory.includes(city) ? 1 : 0;
      const perf = (wonBy.get(a.id) ?? 0) / maxWon;
      const loadNorm = (loadBy.get(a.id) ?? 0) / maxLoad;
      const score = hot
        ? 3 * perf + 2 * skillMatch + 2 * territoryMatch - 1 * loadNorm
        : 1 * perf + 1.5 * skillMatch + 1.5 * territoryMatch - 3 * loadNorm;
      return { agent: a, score, load: loadBy.get(a.id) ?? 0, skillMatch, territoryMatch, perf };
    });
    // Highest score wins; ties broken by lighter load for fair distribution.
    ranked.sort((x, y) => y.score - x.score || x.load - y.load);
    const best = ranked[0];

    const bits: string[] = [];
    if (best.territoryMatch && lead.city) bits.push(`${lead.city} territory`);
    if (best.skillMatch && lead.source) bits.push(`${lead.source} specialist`);
    if (hot && best.perf > 0) bits.push("top performer");
    bits.push("lightest load");
    const reason = `${hot ? "hot lead -> " : ""}${bits.join(", ")}`;

    return { id: best.agent.id, name: best.agent.name, reason };
  }

  async bulkAction(
    tenantId: string,
    actorId: string,
    actorRole: string,
    body: { ids?: unknown; action?: string; value?: string; ownerId?: string }
  ) {
    // Mass edits/deletes/reassignments across the workspace are manager-only.
    assertCanBulk(actorRole, "run bulk lead actions");
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((i): i is string => typeof i === "string")
      : [];
    if (!ids.length) throw new BadRequestError("ids[] required");
    const action = body.action;
    if (!action || !["assign", "tag", "delete"].includes(action)) {
      throw new BadRequestError("action must be assign, tag or delete");
    }

    const rows = await leadsRepository.findByIds(ids, tenantId);
    let affected = 0;

    for (const lead of rows) {
      if (action === "delete") {
        await leadsRepository.delete(lead.id, tenantId);
        affected++;
      } else if (action === "tag") {
        const tags = Array.from(new Set([...parseStringArray(lead.tags), body.value || "tagged"]));
        await leadsRepository.update(lead.id, tenantId, { tags });
        affected++;
      } else {
        // Never assign a disqualified lead, skip it (not counted as affected).
        if (lead.status === "DISQUALIFIED") continue;
        const owner = body.ownerId
          ? await db
              .selectFrom("users")
              .select(["id", "name"])
              .where("tenant_id", "=", tenantId)
              .where("id", "=", body.ownerId)
              .executeTakeFirst()
          : await engineService.roundRobinAgent(tenantId, "SALES_AGENT");
        if (owner) {
          await leadsRepository.update(lead.id, tenantId, { owner_id: owner.id });
          affected++;
        }
      }
    }

    engineService.audit(tenantId, actorId, "lead.bulk_action", "lead", undefined, {
      action,
      affected,
    });
    return { affected, action };
  }

  async exportCsv(tenantId: string, idsCsv?: string): Promise<string> {
    let rows: LeadRow[];
    if (idsCsv) {
      rows = await leadsRepository.findByIds(idsCsv.split(",").filter(Boolean), tenantId);
    } else {
      rows = (await leadsRepository.list(tenantId, { limit: 500 })).leads;
    }
    const clean = (s: unknown) => String(s ?? "").replace(/[",\n]/g, " ");
    const lines = [["name", "email", "phone", "city", "source", "status", "score"].join(",")];
    for (const l of rows) {
      lines.push(
        [
          clean(l.name),
          clean(l.email),
          clean(l.phone),
          clean(l.city),
          clean(l.source),
          l.status,
          l.score_total,
        ].join(",")
      );
    }
    return lines.join("\n");
  }

  async documents(tenantId: string, leadId: string) {
    const lead = await leadsRepository.findById(leadId, tenantId);
    if (!lead) throw new NotFoundError("Lead not found");
    const docs = await leadsRepository.documents(tenantId, leadId);
    return Promise.all(
      docs.map(async (d) => ({
        ...d,
        url: d.file_key ? await storageService.getDownloadUrl(d.file_key) : d.url,
      }))
    );
  }

  async addDocument(
    tenantId: string,
    actorId: string,
    leadId: string,
    body: { name?: string; doc_type?: string; url?: string },
    file?: { originalname: string; buffer: Buffer; mimetype: string }
  ) {
    const lead = await leadsRepository.findById(leadId, tenantId);
    if (!lead) throw new NotFoundError("Lead not found");

    let fileKey: string | null = null;
    let name = body.name;
    if (file) {
      const ext = (file.originalname.split(".").pop() || "bin")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 12);
      fileKey = `tenants/${tenantId}/leads/${leadId}/${ulid()}.${ext}`;
      await storageService.upload({ key: fileKey, body: file.buffer, contentType: file.mimetype });
      name = name || file.originalname;
    }
    if (!name) throw new BadRequestError("name required");

    const doc = await leadsRepository.addDocument({
      tenant_id: tenantId,
      lead_id: leadId,
      name,
      doc_type: body.doc_type ?? "file",
      file_key: fileKey,
      url: body.url ?? null,
      uploaded_by: actorId,
    });
    engineService.audit(tenantId, actorId, "lead.document_added", "lead", leadId, { name });
    return {
      ...doc,
      url: fileKey ? await storageService.getDownloadUrl(fileKey) : doc.url,
    };
  }

  async score(tenantId: string, leadId: string): Promise<LeadScore> {
    const score = await scoringService.recompute(tenantId, leadId);
    if (!score) throw new NotFoundError("Lead not found");
    return score;
  }

  // Real LLM assessment of a single lead: reads its recent messages/activities
  // and explains the score with a concrete next action. The heuristic score
  // breakdown grounds the model and is the fallback when no key / on error.
  async insight(tenantId: string, leadId: string) {
    const lead = await leadsRepository.findById(leadId, tenantId);
    if (!lead) throw new NotFoundError("Lead not found");

    const [activities, messages] = await Promise.all([
      db
        .selectFrom("activities")
        .select(["type", "lead_id", "created_at"])
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .orderBy("created_at", "desc")
        .limit(20)
        .execute(),
      db
        .selectFrom("messages")
        .select(["body", "lead_id", "created_at"])
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", leadId)
        .orderBy("created_at", "desc")
        .limit(12)
        .execute(),
    ]);

    const score = scoreLead(lead, activities, messages);
    const lastActivityAt = activities[0]
      ? new Date(activities[0].created_at).getTime()
      : lead.last_activity_at
        ? new Date(lead.last_activity_at).getTime()
        : null;

    const assessInput = {
      name: lead.name,
      score,
      source: lead.source,
      city: lead.city,
      tags: parseStringArray(lead.tags),
      notes: lead.notes,
      recentMessages: messages.map((m) => m.body ?? "").filter(Boolean),
      recentActivities: activities
        .slice(0, 12)
        .map((a) => ({ type: a.type, when: new Date(a.created_at).toISOString().slice(0, 10) })),
      daysSinceActivity: lastActivityAt ? (Date.now() - lastActivityAt) / 86_400_000 : null,
    };

    const insight = await rememberInsight(
      "lead-insight",
      tenantId,
      assessInput,
      () => aiProvider.assessLead(assessInput),
      isModelGenerated
    );

    return { leadId: lead.id, score, insight };
  }

  async convert(
    tenantId: string,
    actorId: string,
    leadId: string,
    body: {
      createDeal?: boolean;
      value?: number;
      dealTitle?: string;
      accountId?: string;
      accountName?: string;
      contactName?: string;
      email?: string;
      phone?: string;
      city?: string;
    }
  ) {
    const lead = await leadsRepository.findById(leadId, tenantId);
    if (!lead) throw new NotFoundError("Lead not found");

    const result = await db.transaction().execute(async (trx) => {
      const now = new Date();

      // Resolve or create account if accountId or accountName (or imported Company/Business name) is available
      let accountId = body.accountId;
      const targetAccountName = body.accountName?.trim() || getLeadAccountCandidate(lead) || "";
      if (!accountId && targetAccountName) {
        const extra =
          lead.extra_fields && typeof lead.extra_fields === "object" && !Array.isArray(lead.extra_fields)
            ? (lead.extra_fields as Record<string, unknown>)
            : {};
        const existingAcc = await trx
          .selectFrom("accounts")
          .select("id")
          .where("tenant_id", "=", tenantId)
          .where((eb) => eb(eb.fn("lower", ["name"]), "=", targetAccountName.toLowerCase()))
          .executeTakeFirst();
        if (existingAcc) {
          accountId = existingAcc.id;
        } else {
          const newAcc = await trx
            .insertInto("accounts")
            .values({
              id: ulid(),
              tenant_id: tenantId,
              name: targetAccountName,
              city: body.city || lead.city || null,
              state: typeof extra.state === "string" && extra.state ? extra.state : null,
              address: typeof extra.address === "string" && extra.address ? extra.address : null,
              created_at: now,
              updated_at: now,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          accountId = newAcc.id;
        }
      }

      const contactName = body.contactName?.trim() || lead.name;
      const contactEmail = body.email !== undefined ? body.email : lead.email;
      const contactPhone = body.phone !== undefined ? body.phone : lead.phone;
      const contactCity = body.city !== undefined ? body.city : lead.city;

      // Deduplication: Check if already linked, or matching contact with this email or phone
      let contact: any = null;
      if (lead.converted_contact_id) {
        contact = await trx
          .selectFrom("contacts")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("id", "=", lead.converted_contact_id)
          .executeTakeFirst();
      }

      if (!contact && contactEmail) {
        contact = await trx
          .selectFrom("contacts")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where((eb) => eb(eb.fn("lower", ["email"]), "=", contactEmail.toLowerCase()))
          .executeTakeFirst();
      }

      if (!contact && contactPhone) {
        const normPhone = normalizePhoneForStore(contactPhone);
        if (normPhone) {
          contact = await trx
            .selectFrom("contacts")
            .selectAll()
            .where("tenant_id", "=", tenantId)
            .where("phone", "=", normPhone)
            .executeTakeFirst();
        }
      }

      if (contact) {
        // Reuse and update contact details with supplied parameters
        const patch: Record<string, unknown> = {
          updated_at: now,
          lifecycle: contact.lifecycle === "LEAD" ? "PROSPECT" : contact.lifecycle,
          converted_from_lead_id: contact.converted_from_lead_id || lead.id,
        };
        if (contactName && contact.name !== contactName) patch.name = contactName;
        if (contactEmail && contact.email !== contactEmail) patch.email = contactEmail;
        if (contactPhone && contact.phone !== contactPhone) {
          patch.phone = normalizePhoneForStore(contactPhone);
        }
        if (contactCity && contact.city !== contactCity) patch.city = contactCity;
        if (accountId && contact.account_id !== accountId) patch.account_id = accountId;

        contact = await trx
          .updateTable("contacts")
          .set(patch)
          .where("id", "=", contact.id)
          .where("tenant_id", "=", tenantId)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        contact = await trx
          .insertInto("contacts")
          .values({
            id: ulid(),
            tenant_id: tenantId,
            account_id: accountId || null,
            name: contactName,
            email: contactEmail,
            phone: contactPhone ? normalizePhoneForStore(contactPhone) : null,
            city: contactCity,
            owner_id: lead.owner_id,
            tags: JSON.stringify(parseStringArray(lead.tags)),
            socials: JSON.stringify(parseSocials(lead.socials) ?? {}),
            lifecycle: "PROSPECT",
            converted_from_lead_id: lead.id,
            last_activity_at: now,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      if (!accountId && contact?.account_id) {
        accountId = contact.account_id;
      }

      let deal: any = null;
      if (body.createDeal) {
        // Check if an existing deal already exists for this lead
        let existingDeal: any = null;
        if (lead.converted_deal_id) {
          existingDeal = await trx
            .selectFrom("deals")
            .selectAll()
            .where("tenant_id", "=", tenantId)
            .where("id", "=", lead.converted_deal_id)
            .executeTakeFirst();
        }
        if (!existingDeal) {
          existingDeal = await trx
            .selectFrom("deals")
            .selectAll()
            .where("tenant_id", "=", tenantId)
            .where("lead_id", "=", lead.id)
            .executeTakeFirst();
        }

        if (existingDeal) {
          const dealPatch: Record<string, unknown> = { updated_at: now };
          if (body.dealTitle && body.dealTitle.trim()) dealPatch.title = body.dealTitle.trim();
          if (body.value !== undefined && Number(body.value) > 0) dealPatch.value = Number(body.value);
          if (accountId && existingDeal.account_id !== accountId) dealPatch.account_id = accountId;
          if (contact.id && existingDeal.contact_id !== contact.id) dealPatch.contact_id = contact.id;

          deal = await trx
            .updateTable("deals")
            .set(dealPatch)
            .where("id", "=", existingDeal.id)
            .where("tenant_id", "=", tenantId)
            .returningAll()
            .executeTakeFirstOrThrow();
        } else {
          const pipeline = await trx
            .selectFrom("pipelines")
            .selectAll()
            .where("tenant_id", "=", tenantId)
            .where("is_default", "=", true)
            .executeTakeFirst();
          if (!pipeline) throw new BadRequestError("No default pipeline configured");
          const stages = await trx
            .selectFrom("stages")
            .selectAll()
            .where("tenant_id", "=", tenantId)
            .where("pipeline_id", "=", pipeline.id)
            .orderBy("sort_order", "asc")
            .execute();
          const stage = stages[0];
          if (!stage) throw new BadRequestError("Default pipeline has no stages");

          const dealId = ulid();
          const value = body.value || 50000;
          const health = dealHealth(
            {
              id: dealId,
              stage_id: stage.id,
              value,
              status: "OPEN",
              created_at: now,
            },
            stages,
            []
          );

          deal = await trx
            .insertInto("deals")
            .values({
              id: dealId,
              tenant_id: tenantId,
              pipeline_id: pipeline.id,
              stage_id: stage.id,
              title: body.dealTitle?.trim() || `${contactName.split(" ")[0]} - Deal`,
              value,
              currency: "INR",
              owner_id: lead.owner_id,
              lead_id: lead.id,
              account_id: accountId || null,
              contact_id: contact.id,
              status: "OPEN",
              win_probability: health.winProbability,
              health_score: health.score,
              health_label: health.label,
              created_at: now,
              updated_at: now,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        }
      }

      await trx
        .updateTable("leads")
        .set({
          status: "CONVERTED",
          converted_contact_id: contact.id,
          converted_deal_id: deal?.id ?? lead.converted_deal_id ?? null,
          updated_at: now,
        })
        .where("id", "=", lead.id)
        .where("tenant_id", "=", tenantId)
        .execute();

      return { contact, deal };
    });

    // Product history follows the PERSON, not the record. Without this, a lead
    // that converts loses every event, identity and engagement profile it had
    // built up, which is exactly when an agent needs that context most.
    // Deliberately after the transaction and never awaited into it: the
    // conversion must succeed even if the carry-over does not, and the events
    // stay reachable through the lead id either way.
    void engagementService.carryToContact(tenantId, lead.id, result.contact.id);
    void identitiesRepository
      .movePerson(tenantId, { leadId: lead.id }, { contactId: result.contact.id })
      .catch(() => undefined);

    await engineService.emit(tenantId, actorId, "lead.converted", {
      lead: { id: lead.id, name: lead.name, owner_id: lead.owner_id, tags: lead.tags },
      contact: result.contact,
    });
    engineService.audit(tenantId, actorId, "lead.converted", "lead", lead.id, {
      contactId: result.contact.id,
    });
    return result;
  }

  async remove(tenantId: string, actorId: string, actorRole: string, leadId: string) {
    const lead = await leadsRepository.findById(leadId, tenantId);
    if (!lead) throw new NotFoundError("Lead not found");
    assertCanManageRecord(actorId, actorRole, lead.owner_id, "delete", "lead");

    // Clear the product-integration rows BEFORE the lead itself, and await them.
    // These tables carry no FK to `leads`, so without this an identity keeps
    // pointing at a deleted lead: every later event for that person resolves to
    // a record that no longer exists, the API keeps returning 201, and nothing
    // ever appears in the CRM again. Doing it first means a failure here leaves
    // the lead intact and retryable rather than stranding its data.
    await engagementService.purgePerson(tenantId, { leadId });

    await leadsRepository.delete(leadId, tenantId, actorId);
    engineService.audit(tenantId, actorId, "lead.deleted", "lead", leadId);
    return { ok: true };
  }
}

export default new LeadsService();
