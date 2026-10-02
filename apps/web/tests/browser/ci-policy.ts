import { resolve } from "node:path";
import type { PlaywrightTestConfig } from "@playwright/test";

const attemptTimingReporter = resolve(__dirname, "attempt-timing-reporter.ts");

export type BrowserSmokeCiPolicyOptions = { rejectRetryOnlyPass?: boolean };

export function browserSmokeCiPolicy(ci: boolean, { rejectRetryOnlyPass = false }: BrowserSmokeCiPolicyOptions = {}): Pick<PlaywrightTestConfig, "retries" | "failOnFlakyTests" | "reporter"> {
  return {
    retries: ci ? 1 : 0,
    failOnFlakyTests: ci && rejectRetryOnlyPass,
    reporter: ci ? [["list"], [attemptTimingReporter], ["json", { outputFile: resolve(__dirname, "../../test-results/smoke-timings.json") }]] : "list",
  };
}
