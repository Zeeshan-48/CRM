import type { CopilotAnswer } from "@/types";
import { apiGet, apiPost } from "./client";

// Built-in fallback so the "Try asking" prompts always render, even before the
// fetch resolves or if it fails. Kept in sync with the backend's list.
export const DEFAULT_COPILOT_SUGGESTIONS: string[] = [
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
];

export const getCopilotSuggestions = () =>
  apiGet<string[]>("/copilot/suggestions");

export interface CopilotTurn {
  question: string;
  answer: string;
}

// `history` gives the copilot conversational memory: the drawer replays the
// recent turns it already holds so follow-ups resolve against earlier answers.
export const askCopilot = (query: string, history: CopilotTurn[] = []) =>
  apiPost<CopilotAnswer>("/copilot/ask", { query, history });
