import { defineConfig } from "@playwright/test";
import { browserSmokeCiPolicy } from "../ci-policy";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.fixture.ts",
  ...browserSmokeCiPolicy(true),
  use: { trace: "retain-on-failure" },
});
