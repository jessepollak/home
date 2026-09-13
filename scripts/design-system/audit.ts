import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

type Metric =
  | "rawButtons"
  | "sharedButtons"
  | "rawHeadings"
  | "sharedHeadings"
  | "rawProse"
  | "sharedProse"
  | "homeUiImports"
  | "colorLiterals"
  | "radiusLiterals";

type Counts = Record<Metric, number>;

type Baseline = {
  maximums: Pick<Counts, "rawButtons" | "colorLiterals" | "radiusLiterals">;
  // Raw headings and prose are informational since #347: headings are `<h1>`–`<h6>`
  // with utilities by design, and `Text` is being deleted. ESLint still bans raw
  // buttons/inputs/selects outside components/ui.
  informational: Pick<Counts, "rawHeadings" | "rawProse" | "sharedButtons" | "sharedHeadings" | "sharedProse" | "homeUiImports">;
};

const repoRoot = resolve(import.meta.dir, "../..");
const webRoot = resolve(repoRoot, "apps/web");
const baselinePath = resolve(import.meta.dir, "baseline.json");
const sourceRoots = ["client", "components", "app"];

// These files own intentional visual palettes. Asset marks are rendered in
// currency-mark.tsx, while the chart series is defined in price-chart.tsx;
// neither is a CSS literal in this scan. Keep this list file-specific.
const artworkCssAllowlist = new Set([
  "client/invest/asset-icon.module.css",
  "client/landing/supported-globe.module.css",
  "components/currency-mark.module.css",
  "components/home-mark.module.css",
]);

const metricOrder: Metric[] = [
  "rawButtons",
  "sharedButtons",
  "rawHeadings",
  "sharedHeadings",
  "rawProse",
  "sharedProse",
  "homeUiImports",
  "colorLiterals",
  "radiusLiterals",
];

const guardedMetrics = [
  "rawButtons",
  "colorLiterals",
  "radiusLiterals",
] as const;

const zeroCounts = (): Counts => ({
  rawButtons: 0,
  sharedButtons: 0,
  rawHeadings: 0,
  sharedHeadings: 0,
  rawProse: 0,
  sharedProse: 0,
  homeUiImports: 0,
  colorLiterals: 0,
  radiusLiterals: 0,
});

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

function countTsx(source: string): Counts {
  const counts = zeroCounts();
  counts.rawButtons = countMatches(source, /<button\b/g);
  counts.sharedButtons = countMatches(source, /<(?:Button|IconButton)\b/g);
  counts.rawHeadings = countMatches(source, /<h[1-4]\b/g);
  counts.sharedHeadings = countMatches(source, /<Heading\b/g);
  counts.rawProse = countMatches(source, /<(?:p|small|strong)\b/g);
  counts.sharedProse = countMatches(source, /<Text\b/g);
  counts.homeUiImports = /from\s+["']@home\/ui(?:\/[^"']*)?["']/.test(source) ? 1 : 0;
  return counts;
}

function countCss(source: string, file: string): Counts {
  const counts = zeroCounts();
  if (artworkCssAllowlist.has(file)) return counts;
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  counts.colorLiterals = countMatches(
    withoutComments,
    /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi,
  );
  counts.radiusLiterals = Array.from(
    withoutComments.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]*)/gi),
  ).filter((match) => /(?:^|\s|:)\d*\.?\d+px\b/i.test(match[1]) && !match[1].includes("var(")).length;
  return counts;
}

function addCounts(target: Counts, source: Counts) {
  for (const metric of metricOrder) target[metric] += source[metric];
}

function displayPath(path: string): string {
  return relative(webRoot, path).split(sep).join("/");
}

const allFiles = (await Promise.all(sourceRoots.map((root) => filesUnder(resolve(webRoot, root))))).flat();
const scanExclusions = ["components/ui/", "app/dev/"];
const isExcluded = (path: string) => scanExclusions.some((prefix) => displayPath(path).startsWith(prefix));
const tsxFiles = allFiles.filter((path) => path.endsWith(".tsx") && !path.includes(".test.") && !path.split(sep).includes("tests") && !isExcluded(path));
const cssFiles = [
  ...allFiles.filter((path) => path.endsWith(".module.css")),
  resolve(webRoot, "app/globals.css"),
];

const byFile = new Map<string, Counts>();
const totals = zeroCounts();

for (const path of tsxFiles) {
  const counts = countTsx(await Bun.file(path).text());
  byFile.set(displayPath(path), counts);
  addCounts(totals, counts);
}
for (const path of cssFiles) {
  const file = displayPath(path);
  const counts = countCss(await Bun.file(path).text(), file);
  const existing = byFile.get(file) ?? zeroCounts();
  addCounts(existing, counts);
  byFile.set(file, existing);
  addCounts(totals, counts);
}

console.log("Design-system adoption audit");
console.log(`Artwork CSS exceptions: ${Array.from(artworkCssAllowlist).sort().join(", ")}`);
console.log(`${"file".padEnd(58)} ${metricOrder.map((metric) => metric.padStart(15)).join(" ")}`);
for (const [file, counts] of Array.from(byFile).sort(([a], [b]) => a.localeCompare(b))) {
  if (metricOrder.every((metric) => counts[metric] === 0)) continue;
  console.log(`${file.padEnd(58)} ${metricOrder.map((metric) => String(counts[metric]).padStart(15)).join(" ")}`);
}
console.log("Totals");
for (const metric of metricOrder) console.log(`  ${metric}: ${totals[metric]}`);

const baseline = await Bun.file(baselinePath).json() as Baseline;
const regressions = guardedMetrics.flatMap((metric) => {
  const maximum = baseline.maximums[metric];
  return totals[metric] > maximum ? [`${metric}: ${totals[metric]} exceeds baseline ${maximum}`] : [];
});

if (regressions.length > 0) {
  console.error("Design-system regression detected:");
  for (const regression of regressions) console.error(`  ${regression}`);
  process.exit(1);
}

console.log("Guarded counts are at or below baseline.");
