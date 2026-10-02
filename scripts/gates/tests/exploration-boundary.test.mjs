import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOUNDARY_EXCLUDED_FILES, BOUNDARY_EXTENSIONS, BOUNDARY_EXTENSIONS_GLOB, BOUNDARY_IGNORE_PATTERNS, BOUNDARY_INVENTORY_EXCEPTIONS, BOUNDARY_RULE, BOUNDARY_RULES, FENCED_LAYERS, ROOT_CATCH_ALL,
  evaluateBoundaryConfig, evaluateBoundaryExemptions, evaluateBoundaryInventory, existingBoundaryPaths, expectedBoundaryFiles, isPreclassifiedRootFile, rootSourceFiles, topLevelSourceDirectories,
} from "../exploration-boundary.mjs";

const ts = createRequire(new URL("../../../apps/web/package.json", import.meta.url))("typescript");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const exemptionsUrl = new URL("../exploration-boundary-exemptions.json", import.meta.url);
const clean = { requiredFence: [], requiredRootFence: [], exempt: [], exemptRootFiles: [], preclassifiedRootFiles: [], stale: [], invalid: [] };
const cleanBoundary = { owners: 1, severities: ["error"], missingRules: [], unenforcedRules: [], missing: [], unexpected: [], missingExclusions: [], unexpectedExclusions: [], missingIgnores: [], unexpectedIgnores: [] };
const cleanInventory = { unparsed: [], staleExceptions: [], invalidExceptions: [] };
const missingBoundary = {
  ...cleanBoundary, owners: 0, severities: [], missingRules: [...BOUNDARY_RULES].sort(), missing: expectedBoundaryFiles().sort(), missingExclusions: [...BOUNDARY_EXCLUDED_FILES].sort(),
};

function boundaryOverride(fields = {}) {
  return { files: expectedBoundaryFiles(), excludeFiles: BOUNDARY_EXCLUDED_FILES, rules: Object.fromEntries(BOUNDARY_RULES.map((rule) => [rule, "error"])), ...fields };
}

async function realBoundary() {
  const exemptions = JSON.parse(await readFile(exemptionsUrl, "utf8"));
  const paths = existingBoundaryPaths(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: root })
    .toString().split("\0").filter(Boolean).map((entry) => path.join(root, entry)))
    .map((entry) => path.relative(path.join(root, "apps/web"), entry).split(path.sep).join("/"));
  const directories = topLevelSourceDirectories(paths);
  const rootFiles = rootSourceFiles(paths);
  return { directories, rootFiles, boundary: evaluateBoundaryExemptions({ directories, rootFiles, exemptions }) };
}

test("existing boundary paths skip only ENOENT entries", () => {
  const paths = ["types/existing.js", "types/missing.js"];
  const stat = (path) => {
    if (path === "types/missing.js") throw Object.assign(new Error("missing source"), { code: "ENOENT" });
    return {};
  };
  assert.deepEqual(existingBoundaryPaths(paths, stat), ["types/existing.js"]);
});

test("existing boundary paths rethrow EACCES and other non-ENOENT stat failures", () => {
  for (const error of [
    Object.assign(new Error("permission denied"), { code: "EACCES" }),
    Object.assign(new Error("I/O failure"), { code: "EIO" }),
    new Error("unknown stat failure"),
  ]) {
    assert.throws(() => existingBoundaryPaths(["types/probe.js"], () => { throw error; }), (thrown) => thrown === error);
  }
});

test("existing boundary paths keep entries whose stat succeeds", () => {
  const paths = ["types/a.js", "types/b.js"];
  assert.deepEqual(existingBoundaryPaths(paths, () => ({})), paths);
});

test("existing boundary paths default to a real stat", () => {
  const existing = fileURLToPath(import.meta.url);
  assert.deepEqual(existingBoundaryPaths([existing, `${existing}.missing`]), [existing]);
});

test("tracked and new source directories and root files are fenced or reasonedly exempted", async () => {
  const { directories, rootFiles, boundary } = await realBoundary();
  assert.deepEqual(boundary.stale, []);
  assert.deepEqual(boundary.invalid, []);
  assert.ok(boundary.exempt.length > 0, "non-production exemptions must not be empty");
  assert.ok(boundary.exemptRootFiles.length > 0, "non-production root-file exemptions must not be empty");
  assert.deepEqual([...boundary.requiredFence, ...boundary.exempt].sort(), directories, "every source directory must have exactly one classification");
  assert.deepEqual([...boundary.requiredRootFence, ...boundary.exemptRootFiles, ...boundary.preclassifiedRootFiles].sort(), rootFiles,
    "every root-level source file must have exactly one classification");
  assert.ok(boundary.requiredFence.length > 0, "production fences must not be empty");
  assert.deepEqual(boundary.requiredFence, FENCED_LAYERS,
    `top-level source directories must be fenced or exempted; requiredFence: ${boundary.requiredFence.join(", ")}`);
});

test("the real oxlint config has exactly the canonical exploration boundary patterns", async () => {
  for (const filename of [".eslintignore", ".oxlintignore"]) {
    assert.equal(existsSync(path.join(root, "apps/web", filename)), false,
      `${filename}: an additional ignore file may not prevent production source from being selected for linting; oxlint merges such files into the effective configuration, so remove the file or add an explicit reasoned entry instead`);
  }
  const parsed = ts.parseConfigFileTextToJson("apps/web/.oxlintrc.jsonc",
    await readFile(new URL("../../../apps/web/.oxlintrc.jsonc", import.meta.url), "utf8"));
  assert.equal(parsed.error, undefined, parsed.error && ts.flattenDiagnosticMessageText(parsed.error.messageText, " "));
  assert.equal(Object.hasOwn(parsed.config, "extends"), false,
    "the boundary contract reads this config directly; an inherited config can add a second owner or an unanchored root pattern, so resolve extends in this contract before using it");
  assert.ok(Array.isArray(parsed.config.overrides) && parsed.config.overrides.length > 0, "the config must contain overrides");
  const { boundary: { exemptRootFiles } } = await realBoundary();
  assert.deepEqual(evaluateBoundaryConfig({ overrides: parsed.config.overrides, ignorePatterns: parsed.config.ignorePatterns, exemptRootFiles }), cleanBoundary);
});

test("oxlint selects every git-visible lintable source for linting except reasoned inventory exceptions", () => {
  const paths = existingBoundaryPaths(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: root })
    .toString().split("\0").filter(Boolean).map((entry) => path.join(root, entry)))
    .map((entry) => path.relative(path.join(root, "apps/web"), entry).split(path.sep).join("/"))
    .filter((entry) => BOUNDARY_EXTENSIONS.some((extension) => entry.endsWith(extension)));
  const result = spawnSync(path.join(root, "apps/web/node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "--debug", "files", "."],
    { cwd: path.join(root, "apps/web"), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const parsed = [...new Set(`${result.stdout}\n${result.stderr}`.split(/\r?\n/)
    .map((entry) => entry.trim().replace(/^\.\//, "")).filter(Boolean))];
  assert.ok(parsed.length > 0, "oxlint's inventory of files selected for linting must not be empty");
  assert.deepEqual(evaluateBoundaryInventory({ paths, parsed, exceptions: BOUNDARY_INVENTORY_EXCEPTIONS }), cleanInventory,
    "oxlint must select every git-visible lintable source for linting except reasoned inventory exceptions");
});

test("an unparsed source is reported unless it has a reasoned inventory exception", () => {
  const paths = ["types/probe.js"];
  assert.deepEqual(evaluateBoundaryInventory({ paths, parsed: [], exceptions: [] }),
    { ...cleanInventory, unparsed: paths });
  assert.deepEqual(evaluateBoundaryInventory({ paths, parsed: [], exceptions: [{ path: paths[0], reason: "Vendored source." }] }), cleanInventory);
});

test("an inventory exception becomes stale when its source is parsed", () => {
  const paths = ["types/probe.js"];
  assert.deepEqual(evaluateBoundaryInventory({ paths, parsed: paths, exceptions: [{ path: paths[0], reason: "Vendored source." }] }),
    { ...cleanInventory, staleExceptions: paths });
});

test("an inventory exception becomes stale when its source is no longer git-visible", () => {
  assert.deepEqual(evaluateBoundaryInventory({ paths: [], parsed: [], exceptions: [{ path: "types/probe.js", reason: "Vendored source." }] }),
    { ...cleanInventory, staleExceptions: ["types/probe.js"] });
});

test("blank and missing inventory exception reasons are invalid and do not exempt a source", () => {
  for (const entry of [{ path: "types/probe.js", reason: " " }, { path: "types/probe.js" }]) {
    assert.deepEqual(evaluateBoundaryInventory({ paths: [entry.path], parsed: [], exceptions: [entry] }),
      { ...cleanInventory, unparsed: [entry.path], invalidExceptions: [entry.path] });
  }
});

test("missing and blank inventory exception paths are invalid", () => {
  for (const entry of [{ reason: "Vendored source." }, { path: "", reason: "Vendored source." }, { path: " ", reason: "Vendored source." }]) {
    assert.deepEqual(evaluateBoundaryInventory({ paths: [], parsed: [], exceptions: [entry] }),
      { ...cleanInventory, invalidExceptions: [""] });
  }
});

test("non-object inventory exceptions are invalid", () => {
  for (const entry of [null, "types/probe.js", 1, []]) {
    assert.deepEqual(evaluateBoundaryInventory({ paths: [], parsed: [], exceptions: [entry] }),
      { ...cleanInventory, invalidExceptions: [""] });
  }
});

test("duplicate inventory exception paths are invalid", () => {
  const entry = { path: "types/probe.js", reason: "Vendored source." };
  assert.deepEqual(evaluateBoundaryInventory({ paths: [entry.path], parsed: [], exceptions: [entry, entry] }),
    { ...cleanInventory, invalidExceptions: [entry.path] });
});

test("non-array parsed inventories fail closed with every source unparsed", () => {
  for (const parsed of [undefined, null, {}, "types/probe.js"]) {
    const exceptions = [{ path: "types/z.js", reason: "Vendored source." }];
    assert.deepEqual(evaluateBoundaryInventory({ paths: ["types/z.js", "types/a.js"], parsed, exceptions }),
      { ...cleanInventory, unparsed: ["types/a.js", "types/z.js"] });
  }
});

test("non-array inventory exceptions do not exempt an unparsed source", () => {
  for (const exceptions of [undefined, null, {}, "types/probe.js"]) {
    assert.deepEqual(evaluateBoundaryInventory({ paths: ["types/probe.js"], parsed: [], exceptions }),
      { ...cleanInventory, unparsed: ["types/probe.js"] });
  }
});

test("a leading dot slash in parsed inventory paths normalizes", () => {
  assert.deepEqual(evaluateBoundaryInventory({ paths: ["types/probe.js"], parsed: ["./types/probe.js"], exceptions: [] }), cleanInventory);
});

test("inventory findings are sorted by path", () => {
  const exceptions = ["types/z.js", "types/a.js"].map((path) => ({ path, reason: " " }));
  assert.deepEqual(evaluateBoundaryInventory({ paths: [], parsed: [], exceptions }),
    { ...cleanInventory, staleExceptions: ["types/a.js", "types/z.js"], invalidExceptions: ["types/a.js", "types/z.js"] });
});

test("one exactly matching boundary override passes", () => {
  const overrides = [boundaryOverride(), { files: ["unrelated/*.ts"], rules: { "other/rule": "deny" } }];
  assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }), cleanBoundary);
});

test("a single-rule boundary owner reports the missing sibling rules", () => {
  const overrides = [boundaryOverride({ rules: { [BOUNDARY_RULE]: "error" } })];
  assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, missingRules: BOUNDARY_RULES.filter((rule) => rule !== BOUNDARY_RULE).sort() });
});

test("a sibling rule moved to a second override reports two owners with no missing rules", () => {
  const sibling = "home/no-test-support-imports";
  const overrides = [
    boundaryOverride({ rules: Object.fromEntries(BOUNDARY_RULES.filter((rule) => rule !== sibling).map((rule) => [rule, "error"])) }),
    { files: [`types/**/*.${BOUNDARY_EXTENSIONS_GLOB}`], rules: { [sibling]: "error" } },
  ];
  assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, owners: 2, missingRules: [] });
});

test("a reasoned root-file exclusion passes with its literal dot-slash anchor", () => {
  const excludeFiles = [...BOUNDARY_EXCLUDED_FILES, "./playwright.config.ts"];
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS, exemptRootFiles: ["playwright.config.ts"] }), cleanBoundary);
});

test("a root-file exemption without its exclusion reports the missing exclusion", () => {
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride()], ignorePatterns: BOUNDARY_IGNORE_PATTERNS, exemptRootFiles: ["playwright.config.ts"] }),
    { ...cleanBoundary, missingExclusions: ["./playwright.config.ts"] });
});

test("a root-file exclusion without its exemption reports the unexpected exclusion", () => {
  const excludeFiles = [...BOUNDARY_EXCLUDED_FILES, "./playwright.config.ts"];
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, unexpectedExclusions: ["./playwright.config.ts"] });
});

test("an unescaped root-file glob exclusion without an exemption is unexpected", () => {
  const excludeFiles = [...BOUNDARY_EXCLUDED_FILES, "./verify[1].ts"];
  const { exemptRootFiles } = evaluateBoundaryExemptions({ directories: [], rootFiles: ["verify[1].ts", "verify1.ts"], exemptions: [] });
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS, exemptRootFiles }),
    { ...cleanBoundary, unexpectedExclusions: ["./verify[1].ts"] });
});

test("an added production exclusion reports the unexpected exclusion", () => {
  const excludeFiles = [...BOUNDARY_EXCLUDED_FILES, "types/**/*.js"];
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, unexpectedExclusions: ["types/**/*.js"] });
});

test("a missing canonical exclusion reports the missing exclusion", () => {
  const excludeFiles = BOUNDARY_EXCLUDED_FILES.filter((pattern) => pattern !== "**/tests/**");
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, missingExclusions: ["**/tests/**"] });
});

test("an added ignore pattern reports the unexpected ignore", () => {
  const ignorePatterns = [...BOUNDARY_IGNORE_PATTERNS, "./types/**/*.js"];
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride()], ignorePatterns }),
    { ...cleanBoundary, unexpectedIgnores: ["types/**/*.js"] });
});

test("a missing canonical ignore reports the missing ignore", () => {
  const ignorePatterns = BOUNDARY_IGNORE_PATTERNS.filter((pattern) => pattern !== "build/**");
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride()], ignorePatterns }),
    { ...cleanBoundary, missingIgnores: ["build/**"] });
});

test("non-array ignore patterns fail closed with every canonical ignore missing", () => {
  for (const ignorePatterns of [undefined, null, {}, "ignorePatterns"]) {
    assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride()], ignorePatterns }),
      { ...cleanBoundary, missingIgnores: [...BOUNDARY_IGNORE_PATTERNS].sort() });
  }
});

test("disabled boundary rules remain visible in severities", () => {
  for (const severity of ["off", "allow"]) {
    assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ rules: { [BOUNDARY_RULE]: severity } })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
      { ...cleanBoundary, severities: [severity], unenforcedRules: [BOUNDARY_RULE], missingRules: BOUNDARY_RULES.filter((rule) => rule !== BOUNDARY_RULE).sort() });
  }
});

test("every boundary rule must keep an enforcing severity", () => {
  for (const rule of BOUNDARY_RULES) {
    for (const severity of ["off", "allow", 0, ["off"], "unknown"]) {
      const rules = Object.fromEntries(BOUNDARY_RULES.map((name) => [name, name === rule ? severity : "deny"]));
      const result = evaluateBoundaryConfig({ overrides: [boundaryOverride({ rules })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS });
      assert.deepEqual(result.unenforcedRules, [rule]);
      assert.deepEqual(result.missingRules, []);
    }
  }
  for (const severity of ["error", "warn", 1, 2, ["error", {}]]) {
    const rules = Object.fromEntries(BOUNDARY_RULES.map((name) => [name, severity]));
    assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ rules })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }).unenforcedRules, []);
  }
});

test("a second masking override reports both owners and sorted severities", () => {
  const overrides = [boundaryOverride(), boundaryOverride({ rules: { [BOUNDARY_RULE]: "allow" } })];
  assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }), { ...cleanBoundary, owners: 2, severities: ["allow", "error"], unenforcedRules: [BOUNDARY_RULE] });
});

test("canonical files split across two overrides still report two owners", () => {
  const files = expectedBoundaryFiles();
  const overrides = [boundaryOverride({ files: files.slice(0, 4) }), boundaryOverride({ files: files.slice(4) })];
  assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }), { ...cleanBoundary, owners: 2, severities: ["error", "error"] });
});

test("a narrowed types boundary reports the missing and unexpected patterns", () => {
  const original = `types/**/*.${BOUNDARY_EXTENSIONS_GLOB}`;
  const files = expectedBoundaryFiles().map((pattern) => pattern === original ? "types/*.ts" : pattern);
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ files })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, missing: [original], unexpected: ["types/*.ts"] });
});

test("an extra named root boundary reports raw and oxlint-normalized unexpected patterns", () => {
  for (const extra of [`proxy.${BOUNDARY_EXTENSIONS_GLOB}`, `**/proxy.${BOUNDARY_EXTENSIONS_GLOB}`]) {
    const files = [...expectedBoundaryFiles(), extra];
    assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ files })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
      { ...cleanBoundary, unexpected: [extra] });
  }
});

test("nested patterns and ignores normalize while root patterns keep their literal anchors", () => {
  const files = expectedBoundaryFiles().map((pattern) => pattern === ROOT_CATCH_ALL ? pattern : `./${pattern}`);
  const excludeFiles = BOUNDARY_EXCLUDED_FILES.map((pattern) => `./${pattern}`);
  const ignorePatterns = BOUNDARY_IGNORE_PATTERNS.map((pattern) => `./${pattern}`);
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ files, excludeFiles })], ignorePatterns }), cleanBoundary);
});

test("the root catch-all without its literal dot-slash anchor fails the boundary contract", () => {
  const files = expectedBoundaryFiles().map((pattern) => pattern === ROOT_CATCH_ALL ? ROOT_CATCH_ALL.slice(2) : pattern);
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ files })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, missing: [ROOT_CATCH_ALL], unexpected: [ROOT_CATCH_ALL.slice(2)] });
});

test("a double-anchored root catch-all fails the boundary contract", () => {
  const files = expectedBoundaryFiles().map((pattern) => pattern === ROOT_CATCH_ALL ? `./${ROOT_CATCH_ALL}` : pattern);
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ files })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...cleanBoundary, missing: [ROOT_CATCH_ALL], unexpected: [`./${ROOT_CATCH_ALL}`] });
});

test("a root-file exclusion without its literal dot-slash anchor fails the boundary contract", () => {
  const excludeFiles = [...BOUNDARY_EXCLUDED_FILES, "playwright.config.ts"];
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS, exemptRootFiles: ["playwright.config.ts"] }),
    { ...cleanBoundary, missingExclusions: ["./playwright.config.ts"], unexpectedExclusions: ["playwright.config.ts"] });
});

test("a double-anchored root-file exclusion fails the boundary contract", () => {
  const excludeFiles = [...BOUNDARY_EXCLUDED_FILES, "././playwright.config.ts"];
  assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS, exemptRootFiles: ["playwright.config.ts"] }),
    { ...cleanBoundary, missingExclusions: ["./playwright.config.ts"], unexpectedExclusions: ["././playwright.config.ts"] });
});

test("a config without a matching override reports every boundary pattern and exclusion missing", () => {
  const overrides = [boundaryOverride({ rules: { "other/rule": "deny" } }), null, {}, { rules: null }];
  assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }), missingBoundary);
});

test("non-array overrides fail closed with every boundary pattern and exclusion missing", () => {
  for (const overrides of [undefined, null, {}, "overrides"]) {
    assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }), missingBoundary);
  }
});

test("non-array files fail closed with every boundary pattern missing", () => {
  for (const files of [undefined, null, {}, "files"]) {
    assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ files })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
      { ...cleanBoundary, missing: expectedBoundaryFiles().sort() });
  }
});

test("non-array exclusions fail closed with every canonical exclusion missing", () => {
  for (const excludeFiles of [undefined, null, {}, "excludeFiles"]) {
    assert.deepEqual(evaluateBoundaryConfig({ overrides: [boundaryOverride({ excludeFiles })], ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
      { ...cleanBoundary, missingExclusions: [...BOUNDARY_EXCLUDED_FILES].sort() });
  }
});

test("missing files and exclusions fail closed with every canonical pattern missing", () => {
  const overrides = [{ rules: { [BOUNDARY_RULE]: "deny" } }];
  assert.deepEqual(evaluateBoundaryConfig({ overrides, ignorePatterns: BOUNDARY_IGNORE_PATTERNS }),
    { ...missingBoundary, owners: 1, severities: ["deny"], missingRules: BOUNDARY_RULES.filter((rule) => rule !== BOUNDARY_RULE).sort() });
});

test("a new source directory requires a fence until it has a reasoned exemption", () => {
  const directories = topLevelSourceDirectories(["hooks/use-probe.ts"]);
  assert.deepEqual(evaluateBoundaryExemptions({ directories, exemptions: [] }), { ...clean, requiredFence: ["hooks"] });
  assert.deepEqual(evaluateBoundaryExemptions({ directories, exemptions: [{ path: "hooks", reason: "Non-production verification helpers." }] }),
    { ...clean, exempt: ["hooks"] });
});

test("a removed directory makes its exemption stale", () => {
  assert.deepEqual(evaluateBoundaryExemptions({ directories: [], exemptions: [{ path: "hooks", reason: "Non-production verification helpers." }] }),
    { ...clean, exempt: ["hooks"], stale: ["hooks"] });
});

test("blank and missing reasons are invalid", () => {
  for (const entry of [{ path: "hooks", reason: " " }, { path: "hooks" }]) {
    assert.deepEqual(evaluateBoundaryExemptions({ directories: ["hooks"], exemptions: [entry] }),
      { ...clean, requiredFence: ["hooks"], invalid: ["hooks"] });
  }
});

test("missing and empty paths are invalid", () => {
  for (const entry of [{ reason: "Verification helpers." }, { path: "", reason: "Verification helpers." }, { path: " ", reason: "Verification helpers." }]) {
    assert.deepEqual(evaluateBoundaryExemptions({ directories: [], exemptions: [entry] }), { ...clean, invalid: [""] });
  }
});

test("non-object exemptions are invalid", () => {
  for (const entry of [null, "hooks", 1, []]) {
    assert.deepEqual(evaluateBoundaryExemptions({ directories: [], exemptions: [entry] }), { ...clean, invalid: [""] });
  }
});

test("duplicated paths are invalid", () => {
  const entry = { path: "hooks", reason: "Non-production verification helpers." };
  assert.deepEqual(evaluateBoundaryExemptions({ directories: ["hooks"], exemptions: [entry, entry] }),
    { ...clean, requiredFence: ["hooks"], invalid: ["hooks"] });
});

test("root JS-family entry points are fenced separately from source directories", () => {
  const paths = BOUNDARY_EXTENSIONS.map((extension) => `middleware${extension}`);
  const directories = topLevelSourceDirectories(paths);
  const rootFiles = rootSourceFiles(paths);
  assert.deepEqual(evaluateBoundaryExemptions({ directories, rootFiles, exemptions: [] }), { ...clean, requiredRootFence: rootFiles });
});

test("directories containing only non-lintable files never require a fence", () => {
  const directories = topLevelSourceDirectories(["docs/README.md", "public/image.svg", "assets/theme.css"]);
  assert.deepEqual(evaluateBoundaryExemptions({ directories, exemptions: [] }), clean);
});

test("source directories are unique and sorted across all JS-family extensions", () => {
  const paths = BOUNDARY_EXTENSIONS.map((extension) => `hooks/nested/probe${extension}`);
  assert.deepEqual(topLevelSourceDirectories(["shared/probe.ts", ...paths, "app/probe.ts"]), ["app", "hooks", "shared"]);
});

test("a new root-level source file requires a fence until it has a reasoned exemption", () => {
  const rootFiles = rootSourceFiles(["verify.ts", "verify.ts"]);
  assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles, exemptions: [] }), { ...clean, requiredRootFence: ["verify.ts"] });
  assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles, exemptions: [{ path: "verify.ts", reason: "Verification CLI, not application code." }] }),
    { ...clean, exemptRootFiles: ["verify.ts"] });
});

test("root-file exemptions containing glob metacharacters are invalid and remain fenced", () => {
  for (const path of ["verify[1].ts", ...[..."*?[]{}()!+@|\\"].map((character) => `verify${character}.ts`)]) {
    const entry = { path, reason: "Verification CLI, not application code." };
    assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles: [path], exemptions: [entry] }),
      { ...clean, requiredRootFence: [path], invalid: [path] });
  }
});

test("directory exemptions containing glob metacharacters are invalid and remain fenced", () => {
  for (const path of ["verify[1]", ...[..."*?[]{}()!+@|\\"].map((character) => `verify${character}`)]) {
    const entry = { path, reason: "Non-production verification helpers." };
    assert.deepEqual(evaluateBoundaryExemptions({ directories: [path], exemptions: [entry] }),
      { ...clean, requiredFence: [path], invalid: [path] });
  }
});

test("a removed root-level source file makes its exemption stale", () => {
  assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles: [], exemptions: [{ path: "verify.ts", reason: "Verification CLI, not application code." }] }),
    { ...clean, exemptRootFiles: ["verify.ts"], stale: ["verify.ts"] });
});

test("blank and missing root-file reasons are invalid and do not exempt", () => {
  for (const entry of [{ path: "verify.ts", reason: " " }, { path: "verify.ts" }]) {
    assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles: [entry.path], exemptions: [entry] }),
      { ...clean, requiredRootFence: [entry.path], invalid: [entry.path] });
  }
});

test("duplicated root-file paths are invalid and do not exempt", () => {
  const entry = { path: "verify.ts", reason: "Verification CLI, not application code." };
  assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles: [entry.path], exemptions: [entry, entry, entry] }),
    { ...clean, requiredRootFence: [entry.path], invalid: [entry.path, entry.path] });
});

test("root source files ignore nested paths, non-lintable extensions, and duplicates and sort", () => {
  const paths = BOUNDARY_EXTENSIONS.map((extension) => `verify${extension}`);
  assert.deepEqual(rootSourceFiles(["z.ts", "a.ts", ...paths, "z.ts", "app/root.ts", "./root.ts", "README.md", "theme.css", "archive.ts.map"]),
    ["a.ts", ...paths, "z.ts"].sort());
});

test("canonical root test, story, and test-harness name forms are preclassified", () => {
  const rootFiles = ["verify.test.ts", "verify.test.foo.cts", "verify.stories.tsx", "verify.stories.fixture.ts", "probe-test-harness.ts", "probe-test-harness.foo.mjs", "test-harness.ts", "probe.test-harness.ts"];
  assert.ok(rootFiles.every(isPreclassifiedRootFile));
  assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles: [...rootFiles, rootFiles[0]], exemptions: [] }),
    { ...clean, preclassifiedRootFiles: rootFiles.sort() });
  for (const path of ["contest.ts", "stories.ts", "test-harness-notes.ts", "verify.testish.ts", "verify.stories.foo.ts", "verify.stories.fixture.foo.ts", "a.stories..ts", ".stories", "verify.test.md", "test-harness"]) assert.equal(isPreclassifiedRootFile(path), false);
});

test("root-file exemptions reject globs rather than interpreting them", () => {
  assert.deepEqual(evaluateBoundaryExemptions({ directories: [], rootFiles: ["verify.ts"], exemptions: [{ path: "*.ts", reason: "Verification tooling." }] }),
    { ...clean, requiredRootFence: ["verify.ts"], stale: ["*.ts"], invalid: ["*.ts"] });
});
