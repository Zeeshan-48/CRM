import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import agentsService from "../services/agents.service";
import { sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

const parseLimit = (req: Request): number | undefined => {
  const raw = req.query.limit ?? (req.body ? req.body.limit : undefined);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? undefined : n;
};

export const listAgents = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await agentsService.list(tenantId) });
};

export const listRuns = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await agentsService.runs(tenantId) });
};

export const runAgent = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const body = (req.body ?? {}) as { audienceTag?: unknown; query?: unknown; q?: unknown };
  const result = await agentsService.run(tenantId, actorId, String(req.params.agent), {
    limit: parseLimit(req),
    audienceTag: typeof body.audienceTag === "string" ? body.audienceTag : undefined,
    query:
      typeof body.query === "string"
        ? body.query
        : typeof body.q === "string"
          ? body.q
          : undefined,
  });
  sendSuccessResponse({ res, data: result, message: "Agent run completed" });
};

// ---- Sales outreach approval queue (human-in-the-loop) ----

const parseEdits = (req: Request): { subject?: string; body?: string } => {
  const body = (req.body ?? {}) as { subject?: unknown; body?: unknown };
  const edits: { subject?: string; body?: string } = {};
  if (typeof body.subject === "string") edits.subject = body.subject;
  if (typeof body.body === "string") edits.body = body.body;
  return edits;
};

export const listOutreach = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  sendSuccessResponse({ res, data: await agentsService.listOutreach(tenantId, status) });
};

export const approveOutreach = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const edits = parseEdits(req);
  const result = await agentsService.approveOutreach(
    tenantId,
    actorId,
    String(req.params.id),
    edits.subject === undefined && edits.body === undefined ? undefined : edits
  );
  sendSuccessResponse({ res, data: result, message: "Outreach approved and sent" });
};

export const approveAllOutreach = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await agentsService.approveAllOutreach(tenantId, actorId);
  const msg =
    result.failed > 0
      ? `Sent ${result.sent} of ${result.total}, ${result.failed} could not be sent`
      : `Sent all ${result.sent} drafts`;
  sendSuccessResponse({ res, data: result, message: msg });
};

export const rejectOutreach = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const data = await agentsService.rejectOutreach(tenantId, actorId, String(req.params.id));
  sendSuccessResponse({ res, data, message: "Draft rejected" });
};

export const editOutreach = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const data = await agentsService.editOutreach(tenantId, String(req.params.id), parseEdits(req));
  sendSuccessResponse({ res, data, message: "Draft updated" });
};

// ---- Sales automation settings + enrollments (Phase 2) ----

export const getSalesSettings = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const [settings, stats] = await Promise.all([
    agentsService.getSalesSettings(tenantId),
    agentsService.salesEnrollmentStats(tenantId),
  ]);
  sendSuccessResponse({ res, data: { ...settings, activeEnrollments: stats.active } });
};

export const updateSalesSettings = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof agentsService.updateSalesSettings>[1] = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (typeof b.autoSend === "boolean") patch.autoSend = b.autoSend;
  if (typeof b.escalateToCall === "boolean") patch.escalateToCall = b.escalateToCall;
  if (typeof b.scoreThreshold === "number") patch.scoreThreshold = b.scoreThreshold;
  if (typeof b.dailyCap === "number") patch.dailyCap = b.dailyCap;
  if (typeof b.tone === "string" || b.tone === null) patch.tone = b.tone as string | null;
  if (Array.isArray(b.channels)) {
    patch.channels = b.channels.filter((c): c is string => typeof c === "string");
  }
  if (Array.isArray(b.cadence)) {
    patch.cadence = b.cadence
      .map((s) => {
        const step = s as { delayDays?: unknown; angle?: unknown };
        return {
          delayDays: Number(step.delayDays) || 0,
          angle: typeof step.angle === "string" ? step.angle : "follow-up",
        };
      })
      .filter((s) => Number.isFinite(s.delayDays));
  }
  const data = await agentsService.updateSalesSettings(tenantId, patch);
  sendSuccessResponse({ res, data, message: "Sales automation settings saved" });
};

export const getSalesMetrics = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const raw = parseInt(String(req.query.days ?? ""), 10);
  const days = Number.isNaN(raw) ? 30 : Math.min(365, Math.max(1, raw));
  sendSuccessResponse({ res, data: await agentsService.salesMetrics(tenantId, days) });
};
