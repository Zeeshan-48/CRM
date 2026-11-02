import { Request, Response } from "express";
import type { lead_grade, lead_status } from "../db/enums";
import { ForbiddenError } from "../errors";
import activityEventsService from "../services/activity-events.service";
import engagementService from "../services/engagement.service";
import leadsService from "../services/leads.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, actorRole: user.role };
};

// Normalizes an incoming date query param to an ISO instant, dropping anything
// unparseable so a malformed value never reaches the SQL query.
const asIsoDate = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

export const listLeads = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const result = await leadsService.list(tenantId, {
    q: req.query.q as string | undefined,
    source: req.query.source as string | undefined,
    tag: req.query.tag as string | undefined,
    status: req.query.status as lead_status | undefined,
    owner: req.query.owner as string | undefined,
    grade: req.query.grade as lead_grade | undefined,
    createdFrom: asIsoDate(req.query.createdFrom),
    lastActivityFrom: asIsoDate(req.query.lastActivityFrom),
    lastActivityTo: asIsoDate(req.query.lastActivityTo),
    page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  });
  sendSuccessResponse({ res, data: result });
};

export const listSources = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await leadsService.sources(tenantId) });
};

// The lead's platform-activity stream (events synced from external platforms).
export const listPlatformEvents = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const events = await activityEventsService.listForLead(tenantId, String(req.params.id));
  sendSuccessResponse({ res, data: events });
};

// The lead's engagement across every connected product: lifecycle, plan, intent
// with its reasons, 30-day windows, abandoned cart and most-viewed items. This
// is the payload behind the Product panel on the lead record.
export const getLeadEngagement = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await engagementService.listForPerson(tenantId, {
      leadId: String(req.params.id),
      contactId: null,
    }),
  });
};

export const listTags = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await leadsService.tags(tenantId) });
};

export const listAssignmentStrategies = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: leadsService.assignmentStrategies() });
};

export const bulkAction = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await leadsService.bulkAction(tenantId, actorId, actorRole, req.body ?? {}),
  });
};

export const exportCsv = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const csv = await leadsService.exportCsv(tenantId, req.query.ids as string | undefined);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
  res.send(csv);
};

export const getLead = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await leadsService.detail(tenantId, String(req.params.id)) });
};

export const createLead = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const lead = await leadsService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: lead,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Lead captured",
  });
};

export const bulkImport = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await leadsService.bulkImport(tenantId, actorId, req.body?.rows);
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Leads imported",
  });
};

export const updateLead = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await leadsService.update(tenantId, String(req.params.id), req.body ?? {}),
    message: "Lead updated",
  });
};

export const assignLead = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await leadsService.assign(tenantId, actorId, actorRole, String(req.params.id), req.body ?? {}),
  });
};

export const listDocuments = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await leadsService.documents(tenantId, String(req.params.id)) });
};

export const addDocument = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const doc = await leadsService.addDocument(
    tenantId,
    actorId,
    String(req.params.id),
    req.body ?? {},
    req.file
  );
  sendSuccessResponse({
    res,
    data: doc,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Document added",
  });
};

export const getScore = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await leadsService.score(tenantId, String(req.params.id)) });
};

export const getInsight = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await leadsService.insight(tenantId, String(req.params.id)) });
};

export const convertLead = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await leadsService.convert(tenantId, actorId, String(req.params.id), req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Lead converted",
  });
};

export const deleteLead = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await leadsService.remove(tenantId, actorId, actorRole, String(req.params.id)),
    message: "Lead deleted",
  });
};
