import { relative } from "node:path";
import type { FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

function label(test: TestCase): string {
  const { file, line } = test.location;
  return `${test.titlePath().slice(1).join(" > ")} (${relative(process.cwd(), file)}:${line})`;
}

function duration(test: TestCase): number {
  return test.results.reduce((total, result) => total + result.duration, 0);
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

    console.log("Top slowest tests (total attempt time):");
    for (const test of tests.filter((test) => test.results.length).sort((a, b) => duration(b) - duration(a)).slice(0, 5)) {
      console.log(`  ${duration(test)}ms ${label(test)}`);
    }
    console.log(`Smoke totals: ${tests.filter((test) => test.outcome() === "expected").length} expected, ${flaky.length} flaky, ${tests.filter((test) => test.outcome() === "unexpected").length} unexpected, ${tests.filter((test) => test.outcome() === "skipped").length} skipped; ${result.duration}ms elapsed`);
  }
}
