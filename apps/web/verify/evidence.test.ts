import { describe, expect, test } from "bun:test";
import { finalizeEvidence, summarizeEvidence } from "./evidence";

const baseline = {
  surfaceId: "send", baseUrl: "http://localhost:3200", capturedAt: "2026-09-23T00:00:00.000Z",
  steps: [{ step: "snapshot", status: "done" as const }],
  artifacts: { screenshot: "screenshot.png", snapshot: "snapshot.txt" },
  actionIds: ["prepared-id"], consoleErrors: [], pageErrors: [], unexpectedHosts: [],
};

describe("session evidence", () => {
  test("records confirmations and browser artifacts", () => {
    const result = finalizeEvidence(baseline);
    expect(result.passed).toBe(true);
    expect(summarizeEvidence(result, "live")).toContain("Confirmations: 1");
  });
  test("recoverable failed steps remain visible without failing a repaired run", () => {
    expect(finalizeEvidence({ ...baseline, steps: [...baseline.steps, { step: "click wrong", status: "failed" }] }).passed).toBe(true);
  });
  test("host or browser errors fail while allow-console waives only console noise", () => {
    expect(finalizeEvidence({ ...baseline, unexpectedHosts: ["unknown.test"] }).passed).toBe(false);
    expect(finalizeEvidence({ ...baseline, pageErrors: ["page failed"] }).passed).toBe(false);
    expect(finalizeEvidence({ ...baseline, consoleErrors: ["warning"] }).passed).toBe(false);
    expect(finalizeEvidence({ ...baseline, consoleErrors: ["warning"] }, true).passed).toBe(true);
  });
});
