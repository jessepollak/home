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
  "PATH", // process PATH used by spawn-based test harnesses
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL", // Vercel-owned production deployment hostname
];

// Test and smoke toggles, not operator configuration.
const TEST_ONLY_ALLOWLIST = [
  "ACTION_PG_TEST_URL",
  "BALANCES_PG_TEST_URL",
  "FAKE_AGENT_BROWSER_ADDRESS",
  "FAKE_AGENT_BROWSER_AUTHENTICATED",
  "FAKE_AGENT_BROWSER_BALANCE",
  "FAKE_AGENT_BROWSER_BODY",
  "FAKE_AGENT_BROWSER_CONTROLS",
  "FAKE_AGENT_BROWSER_FAIL_CALL",
  "FAKE_AGENT_BROWSER_FAIL_EXPECT",
  "FAKE_AGENT_BROWSER_FAIL_WAIT",
  "FAKE_AGENT_BROWSER_FAILURES",
  "FAKE_AGENT_BROWSER_HAR",
  "FAKE_AGENT_BROWSER_HOSTS",
  "FAKE_AGENT_BROWSER_LOG",
  "FAKE_AGENT_BROWSER_MARKS",
  "FAKE_AGENT_BROWSER_PATH",
  "FAKE_AGENT_BROWSER_PREFIX_NAMES",
  "FAKE_AGENT_BROWSER_REFS",
  "FAKE_AGENT_BROWSER_REVIEW",
  "FUNDING_PG_TEST_URL",
  "HOME_PLAYWRIGHT_SMOKE",
  "MORPHO_LIVE_SMOKE",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
];

test("scanner finds direct dot and literal-bracket process.env reads", () => {
  const reads = readDirectEnvNames([
    { path: "a.ts", content: "const a = process.env.HOME_ONE; const b = process.env[\"HOME_TWO\"];\n" },
    { path: "b.tsx", content: "const c = process.env['HOME_THREE']; const d = `${process.env.HOME_TEMPLATE}`;\n" },
  ]);
  assert.deepEqual([...reads.keys()].sort(), ["HOME_ONE", "HOME_TEMPLATE", "HOME_THREE", "HOME_TWO"]);
});

test("scanner follows aliases assigned directly from process.env", () => {
  const reads = readDirectEnvNames([
    {
      path: "aliases.ts",
      content: `
        const runtime = process.env;
        const one = runtime.HOME_ALIAS_DOT;
        const two = runtime["HOME_ALIAS_BRACKET"];
        function injected(runtime: Record<string, string | undefined>) {
          return runtime.HOME_INJECTED_SHADOW;
        }
        function configured(env: Readonly<Record<string, string | undefined>> = process.env) {
          return env.HOME_ALIAS_DEFAULT;
        }
      `,
    },
  ]);
  assert.deepEqual([...reads.keys()].sort(), ["HOME_ALIAS_BRACKET", "HOME_ALIAS_DEFAULT", "HOME_ALIAS_DOT"]);
});

test("scanner follows process.env fallback aliases without globalizing injected records", () => {
  const reads = readDirectEnvNames([
    {
      path: "fallback.ts",
      content: `
        function runtime(options: { env?: Record<string, string | undefined> } = {}) {
          const env = options.env ?? process.env;
          const direct = env.HOME_FALLBACK_DIRECT;
          return helper(env);
        }
        function helper(environment: Record<string, string | undefined>) {
          return environment.HOME_FALLBACK_HELPER;
        }
        function purelyInjected(env: Record<string, string | undefined>) {
          return env.HOME_INJECTED_ONLY;
        }
      `,
    },
  ]);
  assert.deepEqual([...reads.keys()].sort(), ["HOME_FALLBACK_DIRECT", "HOME_FALLBACK_HELPER"]);
});

test("an inner fallback alias wins over a later outer alias with the same name", () => {
  const reads = readDirectEnvNames([
    {
      path: "innermost-alias.ts",
      content: `
        function configured(options: { env?: Record<string, string | undefined> } = {}) {
          const env = options.env ?? process.env;
          return env.HOME_INNER_FALLBACK;
        }
        const env = process.env;
        const outer = env.HOME_OUTER_ALIAS;
      `,
    },
  ]);
  assert.deepEqual([...reads.keys()].sort(), ["HOME_INNER_FALLBACK", "HOME_OUTER_ALIAS"]);
});

test("local variable bindings shadow outer process.env aliases", () => {
  const reads = readDirectEnvNames([
    {
      path: "variable-shadows.ts",
      content: `
        const constEnv = process.env;
        const keep = constEnv.HOME_OUTER_CONST;
        { const constEnv = injected; constEnv.HOME_SHADOWED_CONST; }

        const letEnv = process.env;
        function withLet() { let letEnv = injected; return letEnv.HOME_SHADOWED_LET; }
        const keepLet = letEnv.HOME_OUTER_LET;

        const varEnv = process.env;
        function withVar() { var varEnv = injected; return varEnv.HOME_SHADOWED_VAR; }
        const keepVar = varEnv.HOME_OUTER_VAR;
      `,
    },
  ]);
  assert.deepEqual([...reads.keys()].sort(), ["HOME_OUTER_CONST", "HOME_OUTER_LET", "HOME_OUTER_VAR"]);
});

test("helper propagation rejects a call-site alias shadowed by an injected parameter", () => {
  const reads = readDirectEnvNames([
    {
      path: "shadowed-helper.ts",
      content: `
        const env = configuredEnv ?? process.env;
        function injected(env: Record<string, string | undefined>) {
          return injectedHelper(env);
        }
        function injectedHelper(record: Record<string, string | undefined>) {
          return record.HOME_SHADOWED_HELPER;
        }
      `,
    },
  ]);
  assert.deepEqual([...reads.keys()], []);
});

test("scanner excludes injected records and dynamic property names", () => {
  const reads = readDirectEnvNames([
    {
      path: "controls.ts",
      content: `
        function injected(env: Record<string, string | undefined>) {
          return env.HOME_INJECTED_RECORD;
        }
        function configured(runtime = process.env) {
          const dynamic = "HOME_DYNAMIC";
          return runtime[dynamic] ?? runtime[\`HOME_\${dynamic}\`] ?? process.env[dynamic];
        }
      `,
    },
  ]);
  assert.deepEqual([...reads.keys()], []);
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
