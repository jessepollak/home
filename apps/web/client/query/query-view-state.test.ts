import { expect, test } from "bun:test";
import { queryViewState, type QueryViewState } from "./query-view-state";

test.each([
  ["pending", false, false, false, "loading"],
  ["pending", true, false, false, "loading"],
  ["success", false, false, false, "loading"],
  ["success", true, false, false, "ready"],
  ["success", true, true, false, "empty"],
  ["error", false, false, false, "failed"],
  ["error", true, true, false, "failed"],
  ["error", true, false, false, "failed-with-data"],
  ["success", true, true, true, "failed"],
  ["success", true, false, true, "failed-with-data"],
  ["success", false, false, true, "failed"],
  ["error", true, false, true, "failed-with-data"],
] as const)("maps %s with cached=%s empty=%s degraded=%s to %s", (status, hasCachedData, isEmpty, degraded, expected) => {
  const state: QueryViewState = queryViewState({ status }, { hasCachedData, isEmpty, degraded });
  expect(state).toBe(expected);
  if (status === "error" || degraded) expect(["empty", "ready"]).not.toContain(state);
});
