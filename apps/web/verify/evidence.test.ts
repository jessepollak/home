import { describe, expect, test } from "bun:test";
import { finalizeEvidence, summarizeEvidence } from "./evidence";

const base = {
  surfaceId: "landing",
  baseUrl: "http://127.0.0.1:3200",
  capturedAt: "2026-09-21T00:00:00.000Z",
  viewport: { width: 390, height: 844 },
  steps: ["goto /", "expect One home for your money."],
  artifacts: { screenshot: "screenshot.png", dom: "dom.txt" },
  consoleErrors: [] as string[],
  failedRequests: [] as string[],
  pageErrors: [] as string[],
  marks: [{ name: "shell:paint", startTime: 300, budgetMs: 1500, passed: true }],
  longTaskCount: 0,
};

describe("evidence summary", () => {
  test("passes clean browser health and budgets", () => {
    const evidence = finalizeEvidence(base);
    expect(evidence.passed).toBe(true);
    expect(summarizeEvidence(evidence)).toContain("### Verify: `landing` — pass");
    expect(summarizeEvidence(evidence)).toContain("`shell:paint`: 300 ms");
  });

  test("fails browser noise unless it is explicitly allowed", () => {
    const noisy = { ...base, failedRequests: ["GET /missing (404)"] };
    expect(finalizeEvidence(noisy).passed).toBe(false);
    expect(finalizeEvidence(noisy, true).passed).toBe(true);
  });

  test("fails and reports a required mark that was not observed", () => {
    const missing = { ...base, marks: [{ name: "shell:paint", startTime: null, budgetMs: 1500, passed: false }] };
    expect(finalizeEvidence(missing).passed).toBe(false);
    expect(summarizeEvidence(finalizeEvidence(missing))).toContain("not observed (budget 1500 ms; fail)");
  });
});
