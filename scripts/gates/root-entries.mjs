import { readFileSync } from "node:fs";

import { BOUNDARY_EXCLUDED_FILES, BOUNDARY_EXTENSIONS, BOUNDARY_EXTENSIONS_GLOB, BOUNDARY_RULES, ENFORCING_SEVERITIES, FENCED_LAYERS, ROOT_CATCH_ALL, isRootSourcePath } from "./exploration-boundary.mjs";

export { ROOT_CATCH_ALL };

export function loadRootEntryExemptions() {
  return JSON.parse(readFileSync(new URL("./exploration-boundary-exemptions.json", import.meta.url), "utf8"))
    .filter((entry) => isRootSourcePath(entry.path)).map(({ path, reason }) => ({ path, reason }));
}

const testSupportExclusions = [
  `**/*.test.${BOUNDARY_EXTENSIONS_GLOB}`,
  "**/tests/**",
  "**/testing/**",
  "**/*test-harness.{ts,tsx}",
  "**/*smoke-fixture*.{ts,tsx}",
  `**/*.stories.${BOUNDARY_EXTENSIONS_GLOB}`,
];

export const PRODUCTION_OVERRIDES = [
  {
    id: "no-storybook-imports",
    rules: ["home/no-storybook-imports"],
    layers: FENCED_LAYERS,
    exclusions: [`**/*.stories.${BOUNDARY_EXTENSIONS_GLOB}`],
  },
  {
    id: "no-silent-catch",
    rules: ["home/no-silent-catch"],
    layers: ["app", "client", "components", "config", "server", "shared"],
    exclusions: testSupportExclusions,
  },
  {
    id: "anti-slop",
    rules: [
      "home/no-chained-type-assertions",
      "home/no-reflect-indirection",
      "home/no-vague-object-parameters",
      "home/no-unknown-aliases",
      "home/no-reducer-accumulator-spread",
      "home/no-reduce-accumulator-copy",
      "home/no-widen-then-assert",
      "home/isolate-instrumentation-calls",
    ],
    layers: FENCED_LAYERS,
    exclusions: testSupportExclusions,
  },
  {
    id: "exploration-boundary",
    rules: BOUNDARY_RULES,
    layers: FENCED_LAYERS,
    exclusions: BOUNDARY_EXCLUDED_FILES,
  },
];

export function rootFencedOverrides(overrides) {
  return (Array.isArray(overrides) ? overrides : []).filter((override) => [...(override?.files ?? []), ...(override?.excludeFiles ?? [])]
    .some((pattern) => typeof pattern === "string" && (pattern.startsWith("./") || !pattern.includes("/"))));
}

export function unclaimedRootOverrides(overrides, claimedRules) {
  return rootFencedOverrides(overrides).filter((override) => !Object.keys(override.rules ?? {}).some((rule) => claimedRules.has(rule)));
}

export function evaluateProductionOverrides({ overrides, rootExemptions }) {
  const result = { missingOwners: [], duplicateOwners: [], missingRules: [], unenforcedRules: [], missing: [], unexpected: [], missingExclusions: [], unexpectedExclusions: [] };
  for (const spec of PRODUCTION_OVERRIDES) {
    const owners = (Array.isArray(overrides) ? overrides : []).filter((override) => override?.rules !== null
      && typeof override?.rules === "object" && spec.rules.some((rule) => Object.hasOwn(override.rules, rule)));
    if (!owners.length) {
      result.missingOwners.push(spec.id);
      continue;
    }
    if (owners.length > 1) {
      result.duplicateOwners.push(spec.id);
      continue;
    }
    const [owner] = owners;
    for (const rule of spec.rules) {
      if (!Object.hasOwn(owner.rules, rule)) {
        result.missingRules.push(`${spec.id}: ${rule}`);
        continue;
      }
      const setting = owner.rules[rule];
      if (!ENFORCING_SEVERITIES.has(Array.isArray(setting) ? setting[0] : setting)) result.unenforcedRules.push(`${spec.id}: ${rule}`);
    }
    const expectedFiles = [...spec.layers.map((layer) => `${layer}/**/*.${BOUNDARY_EXTENSIONS_GLOB}`), ROOT_CATCH_ALL];
    const expectedExclusions = [...spec.exclusions, ...rootExemptions.map(({ path }) => `./${path}`)];
    for (const [field, expected, missing, unexpected] of [
      ["files", expectedFiles, "missing", "unexpected"],
      ["excludeFiles", expectedExclusions, "missingExclusions", "unexpectedExclusions"],
    ]) {
      const canonical = new Set(expected);
      const actual = new Set(Array.isArray(owner[field]) ? owner[field] : []);
      for (const pattern of canonical) if (!actual.has(pattern)) result[missing].push(`${spec.id}: ${pattern}`);
      for (const pattern of actual) if (!canonical.has(pattern)) result[unexpected].push(`${spec.id}: ${pattern}`);
    }
  }
  for (const findings of Object.values(result)) findings.sort();
  return result;
}
