import { relative } from "node:path";
import type { FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

type RetryOnlyPassTest = {
  location: { file: string; line: number };
  titlePath(): string[];
  results: { error?: { message?: string } }[];
};

const annotationLimit = 10;

function testTitle(test: RetryOnlyPassTest): string {
  return test.titlePath().slice(1).filter(Boolean).join(" > ");
}

function label(test: TestCase): string {
  const { file, line } = test.location;
  return `${testTitle(test)} (${relative(process.cwd(), file)}:${line})`;
}

function duration(test: TestCase): number {
  return test.results.reduce((total, result) => total + result.duration, 0);
}

function escapeWorkflowText(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function retryOnlyPassWarning(test: RetryOnlyPassTest): string {
  const { file, line } = test.location;
  const path = relative(process.env.GITHUB_WORKSPACE ?? process.cwd(), file);
  const title = testTitle(test);
  const failure = (test.results[0]?.error?.message ?? "").replace(/\u001B\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/).map((text) => text.trim()).find(Boolean)?.slice(0, 160) ?? "";
  const message = `${title} passed on retry after its first attempt failed: ${failure}`;
  return `::warning file=${escapeWorkflowText(path).replaceAll(":", "%3A").replaceAll(",", "%2C")},line=${line},title=Retry-only pass::${escapeWorkflowText(message)}`;
}

export function retryOnlyPassWarnings(tests: RetryOnlyPassTest[]): string[] {
  if (!tests.length) return [];
  const annotated = tests.length > annotationLimit ? annotationLimit - 1 : tests.length;
  return [
    ...tests.slice(0, annotated).map(retryOnlyPassWarning),
    ...(tests.length > annotated
      ? [`::warning title=Retry-only pass::${tests.length - annotated} additional retry-only passes; see the flaky tests list and uploaded timings artifact.`]
      : []),
  ];
}

export default class AttemptTimingReporter implements Reporter {
  private suite?: Suite;

  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite;
  }

  onEnd(result: FullResult): void {
    const tests = this.suite?.allTests() ?? [];
    console.log("\nAttempt timing (per test):");
    for (const test of tests) {
      console.log(`  ${test.outcome()} ${label(test)}`);
      for (const attempt of test.results) {
        console.log(`    retry #${attempt.retry} ${attempt.status} ${attempt.duration}ms`);
      }
    }

    const flaky = tests.filter((test) => test.outcome() === "flaky");
    console.log(`Flaky tests (${flaky.length}):`);
    for (const test of flaky) console.log(`  ${label(test)}`);
    if (!flaky.length) console.log("  none");
    if (process.env.GITHUB_ACTIONS === "true") {
      for (const warning of retryOnlyPassWarnings(flaky)) console.log(warning);
    }

    console.log("Top slowest tests (total attempt time):");
    for (const test of tests.filter((test) => test.results.length).sort((a, b) => duration(b) - duration(a)).slice(0, 5)) {
      console.log(`  ${duration(test)}ms ${label(test)}`);
    }
    console.log(`Smoke totals: ${tests.filter((test) => test.outcome() === "expected").length} expected, ${flaky.length} flaky, ${tests.filter((test) => test.outcome() === "unexpected").length} unexpected, ${tests.filter((test) => test.outcome() === "skipped").length} skipped; ${result.duration}ms elapsed`);
  }
}
