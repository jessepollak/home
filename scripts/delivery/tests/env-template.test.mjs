import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateEnvTemplate, parseEnvTemplateNames, readDirectEnvNames } from "../env-template.mjs";
import { loadSourceFiles } from "../source-files.mjs";

// Operator-configured process.env reads in apps/web must be declared in
// .env.example. Platform/runtime-injected and test-only variables are exempt
// through this allowlist; every entry must still be read somewhere, so removed
// reads force allowlist cleanup instead of silent rot.

// Platform/runtime-injected (never operator configuration).
const PLATFORM_ALLOWLIST = [
  "CI",
  "LOCALAPPDATA", // Windows user-profile path used by playwright.config.ts
  "NEXT_DEPLOYMENT_ID",
  "NEXT_RUNTIME",
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
];

// Test and smoke toggles, not operator configuration.
const TEST_ONLY_ALLOWLIST = [
  "ACTION_PG_TEST_URL",
  "BALANCES_PG_TEST_URL",
  "FUNDING_PG_TEST_URL",
  "HOME_PLAYWRIGHT_SMOKE",
  "MORPHO_LIVE_SMOKE",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
];

test("scanner finds direct dot and bracket process.env reads", () => {
  const reads = readDirectEnvNames([
    { path: "a.ts", content: "const a = process.env.HOME_ONE; const b = process.env[\"HOME_TWO\"];\n" },
    { path: "b.tsx", content: "const c = process.env['HOME_THREE'];\nprocess.env[`${d}`];\nprocess.env[d];\n" },
  ]);
  assert.deepEqual([...reads.keys()].sort(), ["HOME_ONE", "HOME_THREE", "HOME_TWO"]);
});

test("evaluation reports missing, declared, allowlisted, and stale-allowlist cases", () => {
  const declared = new Set(["HOME_DECLARED"]);
  const read = new Map([
    ["HOME_DECLARED", new Set(["a.ts"])],
    ["HOME_MISSING", new Set(["b.ts"])],
    ["HOME_PLATFORM", new Set(["c.ts"])],
  ]);

  const result = evaluateEnvTemplate({
    declared,
    read,
    allowlist: ["HOME_PLATFORM", "HOME_REMOVED"],
  });
  assert.deepEqual(result, {
    undeclared: ["HOME_MISSING"],
    staleAllowlist: ["HOME_REMOVED"],
  });
});

test("every direct apps/web process.env read is declared or narrowly allowlisted", async () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const [template, files] = await Promise.all([
    readFile(new URL("../../../.env.example", import.meta.url), "utf8"),
    loadSourceFiles(`${repoRoot}/apps/web`, { extensions: [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"] }),
  ]);

  assert.ok(files.length > 100, "env scan must cover the apps/web source tree");
  const result = evaluateEnvTemplate({
    declared: parseEnvTemplateNames(template),
    read: readDirectEnvNames(files),
    allowlist: [...PLATFORM_ALLOWLIST, ...TEST_ONLY_ALLOWLIST],
  });
  assert.deepEqual(
    result,
    { undeclared: [], staleAllowlist: [] },
    "direct process.env reads must be declared in .env.example; update the documented platform/test allowlist only for non-operator variables",
  );
});
