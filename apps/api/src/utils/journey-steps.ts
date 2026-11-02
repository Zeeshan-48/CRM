// Helpers for journey step definitions. Steps live as a JSON array on
// journeys.steps; each is `{ type, label?, delayDays?, ... }`. delayDays is the
// wait BEFORE that step runs.

export interface JourneyStep {
  type: string;
  label?: string;
  delayDays?: number;
  templateName?: string;
  [key: string]: unknown;
}

// Parse the steps column (which may come back as a JSON string or an already
// parsed array, depending on the driver) into a typed array. Never throws.
export const parseSteps = (raw: unknown): JourneyStep[] => {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as JourneyStep[]) : [];
};

// A non-negative delay in days for a step (defaults to 0 = run immediately).
export const stepDelayDays = (step: JourneyStep | undefined): number => {
  const d = Number(step?.delayDays);
  return Number.isFinite(d) && d > 0 ? d : 0;
};

// When a step becomes due, given the moment its wait starts.
export const stepDueAt = (from: Date, step: JourneyStep | undefined): Date =>
  new Date(from.getTime() + stepDelayDays(step) * 86_400_000);
