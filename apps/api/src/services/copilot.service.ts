import { BadRequestError } from "../errors";
import copilotRepository from "../repositories/copilot.repository";
import logger from "../utils/logger";
import { aiProvider } from "./ai/provider";
import { executeToolPlan, TOOL_CATALOG } from "./ai/copilot-tools";
import type { CopilotResult, CopilotTurn } from "./ai/heuristics";
import engineService from "./engine.service";

// The client (the Copilot drawer) holds the thread and replays the recent turns
// with each ask, so memory stays stateless server-side. We defensively cap and
// truncate what we accept, untrusted input that only ever feeds the prompt.
const MAX_HISTORY_TURNS = 6;
export const sanitizeHistory = (raw: unknown): CopilotTurn[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is { question: unknown; answer: unknown } =>
        !!t && typeof t === "object"
    )
    .map((t) => ({
      question: typeof t.question === "string" ? t.question.slice(0, 600) : "",
      answer: typeof t.answer === "string" ? t.answer.slice(0, 1200) : "",
    }))
    .filter((t) => t.question && t.answer)
    .slice(-MAX_HISTORY_TURNS);
};

export const COPILOT_SUGGESTIONS = [
  "Which leads are hot right now?",
  "How many leads do we have by source?",
  "Show all hot leads from Bengaluru who attended a demo but haven't purchased.",
  "Which deals are likely to close and what's the forecast?",
  "Show open deals worth over ₹1 lakh.",
  "What's my total open pipeline?",
  "Break down deals by stage.",
  "Which agents are underperforming?",
  "How many new leads came in this month?",
  "Show inactive customers from the last 30 days.",
  "Which support tickets are overdue?",
  "How many open tickets by priority?",
] as const;

class CopilotService {
  suggestions(): readonly string[] {
    return COPILOT_SUGGESTIONS;
  }

  async ask(
    tenantId: string,
    actorId: string,
    body: { query?: unknown; q?: unknown; history?: unknown }
  ) {
    const query =
      typeof body.query === "string" && body.query
        ? body.query
        : typeof body.q === "string"
          ? body.q
          : "";
    if (!query) throw new BadRequestError("query required");

    const history = sanitizeHistory(body.history);

    let result: CopilotResult | null = null;
    let tools: string[] = [];

    // Agentic path (real LLM providers only): the model plans read-only,
    // tenant-scoped tool calls, we execute them, and it answers from live
    // results. Any failure, planning, execution, or answering, degrades to
    // the snapshot path below, which itself falls back to the heuristic.
    if (aiProvider.supportsAgentic && aiProvider.planCopilotTools && aiProvider.answerFromTools) {
      try {
        const plan = await aiProvider.planCopilotTools(query, history, TOOL_CATALOG);
        if (plan.length) {
          tools = plan.map((p) => p.name);
          const toolResults = await executeToolPlan(tenantId, plan);
          result = await aiProvider.answerFromTools(query, history, toolResults);
        }
      } catch (err) {
        logger.warn(`copilot agentic path failed, snapshot fallback: ${String(err)}`);
        result = null;
      }
    }

    if (!result) {
      const data = await copilotRepository.snapshot(tenantId);
      result = await aiProvider.copilot(data, query, history);
    }

    engineService.audit(tenantId, actorId, "copilot.ask", "copilot", undefined, {
      q: query,
      intent: result.intent,
      turns: history.length,
      tools,
    });
    return { question: query, ...result };
  }
}

export default new CopilotService();
