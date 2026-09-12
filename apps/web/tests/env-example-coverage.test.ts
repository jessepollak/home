import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = join(import.meta.dir, "..");
const ENV_EXAMPLE = join(WEB_ROOT, "..", "..", ".env.example");

// Supplied by the runtime or the browser test harness, never by an operator,
// so they are deliberately absent from the template.
const NOT_OPERATOR_CONFIGURED = new Set([
  "LOCALAPPDATA",
  "NEXT_RUNTIME",
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "HOME_PLAYWRIGHT_SMOKE",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
]);

const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".vercel", "dist"]);

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests configure their own fixtures and live probes.
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

function declaredKeys(template: string): Set<string> {
  const keys = new Set<string>();
  for (const line of template.split("\n")) {
    const match = /^([A-Z0-9_]+)=/.exec(line.trim());
    if (match) keys.add(match[1]);
  }
  return keys;
}

test("every environment variable apps/web reads directly is declared in .env.example", () => {
  const declared = declaredKeys(readFileSync(ENV_EXAMPLE, "utf8"));
  expect(declared.size).toBeGreaterThan(0);

  const read = new Map<string, string>();
  for (const file of sourceFiles(WEB_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const name = match[1];
      if (NOT_OPERATOR_CONFIGURED.has(name)) continue;
      if (!read.has(name)) read.set(name, file.slice(WEB_ROOT.length + 1));
    }
  }
  expect(read.size).toBeGreaterThan(0);

  const undocumented = [...read]
    .filter(([name]) => !declared.has(name))
    .map(([name, file]) => `${name} (read in apps/web/${file})`)
    .sort();

  expect(undocumented).toEqual([]);
});

test("the allowlist stays honest: every entry is still read somewhere", () => {
  const sources = sourceFiles(WEB_ROOT).map((file) => readFileSync(file, "utf8"));
  const stale = [...NOT_OPERATOR_CONFIGURED].filter(
    (name) => !sources.some((source) => source.includes(`process.env.${name}`)),
  );

  expect(stale).toEqual([]);
});
