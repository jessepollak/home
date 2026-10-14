import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Scanner } from "@tailwindcss/oxide";
import { scanLibraryCandidates, type CandidateFile } from "../lib/design-system/candidates";
import { elevationUsage, motionUsage, radiusUsage, typeUsage, type Usage } from "../lib/design-system/usage";
import { classifyStyleUtility, styleDriftOccurrences } from "../oxlint/policy/style-drift.mjs";

type Finding = { family: string; token: string; count: number; files: string[] };
const webRoot = resolve(import.meta.dir, "..");
const scope = "app/, client/, components/; excluding components/ui/, tests/, *.test.*, *.stories.*";
const stateVariant = /^(?:hover|active|focus-visible|disabled|aria-pressed|aria-expanded|aria-checked|aria-selected|data-selected|data-highlighted|data-\[state=on\]|aria-disabled)$/;

function productCandidates(scanner: Scanner): CandidateFile[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "app/", "client/", "components/"],
    { cwd: webRoot, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || "Cannot list product sources");
  const paths = [...new Set(result.stdout.toString().split("\0"))].filter((path) =>
    /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(path) && !path.startsWith("components/ui/")
    && !/(?:^|\/)tests\//.test(path) && !/\.(?:test|stories)\.[^.]+$/.test(path)
    && existsSync(resolve(webRoot, path))).sort();
  return scanLibraryCandidates(paths.map((path) => ({ path, source: readFileSync(resolve(webRoot, path), "utf8") })), scanner);
}

function candidateParts(candidate: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "[" || character === "(") depth += 1;
    else if (character === "]" || character === ")") depth -= 1;
    else if (character === ":" && depth === 0) {
      parts.push(candidate.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(candidate.slice(start).replace(/^!|!$/g, ""));
  return parts;
}

function addOccurrence(findings: Map<string, Finding>, family: string, token: string, path: string) {
  const key = `${family} ${token}`;
  const entry = findings.get(key) ?? { family, token, count: 0, files: [] };
  entry.count += 1;
  if (!entry.files.includes(path)) entry.files.push(path);
  findings.set(key, entry);
}

function fromUsage(family: string, token: (step: string) => string, uses: Usage[]): Finding[] {
  return uses.map(({ step, count, files }) => ({ family, token: token(step), count, files }));
}

function offTokenValues(files: CandidateFile[]): Finding[] {
  const type = typeUsage(files);
  const elevation = elevationUsage(files);
  const knownShadows = new Set(elevation.shadows.map(({ step }) => `shadow-${step}`));
  const values = [
    ...fromUsage("radius", (step) => `rounded-${step}`, radiusUsage(files).filter(({ step }) => !["sm", "lg", "xl", "2xl", "full", "none"].includes(step))),
    ...fromUsage("shadow", (step) => `shadow-${step}`, elevation.shadows.filter(({ step }) => !["raised", "floating", "overlay", "toast", "none"].includes(step))),
    ...fromUsage("type", (step) => `text-[${step}]`, type.arbitrarySizes),
    ...fromUsage("type", (step) => `font-${step}`, type.weights.filter(({ step }) => !["normal", "medium", "semibold"].includes(step))),
    ...motionUsage(files).uses.flatMap(({ utility, count, files: paths }) => styleDriftOccurrences(utility)
      .filter(({ family }) => family === "duration" || family === "ease")
      .map(({ family, token }) => ({ family, token, count, files: paths }))),
  ];
  const extra = new Map<string, Finding>();
  for (const { path, candidates } of files) {
    for (const candidate of candidates) {
      const drift = classifyStyleUtility(candidate);
      if (drift?.family === "radius" || (drift?.family === "shadow" && !knownShadows.has(drift.token))) {
        addOccurrence(extra, drift.family, drift.token, path);
      }
      const base = candidateParts(candidate).at(-1)!;
      if (/^(?:leading|tracking)-\[.+\]$/.test(base)) addOccurrence(extra, "type", base, path);
    }
  }
  return [...values, ...extra.values()].sort((left, right) => left.family.localeCompare(right.family)
    || right.count - left.count || left.token.localeCompare(right.token));
}

function stateValues(files: CandidateFile[]): Finding[] {
  const values = new Map<string, Finding>();
  for (const { path, candidates } of files) {
    for (const candidate of candidates) {
      const parts = candidateParts(candidate);
      const base = parts.pop()!;
      if (parts.some((part) => stateVariant.test(part)) && /^(?:bg|text|border|ring|outline|opacity|shadow)-/.test(base)) {
        addOccurrence(values, "state", candidate, path);
      }
    }
  }
  return [...values.values()].sort((left, right) => right.count - left.count || left.token.localeCompare(right.token));
}

function formatFinding({ family, token, count, files }: Finding, limit: number, showFamily = true): string {
  const paths = files.slice(0, limit).join(", ");
  return `  ${showFamily ? `${family} ` : ""}${token}: ${count} — ${paths}${files.length > limit ? ` (+${files.length - limit} files)` : ""}`;
}

async function main() {
  const { Scanner } = await import("@tailwindcss/oxide");
  const files = productCandidates(new Scanner({}));
  const offToken = offTokenValues(files);
  const states = stateValues(files);
  console.log([
    `Design drift: ${files.length} files scanned (${scope})`,
    "Off-token values",
    ...(offToken.length ? offToken.map((finding) => formatFinding(finding, 6)) : ["  None"]),
    "State usage to review",
    ...(states.length ? states.map((finding) => formatFinding(finding, 5, false)) : ["  None"]),
    "Fix path: read docs/design-system/spec.md; fix through owned components/ui variants or the role utility, never per-use classes. home/no-raw-style-utilities enforces shadow/radius/duration/ease; its baseline is shrink-only.",
  ].join("\n"));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`Design drift report unavailable (${scope}): ${error instanceof Error ? error.message : String(error)}`);
  }
}
