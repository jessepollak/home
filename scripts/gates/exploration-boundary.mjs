import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FENCED_LAYERS = ["app", "client", "components", "config", "lib", "server", "shared", "types"];
export const BOUNDARY_RULE = "home/no-exploration-imports";
export const BOUNDARY_RULES = [BOUNDARY_RULE, "home/no-test-support-imports", "home/no-full-portfolio-presentation"];
export const ENFORCING_SEVERITIES = new Set(["deny", "error", "warn", 1, 2]);
export const BOUNDARY_EXTENSIONS_GLOB = "{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
export const ROOT_CATCH_ALL = `./*.${BOUNDARY_EXTENSIONS_GLOB}`;
export const BOUNDARY_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
export const BOUNDARY_EXCLUDED_FILES = [
  `**/*.stories.${BOUNDARY_EXTENSIONS_GLOB}`,
  `**/*.test.${BOUNDARY_EXTENSIONS_GLOB}`,
  `**/*.test.*.${BOUNDARY_EXTENSIONS_GLOB}`,
  "**/tests/**",
  "**/testing/**",
  "**/explorations/**",
  `**/*.stories.fixture.${BOUNDARY_EXTENSIONS_GLOB}`,
  `**/*test-harness.${BOUNDARY_EXTENSIONS_GLOB}`,
  `**/*test-harness.*.${BOUNDARY_EXTENSIONS_GLOB}`,
];
export const BOUNDARY_IGNORE_PATTERNS = [
  "node_modules/**",
  ".next/**",
  "out/**",
  "build/**",
  "storybook-static/**",
  ".storybook/static/mockServiceWorker.js",
  "next-env.d.ts",
];
export const BOUNDARY_INVENTORY_EXCEPTIONS = [{ path: ".storybook/static/mockServiceWorker.js", reason: "Vendored MSW service worker copied verbatim from the package; the canonical ignore list keeps it out of lint." }];

export function existingBoundaryPaths(paths, stat = lstatSync) {
  return paths.filter((path) => {
    try {
      stat(path);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  });
}

export const EXEMPTIONS_PATH = "scripts/gates/exploration-boundary-exemptions.json";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function git(args) {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

// The base revision's source directories and reviewed entries decide whether an
// exemption that no longer covers any source was emptied by merged removals or
// is being reactivated by a change that never reviewed it.
export function readBoundaryBase(baseRef = "main", gitRunner = git) {
  if (baseRef.startsWith("-")) throw new Error(`Invalid base ref: ${baseRef}`);
  const base = /^[0-9a-f]{40}$/iu.test(baseRef) ? baseRef : `origin/${baseRef}`;
  let directories;
  let exemptions = [];
  try {
    const prefix = "apps/web/";
    const paths = gitRunner(["ls-tree", "-r", "-z", "--name-only", base, "--", "apps/web"]).split("\0")
      .filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
    directories = topLevelSourceDirectories(paths);
    if (gitRunner(["ls-tree", "--name-only", base, "--", EXEMPTIONS_PATH]).trim()) exemptions = JSON.parse(gitRunner(["show", `${base}:${EXEMPTIONS_PATH}`]));
  } catch (error) {
    throw new Error(`Could not read the exploration boundary baseline at ${base}: ${error.message}`);
  }
  if (!Array.isArray(exemptions)) throw new Error(`${EXEMPTIONS_PATH} at ${base} is invalid: expected an array`);
  return { base, directories, exemptions };
}

export function readBoundaryInput() {
  const prefix = "apps/web/";
  const paths = existingBoundaryPaths(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"]).split("\0")
    .filter(Boolean).map((entry) => path.join(repositoryRoot, entry)))
    .map((entry) => path.relative(repositoryRoot, entry).split(path.sep).join("/"))
    .filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
  return {
    directories: topLevelSourceDirectories(paths),
    rootFiles: rootSourceFiles(paths),
    exemptions: JSON.parse(readFileSync(path.join(repositoryRoot, EXEMPTIONS_PATH), "utf8")),
  };
}

export function expectedBoundaryFiles() {
  return [...FENCED_LAYERS.map((layer) => `${layer}/**/*.${BOUNDARY_EXTENSIONS_GLOB}`), ROOT_CATCH_ALL];
}

export function evaluateBoundaryConfig({ overrides, ignorePatterns, exemptRootFiles = [] }) {
  const patterns = new Set();
  const exclusions = new Set();
  const severities = [];
  const declaredRules = new Set();
  const unenforcedRules = new Set();
  let owners = 0;
  const normalize = (pattern) => pattern.replace(/^\.\//, "");
  const normalizeBoundaryPattern = (pattern) => {
    const remainder = pattern.replace(/^\.\//, "");
    return remainder.includes("/") && !remainder.startsWith("./") ? remainder : pattern;
  };
  for (const override of Array.isArray(overrides) ? overrides : []) {
    if (override?.rules === null || typeof override?.rules !== "object" || !BOUNDARY_RULES.some((rule) => Object.hasOwn(override.rules, rule))) continue;
    owners += 1;
    for (const rule of BOUNDARY_RULES) {
      if (!Object.hasOwn(override.rules, rule)) continue;
      declaredRules.add(rule);
      const setting = override.rules[rule];
      if (!ENFORCING_SEVERITIES.has(Array.isArray(setting) ? setting[0] : setting)) unenforcedRules.add(rule);
    }
    if (Object.hasOwn(override.rules, BOUNDARY_RULE)) severities.push(override.rules[BOUNDARY_RULE]);
    for (const pattern of Array.isArray(override.files) ? override.files : []) {
      patterns.add(normalizeBoundaryPattern(pattern));
    }
    for (const pattern of Array.isArray(override.excludeFiles) ? override.excludeFiles : []) {
      exclusions.add(normalizeBoundaryPattern(pattern));
    }
  }
  const expected = new Set(expectedBoundaryFiles().map(normalizeBoundaryPattern));
  const expectedExclusions = new Set([...BOUNDARY_EXCLUDED_FILES, ...exemptRootFiles.map((file) => `./${file}`)].map(normalizeBoundaryPattern));
  const ignores = new Set((Array.isArray(ignorePatterns) ? ignorePatterns : []).map(normalize));
  const expectedIgnores = new Set(BOUNDARY_IGNORE_PATTERNS.map(normalize));
  return {
    owners,
    severities: severities.sort(),
    missingRules: BOUNDARY_RULES.filter((rule) => !declaredRules.has(rule)).sort(),
    unenforcedRules: [...unenforcedRules].sort(),
    missing: [...expected].filter((pattern) => !patterns.has(pattern)).sort(),
    unexpected: [...patterns].filter((pattern) => !expected.has(pattern)).sort(),
    missingExclusions: [...expectedExclusions].filter((pattern) => !exclusions.has(pattern)).sort(),
    unexpectedExclusions: [...exclusions].filter((pattern) => !expectedExclusions.has(pattern)).sort(),
    missingIgnores: [...expectedIgnores].filter((pattern) => !ignores.has(pattern)).sort(),
    unexpectedIgnores: [...ignores].filter((pattern) => !expectedIgnores.has(pattern)).sort(),
  };
}

export function evaluateBoundaryInventory({ paths, parsed, exceptions }) {
  const parsedPaths = new Set((Array.isArray(parsed) ? parsed : [])
    .filter((path) => typeof path === "string").map((path) => path.replace(/^\.\//, "")));
  const seen = new Set();
  const exempt = new Set();
  const staleExceptions = [];
  const invalidExceptions = [];
  for (const entry of Array.isArray(exceptions) ? exceptions : []) {
    const object = entry !== null && typeof entry === "object" && !Array.isArray(entry);
    const path = object && typeof entry.path === "string" && entry.path.trim() ? entry.path : "";
    if (!path || typeof entry.reason !== "string" || !entry.reason.trim() || seen.has(path)) invalidExceptions.push(path);
    else exempt.add(path);
    if (path && (parsedPaths.has(path) || !paths.includes(path))) staleExceptions.push(path);
    if (path) seen.add(path);
  }
  return {
    unparsed: paths.filter((path) => !Array.isArray(parsed) || (!parsedPaths.has(path) && !exempt.has(path))).sort(),
    staleExceptions: staleExceptions.sort(),
    invalidExceptions: invalidExceptions.sort(),
  };
}

export function topLevelSourceDirectories(paths) {
  return [...new Set(paths.filter((path) => path.includes("/") && BOUNDARY_EXTENSIONS.some((extension) => path.endsWith(extension)))
    .map((path) => path.split("/")[0]))].sort();
}

export function isRootSourcePath(path) {
  return !path.includes("/") && BOUNDARY_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function rootSourceFiles(paths) {
  return [...new Set(paths.filter(isRootSourcePath))].sort();
}

// The canonical exclusions classify root *.test, *.test.*, *.stories, *.stories.fixture,
// *test-harness, and *test-harness.* stems with a lintable extension, so those modules need
// no separate exemption. The Oxlint mirror contract proves the exclusions hold.
export function isPreclassifiedRootFile(path) {
  const extension = [...BOUNDARY_EXTENSIONS].sort((a, b) => b.length - a.length).find((extension) => path.endsWith(extension));
  if (!extension) return false;
  const stem = path.slice(0, -extension.length);
  return stem.endsWith(".test") || stem.endsWith(".stories") || stem.endsWith(".stories.fixture")
    || stem.endsWith("test-harness") || stem.includes(".test.") || stem.includes("test-harness.");
}

// Exemptions name literal paths; glob metacharacters would change Oxlint exclusion coverage.
// A directory entry spans every source file under it, so two merged removals can leave it
// covering nothing. With a base revision such an entry is a non-failing note while the base
// carried the same reviewed entry, and an entry the base carried while its directory had no
// source is reactivated only by a change that rewrites the entry's reason. Without a base
// revision an entry that covers nothing is stale.
export function evaluateBoundaryExemptions({ directories, rootFiles = [], exemptions, base = null }) {
  const seen = new Set();
  const exempt = new Set();
  const exemptRootFiles = new Set();
  const preclassifiedRootFiles = [...new Set(rootFiles.filter(isPreclassifiedRootFile))].sort();
  const preclassified = new Set(preclassifiedRootFiles);
  const stale = [];
  const dormant = [];
  const reactivated = [];
  const invalid = [];
  const baseDirectories = base ? new Set(base.directories) : null;
  const baseReasons = new Map((Array.isArray(base?.exemptions) ? base.exemptions : [])
    .filter((entry) => entry !== null && typeof entry === "object" && typeof entry.path === "string" && typeof entry.reason === "string")
    .map((entry) => [entry.path, entry.reason]));
  for (const entry of exemptions) {
    const object = entry !== null && typeof entry === "object" && !Array.isArray(entry);
    const path = object && typeof entry.path === "string" && entry.path.trim() ? entry.path : "";
    let directoryEntry = false;
    if (!path || /[*?[\]{}()!+@|\\]/.test(path) || typeof entry.reason !== "string" || !entry.reason.trim() || seen.has(path)) {
      invalid.push(path);
      exempt.delete(path);
      exemptRootFiles.delete(path);
    } else if (directories.includes(path)) {
      exempt.add(path);
      directoryEntry = true;
    } else if (isRootSourcePath(path)) exemptRootFiles.add(path);
    else {
      exempt.add(path);
      directoryEntry = true;
    }
    if (path && !directories.includes(path) && !rootFiles.includes(path)) {
      if (directoryEntry && baseDirectories && baseReasons.get(path) === entry.reason) dormant.push(path);
      else stale.push(path);
    } else if (directoryEntry && baseDirectories && !baseDirectories.has(path) && baseReasons.get(path) === entry.reason) reactivated.push(path);
    if (path) seen.add(path);
  }
  return {
    requiredFence: [...new Set(directories)].filter((path) => !exempt.has(path)).sort(),
    requiredRootFence: [...new Set(rootFiles)].filter((path) => !exemptRootFiles.has(path) && !preclassified.has(path)).sort(),
    exempt: [...exempt].sort(),
    exemptRootFiles: [...exemptRootFiles].sort(),
    preclassifiedRootFiles,
    stale: [...new Set(stale)].sort(),
    dormant: [...new Set(dormant)].sort(),
    reactivated: [...new Set(reactivated)].sort(),
    invalid: invalid.sort(),
  };
}
