export type MarkResult = {
  name: string;
  startTime: number | null;
  budgetMs: number | null;
  passed: boolean | null;
};

export type VerifyEvidence = {
  surfaceId: string;
  baseUrl: string;
  capturedAt: string;
  viewport: { width: number; height: number };
  steps: string[];
  artifacts: { screenshot: string; dom: string };
  consoleErrors: string[];
  failedRequests: string[];
  pageErrors: string[];
  marks: MarkResult[];
  longTaskCount: number;
  passed: boolean;
};

export function finalizeEvidence(
  input: Omit<VerifyEvidence, "passed">,
  allowConsole = false,
): VerifyEvidence {
  const budgetsPass = input.marks.every((mark) => mark.passed !== false);
  const browserHealthPass = allowConsole || (
    input.consoleErrors.length === 0 && input.failedRequests.length === 0 && input.pageErrors.length === 0
  );
  return { ...input, passed: budgetsPass && browserHealthPass };
}

export function summarizeEvidence(evidence: VerifyEvidence, mode: "fixture" | "live" = "fixture"): string {
  const status = evidence.passed ? "pass" : "fail";
  const marks = evidence.marks.length === 0
    ? "None listed for this surface."
    : evidence.marks.map((mark) => {
      const value = mark.startTime === null ? "not observed" : `${Math.round(mark.startTime)} ms`;
      const budget = mark.budgetMs === null ? "evidence only" : `budget ${mark.budgetMs} ms`;
      const result = mark.passed === null ? "recorded" : mark.passed ? "pass" : "fail";
      return `- \`${mark.name}\`: ${value} (${budget}; ${result})`;
    }).join("\n");
  const summary = `### Verify: \`${evidence.surfaceId}\` — ${status}\n\n- Origin: ${evidence.baseUrl}\n- Viewport: ${evidence.viewport.width}×${evidence.viewport.height} CSS px\n- Screenshot: \`${evidence.artifacts.screenshot}\`\n- DOM text: \`${evidence.artifacts.dom}\`\n- Console errors: ${evidence.consoleErrors.length}\n- Page errors: ${evidence.pageErrors.length}\n- Failed requests: ${evidence.failedRequests.length}\n- Long tasks: ${evidence.longTaskCount}\n\n#### Performance marks\n${marks}\n`;
  return mode === "live"
    ? summary.split("\n").map((line) => line ? `[live] ${line}` : line).join("\n")
    : summary;
}
