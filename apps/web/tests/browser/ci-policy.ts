import { resolve } from "node:path";
import type { PlaywrightTestConfig } from "@playwright/test";

const attemptTimingReporter = resolve(__dirname, "attempt-timing-reporter.ts");

export function browserSmokeCiPolicy(ci: boolean): Pick<PlaywrightTestConfig, "retries" | "failOnFlakyTests" | "reporter"> {
  return {
    retries: ci ? 2 : 0,
    failOnFlakyTests: ci,
    reporter: ci ? [["list"], [attemptTimingReporter]] : "list",
  };
}
