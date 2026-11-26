import { ulid } from "ulid";
import {
  extractAllowedImportTypes,
  isLeadImportType,
  LEAD_IMPORT_TYPE_LABELS,
  LEAD_IMPORT_TYPE_TAGS,
  resolveImportedLeadRow,
  type LeadImportAssignmentSpec,
  type LeadImportType,
} from "../constants/lead-import.const";
import { db } from "../db/connection";
import { BadRequestError, ForbiddenError } from "../errors";
import type { SkippedImportRow } from "../queue/lead-import.queue";
import type { BulkCreateLeadData } from "../repositories/leads.repository";
import tenantsRepository from "../repositories/tenants.repository";
import logger from "../utils/logger";
import { scoreLead } from "./ai/heuristics";

const MAX_SKIPPED_REPORT_ROWS = 200;

export const validateImportAccess = async (
  tenantId: string,
  requestedType?: string
): Promise<{ importType: LeadImportType; allowedTypes: LeadImportType[] }> => {
  const tenant = await tenantsRepository.findById(tenantId);
  const allowedTypes = extractAllowedImportTypes(tenant?.config);
  if (allowedTypes.length === 0) {
    throw new ForbiddenError(
      "Spreadsheet import is disabled for this workspace until Super Admin enables at least one data format."
    );
  }
  if (requestedType !== undefined) {
    if (!isLeadImportType(requestedType) || !allowedTypes.includes(requestedType)) {
      throw new ForbiddenError(
        `The "${requestedType}" import format is not enabled for this workspace.`
      );
    }
    return { importType: requestedType, allowedTypes };
  }
  return { importType: allowedTypes[0], allowedTypes };
};

export const validateImportAssignment = async (
  tenantId: string,
  actorId: string,
  actorRole: string,
  rawAssignment?: Partial<LeadImportAssignmentSpec>
): Promise<LeadImportAssignmentSpec> => {
  const mode = rawAssignment?.mode ?? "default";
  const ownerIds = Array.from(
    new Set((rawAssignment?.ownerIds ?? []).map((id) => String(id).trim()).filter(Boolean))
  );

  if (mode === "default" || mode === "unassigned") {
    return { mode, ownerIds: [] };
  }

  if (ownerIds.length === 0) {
    throw new BadRequestError("Select at least one active team member to assign imported leads.");
  }
  if (mode === "single" && ownerIds.length > 1) {
    throw new BadRequestError("Single owner mode expects one user.");
  }

  const isElevated = actorRole === "ADMIN" || actorRole === "MANAGER";
  if (!isElevated && ownerIds.some((id) => id !== actorId)) {
    throw new ForbiddenError("Only admins and managers can assign imported leads to other team members.");
  }

  const members = await db
    .selectFrom("users")
    .select(["id", "status"])
    .where("tenant_id", "=", tenantId)
    .where("id", "in", ownerIds)
    .execute();

  const activeIds = new Set(members.filter((m) => m.status === "ACTIVE").map((m) => m.id));
  for (const id of ownerIds) {
    if (!activeIds.has(id)) {
      throw new BadRequestError("Every selected assignee must be an active member of this workspace.");
    }
  }

  return { mode, ownerIds };
};

export interface PrepareChunkInput {
  tenantId: string;
  importType: LeadImportType;
  rows: Record<string, unknown>[];
  startRowNumber: number;
  existing: { emails: Set<string>; phones: Set<string> };
  seenEmails: Set<string>;
  seenPhones: Set<string>;
  skipDuplicates: boolean;
  assignment: LeadImportAssignmentSpec;
  startAssignIndex: number;
  csvImportTag: string;
}

export interface PrepareChunkResult {
  toInsert: BulkCreateLeadData[];
  skipped: number;
  skippedRows: SkippedImportRow[];
  nextAssignIndex: number;
}

export const prepareBulkImportChunk = (input: PrepareChunkInput): PrepareChunkResult => {
  const now = new Date();
  const toInsert: BulkCreateLeadData[] = [];
  const skippedRows: SkippedImportRow[] = [];
  let skipped = 0;
  let assignIdx = input.startAssignIndex;
  const typeTag = LEAD_IMPORT_TYPE_TAGS[input.importType];

  input.rows.forEach((raw, idx) => {
    const resolved = resolveImportedLeadRow(input.importType, (raw ?? {}) as Record<string, unknown>);
    const rowNumber = input.startRowNumber + idx;

    if (!resolved.hasIdentifier) {
      skipped++;
      if (skippedRows.length < MAX_SKIPPED_REPORT_ROWS) {
        skippedRows.push({
          rowNumber,
          name: resolved.name === "Unknown" ? "" : resolved.name,
          email: resolved.email,
          phone: resolved.phone,
          reason: "Missing name, mobile/phone, and email",
        });
      }
      return;
    }

    const emailKey = resolved.email.toLowerCase();
    const dupInFile =
      (!!emailKey && input.seenEmails.has(emailKey)) ||
      (!!resolved.phone && input.seenPhones.has(resolved.phone));
    const dupInDb =
      (!!emailKey && input.existing.emails.has(emailKey)) ||
      (!!resolved.phone && input.existing.phones.has(resolved.phone));

    if (input.skipDuplicates && (dupInFile || dupInDb)) {
      skipped++;
      if (skippedRows.length < MAX_SKIPPED_REPORT_ROWS) {
        skippedRows.push({
          rowNumber,
          name: resolved.name === "Unknown" ? "" : resolved.name,
          email: resolved.email,
          phone: resolved.phone,
          reason: dupInFile ? "Duplicate in file" : "Already exists in CRM",
        });
      }
      return;
    }

    if (emailKey) input.seenEmails.add(emailKey);
    if (resolved.phone) input.seenPhones.add(resolved.phone);

    const score = scoreLead(
      {
        id: "",
        source: resolved.source,
        tags: resolved.tags,
        notes: resolved.notes,
        budget: false,
        last_activity_at: now,
        created_at: now,
      },
      [],
      []
    );

    const tags = [...resolved.tags];
    for (const marker of [input.csvImportTag, typeTag]) {
      if (!tags.some((t) => t.toLowerCase() === marker.toLowerCase())) {
        tags.push(marker);
      }
    }

    let ownerId: string | null = null;
    if (input.assignment.mode === "single" && input.assignment.ownerIds?.[0]) {
      ownerId = input.assignment.ownerIds[0];
    } else if (
      input.assignment.mode === "round_robin" &&
      input.assignment.ownerIds &&
      input.assignment.ownerIds.length > 0
    ) {
      ownerId = input.assignment.ownerIds[assignIdx % input.assignment.ownerIds.length];
      assignIdx++;
    }

    toInsert.push({
      tenant_id: input.tenantId,
      name: resolved.name,
      email: resolved.email,
      phone: resolved.phone,
      city: resolved.city,
      country: resolved.country,
      source: resolved.source,
      owner_id: ownerId,
      tags,
      notes: resolved.notes,
      budget: false,
      import_type: input.importType,
      extra_fields: Object.keys(resolved.extraFields).length > 0 ? resolved.extraFields : null,
      score_total: score.total,
      score_grade: score.grade,
      score_breakdown: score,
    });
  });

  return { toInsert, skipped, skippedRows, nextAssignIndex: assignIdx };
};

export const notifyAssignedImportOwners = async (
  tenantId: string,
  actorId: string,
  importType: LeadImportType,
  countsByOwner: Map<string, number>
): Promise<void> => {
  const label = LEAD_IMPORT_TYPE_LABELS[importType];
  for (const [ownerId, count] of countsByOwner.entries()) {
    if (!ownerId || ownerId === actorId || count <= 0) continue;
    try {
      await db
        .insertInto("notifications")
        .values({
          id: ulid(),
          tenant_id: tenantId,
          user_id: ownerId,
          text: `${count} newly imported ${label} lead${count === 1 ? "" : "s"} assigned to you.`,
          link: "/leads",
          read: false,
          created_at: new Date(),
        })
        .execute();
    } catch (err) {
      logger.warn(`Failed to notify assigned owner ${ownerId}: ${String(err)}`);
    }
  }
};
