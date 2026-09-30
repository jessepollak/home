import { lstatSync } from "node:fs";

export const FENCED_LAYERS = ["app", "client", "components", "config", "lib", "server", "shared", "types"];
export const BOUNDARY_RULE = "home/no-exploration-imports";
export const BOUNDARY_RULES = [BOUNDARY_RULE, "home/no-test-support-imports", "home/no-full-portfolio-presentation"];
const ENFORCING_SEVERITIES = new Set(["deny", "error", "warn", 1, 2]);
export const BOUNDARY_EXTENSIONS_GLOB = "{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
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

export function expectedBoundaryFiles() {
  return [...FENCED_LAYERS.map((layer) => `${layer}/**/*.${BOUNDARY_EXTENSIONS_GLOB}`), `*.${BOUNDARY_EXTENSIONS_GLOB}`];
}

export function evaluateBoundaryConfig({ overrides, ignorePatterns, exemptRootFiles = [] }) {
  const patterns = new Set();
  const exclusions = new Set();
  const severities = [];
  const declaredRules = new Set();
  const unenforcedRules = new Set();
  let owners = 0;
  const normalize = (pattern) => pattern.replace(/^\.\//, "");
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
      patterns.add(normalize(pattern));
    }
    for (const pattern of Array.isArray(override.excludeFiles) ? override.excludeFiles : []) {
      exclusions.add(normalize(pattern));
    }
  }
  const expected = new Set(expectedBoundaryFiles().map(normalize));
  const expectedExclusions = new Set([...BOUNDARY_EXCLUDED_FILES, ...exemptRootFiles.map((file) => `./${file}`)].map(normalize));
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
export function evaluateBoundaryExemptions({ directories, rootFiles = [], exemptions }) {
  const seen = new Set();
  const exempt = new Set();
  const exemptRootFiles = new Set();
  const preclassifiedRootFiles = [...new Set(rootFiles.filter(isPreclassifiedRootFile))].sort();
  const preclassified = new Set(preclassifiedRootFiles);
  const stale = [];
  const invalid = [];
  for (const entry of exemptions) {
    const object = entry !== null && typeof entry === "object" && !Array.isArray(entry);
    const path = object && typeof entry.path === "string" && entry.path.trim() ? entry.path : "";
    if (!path || /[*?[\]{}()!+@|\\]/.test(path) || typeof entry.reason !== "string" || !entry.reason.trim() || seen.has(path)) {
      invalid.push(path);
      exempt.delete(path);
      exemptRootFiles.delete(path);
    } else if (directories.includes(path)) exempt.add(path);
    else if (isRootSourcePath(path)) exemptRootFiles.add(path);
    else exempt.add(path);
    if (path && !directories.includes(path) && !rootFiles.includes(path)) stale.push(path);
    if (path) seen.add(path);
  }
  return {
    requiredFence: [...new Set(directories)].filter((path) => !exempt.has(path)).sort(),
    requiredRootFence: [...new Set(rootFiles)].filter((path) => !exemptRootFiles.has(path) && !preclassified.has(path)).sort(),
    exempt: [...exempt].sort(),
    exemptRootFiles: [...exemptRootFiles].sort(),
    preclassifiedRootFiles,
    stale: [...new Set(stale)].sort(),
    invalid: invalid.sort(),
  };
}
