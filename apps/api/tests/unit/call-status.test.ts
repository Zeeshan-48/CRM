import { describe, expect, it } from "vitest";
import {
  IN_PROGRESS_STALE_MS,
  QUEUED_STALE_MS,
  normalizeProviderCallStatus,
} from "../../src/jobs/calls-poll.job";

describe("call status normalization & TTL constants", () => {
  it("normalizes provider statuses to CRM terminal vocabulary", () => {
    expect(normalizeProviderCallStatus("COMPLETED")).toBe("completed");
    expect(normalizeProviderCallStatus("cancel")).toBe("canceled");
    expect(normalizeProviderCallStatus("no_answer")).toBe("no-answer");
    expect(normalizeProviderCallStatus("  in-progress ")).toBe("in-progress");
    expect(normalizeProviderCallStatus(null)).toBe("");
  });

  it("enforces sane non-destructive TTL windows for queued and in-progress calls", () => {
    expect(QUEUED_STALE_MS).toBe(15 * 60 * 1000);
    expect(IN_PROGRESS_STALE_MS).toBe(4 * 60 * 60 * 1000);
  });
});
