import { waitFor } from "storybook/test";

// Shared hang budget for story play-function readiness: Testing Library's 1 s default flakes on a loaded runner.
// 10 s stays below the Vitest browser test timeout of 15 s.
export const STORY_READY_BUDGET_MS = 10_000;

export function waitForReady<T>(assertion: () => T | Promise<T>): Promise<T> {
  return waitFor(assertion, { timeout: STORY_READY_BUDGET_MS });
}
