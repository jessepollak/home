import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { rawEnvExceptions } from "../policy/raw-env.mjs";
applyRuleCheckTimeout();

const { directory, lint, lintWithConfig } = await createOxlintWorkspace("home-oxlint-raw-env-", {
  rules: ["no-raw-process-env"],
  path: (name) => `server/fixtures/${name}.ts`,
});
const rejectedMessage = "Read server environment through server/config/env.ts instead of raw process.env.";

describe("no-raw-process-env", () => {
  it("rejects every raw environment reference form", async () => {
    const findings = await lint({
      dot: "const value = process.env.HOME_ONE;",
      bracketRead: 'const value = process.env["HOME_ONE"];',
      computedEnvironment: 'const value = process["env"].HOME_ONE;',
      templateEnvironment: "const value = process[`env`].HOME_ONE;",
      concatenatedEnvironment: 'const value = process["en" + "v"].HOME_ONE;',
      destructured: "const { HOME_ONE } = process.env;",
      alias: "const env = process.env; const value = env.HOME_ONE;",
      optionalProcess: "const value = process?.env.HOME_ONE;",
      optionalEnvironment: "const value = process.env?.HOME_ONE;",
      optionalComputed: 'const value = process?.["env"]?.["HOME_ONE"];',
      templateRead: "const value = process.env[`HOME_${name}`];",
      dynamicRead: "const value = process.env[name];",
      templateExpression: "const value = `${process.env.HOME_ONE}`;",
      passedValue: "configure(process.env);",
      returnedValue: "function read() { return process.env; }",
      spread: "const values = { ...process.env };",
      defaultParameter: "function read(env = process.env) { return env.HOME_ONE; }",
      assertion: "const value = (process as typeof process).env.HOME_ONE;",
      nonNull: "const value = process!.env.HOME_ONE;",
      imported: 'import process from "node:process"; process.env.HOME_ONE;',
      bareImported: 'import process from "process"; process.env.HOME_ONE;',
      namedImported: 'import { default as process } from "node:process"; process.env.HOME_ONE;',
      bareNamedImported: 'import { default as process } from "process"; process.env.HOME_ONE;',
      namespaceImported: 'import * as process from "node:process"; process.env.HOME_ONE;',
      bareNamespaceImported: 'import * as process from "process"; process.env.HOME_ONE;',
      aliasedDefaultImport: 'import runtime from "node:process"; runtime.env.HOME_ONE;',
      aliasedNamedImport: 'import { default as runtime } from "node:process"; runtime.env.HOME_ONE;',
      aliasedNamespaceImport: 'import * as runtime from "node:process"; runtime.env.HOME_ONE;',
      namedEnvironment: 'import { env } from "node:process"; env.HOME_ONE;',
      bareNamedEnvironment: 'import { env } from "process"; env.HOME_ONE;',
      aliasedEnvironment: 'import { env as runtimeEnv } from "node:process"; runtimeEnv.HOME_ONE;',
      bareAliasedEnvironment: 'import { env as runtimeEnv } from "process"; runtimeEnv.HOME_ONE;',
      destructuredEnvironment: 'import { env } from "node:process"; const { HOME_ONE } = env;',
      passedEnvironment: 'import { env as runtimeEnv } from "process"; configure(runtimeEnv);',
      returnedEnvironment: 'import { env } from "node:process"; function read() { return env; }',
      spreadEnvironment: 'import { env } from "process"; const values = { ...env };',
      shorthandEnvironment: 'import { env } from "node:process"; configure({ env });',
    });
    for (const [name, diagnostics] of Object.entries(findings)) {
      expect(diagnostics, name).toHaveLength(1);
      expect(diagnostics[0].message, name).toBe(rejectedMessage);
    }
  }, budgetMs);

  it("accepts the sole entrypoint, test files, and non-server files", async () => {
    const code = "const value = process.env.HOME_ONE;";
    const findings = await lint({
      entrypoint: { code, path: "server/config/env.ts" },
      test: { code, path: "server/config/env.test.ts" },
      variantTest: { code, path: "server/config/env.test.integration.ts" },
      testsDirectory: { code, path: "server/tests/fixture.ts" },
      client: { code, path: "client/config.ts" },
      app: { code, path: "app/config.ts" },
      shared: { code, path: "shared/config.ts" },
    }, { rule: "no-raw-process-env", options: { allow: [] } });
    for (const diagnostics of Object.values(findings)) expect(diagnostics).toHaveLength(0);
  }, budgetMs);

  it("accepts shadowed process bindings without confusing other properties", async () => {
    const findings = await lint({
      parameter: "function run(process) { return process.env.HOME_ONE; }",
      const: "const process = injected; process.env.HOME_ONE;",
      let: "let process = injected; process.env.HOME_ONE;",
      var: "var process = injected; process.env.HOME_ONE;",
      declaration: "function process() {} process.env.HOME_ONE;",
      shadowedImport: 'import process from "node:process"; function run(process) { return process.env.HOME_ONE; }',
      locallyShadowedImport: 'import process from "process"; { const process = injected; process.env.HOME_ONE; }',
      aliasImport: 'import { fixture as process } from "./injected"; process.env.HOME_ONE;',
      versionsImport: 'import { versions } from "node:process"; versions.env;',
      bareVersionsImport: 'import { versions as process } from "process"; process.env;',
      unusedEnvironmentImport: 'import { env } from "node:process"; const value = injected.env;',
      shadowedEnvironmentImport: 'import { env } from "node:process"; function run(env) { return env.HOME_ONE; }',
      locallyShadowedEnvironmentImport: 'import { env as runtimeEnv } from "process"; { const runtimeEnv = injected; runtimeEnv.HOME_ONE; }',
      typeEnvironmentImport: 'import type { env } from "node:process"; type Environment = typeof env;',
      inlineTypeEnvironmentImport: 'import { type env as runtimeEnv } from "process"; type Environment = typeof runtimeEnv;',
      typeDefaultImport: 'import type process from "node:process"; type Environment = typeof process.env;',
      typeNamespaceImport: 'import type * as process from "process"; type Environment = typeof process.env;',
      typeNamedDefaultImport: 'import { type default as process } from "node:process"; type Environment = typeof process.env;',
      environmentTypeReference: 'import { env } from "node:process"; type Environment = typeof env;',
      qualifiedEnvironmentTypeReference: 'import { env } from "process"; type Value = typeof env.HOME_ONE;',
      catch: "try { run(); } catch (process) { process.env.HOME_ONE; }",
      nested: "function run(process) { return () => process.env.HOME_ONE; }",
      destructured: "const { runtime: process } = injected; process.env.HOME_ONE;",
      nonEnvironment: "process.version; process.argv; unrelated.process.env.HOME_ONE;",
      prose: 'const text = "process.env.HOME_ONE"; // process.env.HOME_TWO\n',
    });
    for (const [name, diagnostics] of Object.entries(findings)) expect(diagnostics, name).toHaveLength(0);
    const mixed = await lint({ mixed: "{ const process = injected; process.env.HOME_ONE; } process.env.HOME_TWO;" });
    expect(mixed.mixed).toHaveLength(1);
  }, budgetMs);

  it("recognizes a platform process global with zero definitions", async () => {
    const config = ".oxlintrc-platform.json";
    await writeFile(path.join(directory, config), JSON.stringify({
      plugins: [], categories: { correctness: "off" }, env: { node: true },
      jsPlugins: ["./oxlint/home-plugin.mjs"], rules: { "home/no-raw-process-env": "error" },
    }));
    const findings = await lintWithConfig({ global: "process.env.HOME_ONE;" }, { config });
    expect(findings.global).toHaveLength(1);
  }, budgetMs);

  it("rejects former registry exemptions and accepts only exact explicit allow lists", async () => {
    const code = "process.env.HOME_ONE;";
    const grandfatheredPath = "server/access/config.ts";
    expect((await lint({ registered: { code, path: grandfatheredPath } })).registered).toHaveLength(1);
    const findings = await lint({
      registered: { code, path: grandfatheredPath },
      neighbor: { code, path: "server/config/env.tsx" },
      nestedEntrypoint: { code, path: "server/nested/server/config/env.ts" },
      nestedMarker: { code, path: "server/nested/apps/web/server/config/env.ts" },
      nestedRegistry: { code, path: `server/nested/${grandfatheredPath}` },
    }, { rule: "no-raw-process-env", options: { allow: [] } });
    for (const diagnostics of Object.values(findings)) expect(diagnostics).toHaveLength(1);
    expect((await lint({ allowed: { code, path: "server/probe.ts" } }, {
      rule: "no-raw-process-env", options: { allow: ["server/probe.ts"] },
    })).allowed).toHaveLength(0);
    expect(rawEnvExceptions.has("server/config/env.ts")).toBe(false);
  }, budgetMs);

  it("pins the empty registry size and reference total", () => {
    expect(rawEnvExceptions.size).toBe(0);
    expect([...rawEnvExceptions.values()].reduce((total, count) => total + count, 0)).toBe(0);
  });
});
