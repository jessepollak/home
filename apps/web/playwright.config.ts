import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveFixturePort } from "./scripts/fixture-port";
import { defineConfig } from "@playwright/test";
import { browserSmokeCiPolicy } from "./tests/browser/ci-policy";

function cachedChromiumExecutable(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  const roots = [
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "ms-playwright")
      : "",
  ].filter(Boolean);
  const executableNames = new Set([
    "chrome-headless-shell",
    "chrome",
    "chrome.exe",
    "headless_shell",
  ]);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const releases = readdirSync(root)
      .filter((entry) => entry.startsWith("chromium_headless_shell-") || entry.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const release of releases) {
      const executable = findExecutable(join(root, release), executableNames, 3);
      if (executable) return executable;
    }
  }
  return undefined;
}

function findExecutable(
  directory: string,
  names: ReadonlySet<string>,
  depth: number,
): string | undefined {
  if (depth < 0 || !existsSync(directory)) return undefined;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (names.has(entry)) return path;
    if (depth > 0 && statSync(path).isDirectory()) {
      const nested = findExecutable(path, names, depth - 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

const regression = process.env.HOME_PLAYWRIGHT_REGRESSION === "1";
const productionNavigation = process.env.HOME_PLAYWRIGHT_PRODUCTION === "1";
const executablePath = cachedChromiumExecutable();
const fixturePort = resolveFixturePort(process.env.HOME_FIXTURE_PORT);
process.env.HOME_FIXTURE_PORT = fixturePort;
const fixtureBaseUrl = `http://localhost:${fixturePort}`;

const playwrightCredentialKey = ["HOME", "PLAYWRIGHT", "ACCESS", "CREDENTIAL"].join("_");
const playwrightSigningSecretKey = ["HOME", "PLAYWRIGHT", "ACCESS", "SIGNING", "SECRET"].join("_");
const playwrightCookieKey = ["HOME", "PLAYWRIGHT", "ACCESS", "COOKIE"].join("_");
const accessCredential = process.env[playwrightCredentialKey] ?? randomBytes(32).toString("base64url");
const accessSigningSecret = process.env[playwrightSigningSecretKey] ?? randomBytes(32).toString("base64url");
const accessIssuedAt = new Date();
const accessPayload = JSON.stringify({
  version: 1,
  issuedAt: accessIssuedAt.toISOString(),
  expiresAt: new Date(accessIssuedAt.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
});
const accessKey = createHmac("sha256", Buffer.from(accessSigningSecret, "utf8"))
  .update("home:deployment-access:v1:signing-key")
  .update("\0")
  .update(accessCredential, "utf8")
  .digest();
const accessEncoded = Buffer.from(accessPayload, "utf8").toString("base64url");
const accessInput = `v1.${accessEncoded}`;
const accessToken = `${accessInput}.${createHmac("sha256", accessKey).update(accessInput).digest("base64url")}`;
const accessCookie = `home-access=${accessToken}`;
process.env[playwrightCredentialKey] = accessCredential;
process.env[playwrightSigningSecretKey] = accessSigningSecret;
process.env[playwrightCookieKey] = accessCookie;
process.env.HOME_ACCESS_REQUIRED = "1";
process.env["HOME_ACCESS_PASSWORD"] = accessCredential;
process.env.HOME_ACCESS_SIGNING_SECRET = accessSigningSecret;

export default defineConfig({
  globalSetup: regression ? "./tests/browser/global-setup.ts" : productionNavigation ? undefined : "./tests/browser/smoke-setup.ts",
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  fullyParallel: !regression && !productionNavigation,
  workers: regression || productionNavigation ? 1 : 2,
  globalTimeout: !regression && !productionNavigation && process.env.CI ? 75_000 : undefined,
  ...browserSmokeCiPolicy(Boolean(process.env.CI), { rejectRetryOnlyPass: regression }),
  ...(productionNavigation ? {
    retries: 0,
    outputDir: "test-results/production-navigation",
    reporter: [["list"], ["json", { outputFile: "test-results/production-navigation.json" }]],
  } satisfies Parameters<typeof defineConfig>[0] : {}),
  webServer: {
    ...(productionNavigation
      ? { command: `./node_modules/.bin/next build && ./node_modules/.bin/next start --hostname 127.0.0.1 --port ${fixturePort}`, timeout: 900_000 }
      : { command: `bun run dev -- --port ${fixturePort}` }),
    url: fixtureBaseUrl,
    reuseExistingServer: false,
    env: {
      ...process.env,
      HOME_PLAYWRIGHT_SMOKE: "1",
      HOME_OPERATOR_ADDRESSES: "0x1111111111111111111111111111111111111111,0x3333333333333333333333333333333333333333",
      HOME_SESSION_SECRET: "playwright-smoke-home-session-secret-32-bytes!!",
      HOME_ACCESS_REQUIRED: "1",
      HOME_ACCESS_SIGNING_SECRET: accessSigningSecret,
      HOME_ACCESS_PASSWORD: accessCredential,
    },
  },
  use: {
    baseURL: fixtureBaseUrl,
    headless: true,
    trace: "retain-on-failure",
    video: productionNavigation ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    storageState: {
      cookies: [{
        name: "home-access",
        value: accessToken,
        domain: "localhost",
        path: "/",
        expires: Math.floor(accessIssuedAt.getTime() / 1_000) + 7 * 24 * 60 * 60,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      }],
      origins: [],
    },
  },
  projects: [
    {
      name: productionNavigation ? "chromium-production-navigation" : "chromium-smoke",
      ...(productionNavigation
        ? { testMatch: "shell-pages.pw.ts", grep: /production:/ }
        : { grep: regression ? undefined : /@smoke/, grepInvert: /production:/ }),
      use: {
        browserName: "chromium",
        launchOptions: !productionNavigation && executablePath ? { executablePath } : undefined,
      },
    },
  ],
});
