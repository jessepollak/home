export type VerifyEvidence = {
  surfaceId: string;
  baseUrl: string;
  capturedAt: string;
  steps: Array<{ step: string; status: "done" | "failed" }>;
  artifacts: { screenshot: string; snapshot: string };
  actionIds: string[];
  consoleErrors: string[];
  pageErrors: string[];
  unexpectedHosts: string[];
  passed: boolean;
};

export function finalizeEvidence(input: Omit<VerifyEvidence, "passed">, allowConsole = false): VerifyEvidence {
  return {
    ...input,
    passed: input.unexpectedHosts.length === 0 && input.pageErrors.length === 0 &&
      (allowConsole || input.consoleErrors.length === 0),
  };
}

export function summarizeEvidence(evidence: VerifyEvidence, mode: "fixture" | "live"): string {
  const text = `### Verify: \`${evidence.surfaceId}\` — ${evidence.passed ? "pass" : "fail"}\n\n- Origin: ${evidence.baseUrl}\n- Screenshot: \`${evidence.artifacts.screenshot}\`\n- Snapshot: \`${evidence.artifacts.snapshot}\`\n- Steps: ${evidence.steps.length}\n- Confirmations: ${evidence.actionIds.length}\n- Console errors: ${evidence.consoleErrors.length}\n- Page errors: ${evidence.pageErrors.length}\n- Unexpected hosts: ${evidence.unexpectedHosts.length}\n`;
  return mode === "live" ? text.split("\n").map((line) => line ? `[live] ${line}` : line).join("\n") : text;
}
