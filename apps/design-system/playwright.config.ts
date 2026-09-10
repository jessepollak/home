import { defineConfig } from "@playwright/test";

const catalogURL = `http://127.0.0.1:${process.env.HOME_DESIGN_SYSTEM_PORT || "3100"}`;

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    baseURL: catalogURL,
    browserName: "chromium",
    headless: true,
    // No automatic screenshots: exact-head publication is a separate proof gate.
    screenshot: "off",
    trace: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    // Intentionally consumes the already-built catalog, never a dev-only route.
    command: "bun run start",
    url: catalogURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
