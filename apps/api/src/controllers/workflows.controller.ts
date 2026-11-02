import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import workflowsService from "../services/workflows.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

export const getCatalogue = async (_req: Request, res: Response) => {
  sendSuccessResponse({ res, data: workflowsService.catalogue() });
};

export const listWorkflows = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await workflowsService.list(tenantId) });
};

export const listRuns = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await workflowsService.runs(tenantId) });
};

export const createWorkflow = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const workflow = await workflowsService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: workflow,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Workflow created",
  });
};

export const updateWorkflow = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await workflowsService.update(tenantId, String(req.params.id), req.body ?? {}),
    message: "Workflow updated",
  });
};

export const deleteWorkflow = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await workflowsService.remove(tenantId, actorId, String(req.params.id)),
    message: "Workflow deleted",
  });
};

export const testRunWorkflow = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await workflowsService.testRun(tenantId, actorId, String(req.params.id)),
    message: "Workflow test fired",
  });
};
