import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

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

const executablePath = cachedChromiumExecutable();

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "smoke.pw.ts",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "bun run dev -- --port 3199",
    url: "http://localhost:3199",
    reuseExistingServer: false,
    env: {
      ...process.env,
      HOME_PLAYWRIGHT_SMOKE: "1",
    },
  },
  use: {
    baseURL: "http://localhost:3199",
    browserName: "chromium",
    headless: true,
    launchOptions: executablePath ? { executablePath } : undefined,
  },
});
