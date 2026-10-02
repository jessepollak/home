import { defineConfig } from "@playwright/test";
import { browserSmokeCiPolicy } from "../ci-policy";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.fixture.ts",
  ...browserSmokeCiPolicy(true, { rejectRetryOnlyPass: process.env.SMOKE_POLICY_REJECT_RETRY_ONLY_PASS === "1" }),
  use: { trace: "retain-on-failure" },
});
