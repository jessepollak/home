import { afterAll, expect } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Every rule case in this directory spawns an Oxlint child, so each phase gets its own budget
// instead of sharing bun's 5 s default: under concurrent load a single spawn can outlast it.
export const budgetMs = 60_000;

const appsWebDir = fileURLToPath(new URL("../../..", import.meta.url));
const oxlintBin = path.join(appsWebDir, "node_modules", ".bin", "oxlint");
const homePlugin = "./oxlint/home-plugin.mjs";

function normalized(rule) {
  return rule.includes("/") ? rule : `home/${rule}`;
}

function ruleSettings(request) {
  if (request.rule !== undefined) {
    return { [normalized(request.rule)]: request.options === undefined ? "error" : ["error", request.options] };
  }
  const rules = request.rules;
  if (typeof rules === "string") return { [normalized(rules)]: "error" };
  if (Array.isArray(rules)) return Object.fromEntries(rules.map((rule) => [normalized(rule), "error"]));
  return Object.fromEntries(Object.entries(rules).map(([rule, setting]) => [normalized(rule), setting]));
}

function diagnosticCodes(settings) {
  return new Set(Object.keys(settings).map((rule) => `home(${rule.replace(/^home\//u, "")})`));
}

function destination(directory, value) {
  return path.resolve(directory, String(value));
}

// A workspace is a throwaway project mirror that resolves the home plugin the way apps/web does:
// the pinned Oxlint binary, the plugin from ./oxlint, and node_modules linked to the real tree.
export async function createOxlintWorkspace(prefix, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  await cp(path.join(appsWebDir, "oxlint"), path.join(directory, "oxlint"), { recursive: true });
  await symlink(path.join(appsWebDir, "node_modules"), path.join(directory, "node_modules"), "dir");
  const fixturePath = options.path ?? ((name) => `${name}.ts`);
  let configIndex = 0;

  async function writeConfig(settings) {
    configIndex += 1;
    const config = `.oxlintrc-${configIndex}.json`;
    await writeFile(path.join(directory, config), JSON.stringify({
      plugins: [],
      categories: { correctness: "off" },
      jsPlugins: [homePlugin],
      rules: settings,
    }));
    return config;
  }

  function collect(fixtures) {
    const entries = Object.entries(fixtures).map(([name, fixture]) => {
      const value = typeof fixture === "string" ? { code: fixture } : fixture;
      return { name, code: value.code, path: value.path ?? fixturePath(name) };
    });
    const keys = new Set(entries.map((entry) => destination(directory, entry.path)));
    if (keys.size !== entries.length) throw new Error(`Duplicate fixture paths in ${prefix}: ${entries.map((entry) => entry.path).join(", ")}`);
    return entries;
  }

  // One child per case: every fixture is linted in the same invocation and each finding is
  // attributed back by fixture path, so a case never pays one spawn per fixture.
  async function lintWithConfig(fixtures, { config, flags = [] } = {}) {
    const entries = collect(fixtures);
    await Promise.all(entries.map(async (entry) => {
      const file = destination(directory, entry.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, entry.code);
    }));
    const result = spawnSync(oxlintBin,
      ["-c", config, "--disable-nested-config", "-f", "json", ...flags, ...entries.map((entry) => entry.path)],
      { cwd: directory, encoding: "utf8" });
    expect(result.signal).toBeNull();
    expect([0, 1]).toContain(result.status);
    expect(result.stdout).not.toBeEmpty();
    let diagnostics;
    try {
      diagnostics = JSON.parse(result.stdout).diagnostics ?? [];
    } catch {
      throw new Error(`Oxlint produced no JSON report for ${prefix} (status ${result.status}): ${result.stdout.slice(0, 300)} ${result.stderr.slice(0, 300)}`);
    }
    const names = new Map(entries.map((entry) => [destination(directory, entry.path), entry.name]));
    const findings = Object.fromEntries(entries.map((entry) => [entry.name, []]));
    for (const diagnostic of diagnostics) {
      const filename = String(diagnostic.filename ?? "");
      const name = names.get(destination(directory, filename));
      if (name === undefined) throw new Error(`Unattributed diagnostic for ${diagnostic.filename} in ${prefix}`);
      findings[name].push(diagnostic);
    }
    return findings;
  }

  // `request` is { rule, options } for one home rule, or { rules } as a rule name, a list, or a
  // settings map. Without either, the workspace rules from the options argument apply.
  async function lint(fixtures, request = {}) {
    const configured = request.rule !== undefined || request.rules !== undefined;
    const settings = ruleSettings(configured ? request : { rules: options.rules ?? [] });
    const codes = diagnosticCodes(settings);
    if (!codes.size) throw new Error(`No rules configured for ${prefix}`);
    const config = await writeConfig(settings);
    const findings = await lintWithConfig(fixtures, { config, flags: request.flags });
    return Object.fromEntries(Object.entries(findings).map(([name, diagnostics]) =>
      [name, diagnostics.filter((diagnostic) => codes.has(diagnostic.code))]));
  }

  afterAll(() => rm(directory, { recursive: true, force: true }), budgetMs);
  return { directory, lint, lintWithConfig };
}
