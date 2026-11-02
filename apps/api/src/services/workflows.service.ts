import { BadRequestError, NotFoundError } from "../errors";
import workflowsRepository, {
  AutomationRunRow,
  WorkflowRow,
} from "../repositories/workflows.repository";
import engineService, { WORKFLOW_ACTIONS, WORKFLOW_TRIGGERS } from "./engine.service";

interface WorkflowActionInput {
  type: string;
  params?: Record<string, unknown>;
}

const parseActions = (value: unknown): WorkflowActionInput[] => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((a): a is WorkflowActionInput => !!a && typeof a === "object" && "type" in a)
    : [];
};

const parseLog = (value: unknown): string[] => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : [];
};

const withParsedActions = (workflow: WorkflowRow) => ({
  ...workflow,
  actions: parseActions(workflow.actions),
});

const withParsedLog = (run: AutomationRunRow) => ({ ...run, log: parseLog(run.log) });

class WorkflowsService {
  catalogue() {
    return { triggers: WORKFLOW_TRIGGERS, actions: WORKFLOW_ACTIONS };
  }

  async list(tenantId: string) {
    const rows = await workflowsRepository.list(tenantId);
    return rows.map(withParsedActions);
  }

  async runs(tenantId: string) {
    const rows = await workflowsRepository.listRuns(tenantId, 100);
    return rows.map(withParsedLog);
  }

  async create(
    tenantId: string,
    actorId: string,
    body: { name?: string; trigger?: string; actions?: unknown; active?: boolean }
  ) {
    if (!body.name || !body.trigger) throw new BadRequestError("name and trigger required");
    if (!(WORKFLOW_TRIGGERS as readonly string[]).includes(body.trigger)) {
      throw new BadRequestError("Unknown trigger");
    }

    const workflow = await workflowsRepository.create({
      tenant_id: tenantId,
      name: body.name,
      trigger: body.trigger,
      actions: Array.isArray(body.actions) ? body.actions : [],
      active: body.active !== false,
    });
    engineService.audit(tenantId, actorId, "workflow.created", "workflow", workflow.id, {});
    return withParsedActions(workflow);
  }

  async update(
    tenantId: string,
    workflowId: string,
    body: { name?: string; trigger?: string; actions?: unknown; active?: boolean }
  ) {
    const existing = await workflowsRepository.findById(workflowId, tenantId);
    if (!existing) throw new NotFoundError("Workflow not found");

    const updated = await workflowsRepository.update(workflowId, tenantId, {
      name: body.name,
      trigger: body.trigger,
      actions: body.actions !== undefined && Array.isArray(body.actions) ? body.actions : undefined,
      active: body.active,
    });
    if (!updated) throw new NotFoundError("Workflow not found");
    return withParsedActions(updated);
  }

  async remove(tenantId: string, actorId: string, workflowId: string) {
    const deleted = await workflowsRepository.delete(workflowId, tenantId);
    if (!deleted) throw new NotFoundError("Workflow not found");
    engineService.audit(tenantId, actorId, "workflow.deleted", "workflow", workflowId);
    return { ok: true };
  }

  // Test-fires the workflow by emitting its trigger against the tenant's most
  // recent lead. Sibling workflows on the same trigger also run by design:
  // a test fire behaves exactly like the real event.
  async testRun(tenantId: string, actorId: string, workflowId: string) {
    const workflow = await workflowsRepository.findById(workflowId, tenantId);
    if (!workflow) throw new NotFoundError("Workflow not found");

    const lead = await workflowsRepository.latestLead(tenantId);
    const runs = await engineService.emit(tenantId, actorId, workflow.trigger, {
      lead: lead ?? null,
    });
    return { fired: runs.length, runs };
  }
}

export default new WorkflowsService();
