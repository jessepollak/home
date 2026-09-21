#!/usr/bin/env node
// DOM measurement gate — run this BEFORE any pixel diff.
//
// It executes the audited property table from `docs/design/<task>/audit.spec.json`
// against the live Storybook canvas and reports named failures such as
// `FAIL label fontSize: expected 16px got 14px`. Exact numbers, no image noise,
// and it catches what pixels cannot attribute (an unknown CVA variant that
// renders zero classes, a Tailwind utility that generated no CSS).
//
// Usage (from the worktree root):
//   bun .agents/skills/figma-implementation/scripts/measure.mjs \
//     --spec docs/design/<task>/audit.spec.json \
//     [--base http://127.0.0.1:6006] [--story <id>] [--url <canvas-url>] \
//     [--viewport 390x844] [--ls key=value ...] [--fonts "SF Pro Text"] [--font-check] \
//     [--settle 1200] [--out /tmp/figma-verify/<task>/measure.json]
//
// Exit code 0 means every audited property matched; 1 means named failures
// (printed, and written to the report); 2 means the invocation itself is wrong.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { boolArg, numberArg, parseArgs, parseViewport, stringArg } from "./lib/cli.mjs";
import { openStory, resolvedFonts, STORYBOOK_DEFAULT_BASE } from "./lib/browser.mjs";
import { collectMeasurements } from "./lib/inspect.mjs";
import { compareAll, parseAuditSpec, storyCanvasUrl } from "./lib/spec.mjs";
import { resolveRepoRoot } from "./lib/repo.mjs";

const DEFAULT_VIEWPORT = { width: 390, height: 844 };

function main(argv) {
  const args = parseArgs(argv, { repeatable: ["ls"] });
  const specPath = stringArg(args, "spec");
  if (!specPath) {
    console.error("Required: --spec <audit.spec.json>");
    process.exit(2);
  }
  const root = resolveRepoRoot();
  const absoluteSpecPath = resolve(root, specPath);
  const spec = parseAuditSpec(readFileSync(absoluteSpecPath, "utf8"));

  const url =
    stringArg(args, "url") ??
    (stringArg(args, "story")
      ? storyCanvasUrl({ base: stringArg(args, "base") ?? STORYBOOK_DEFAULT_BASE, story: stringArg(args, "story") })
      : typeof spec.url === "string"
        ? spec.url
        : storyCanvasUrl({
            base: stringArg(args, "base") ?? STORYBOOK_DEFAULT_BASE,
            story: spec.story,
          }));

  const viewport =
    parseViewport(stringArg(args, "viewport")) ??
    (spec.viewport ? parseViewport(spec.viewport) : null) ??
    DEFAULT_VIEWPORT;

  const out = stringArg(args, "out") ?? join("/tmp/figma-verify", spec.story ?? "story", "measure.json");
  return {
    args,
    specPath: specPath,
    absoluteSpecPath,
    spec,
    url,
    viewport,
    out,
    settleMs: numberArg(args, "settle"),
    fonts: stringArg(args, "fonts")?.split(",").map((font) => font.trim()).filter(Boolean) ?? [],
    fontCheck: boolArg(args, "font-check"),
  };
}

const run = main(process.argv.slice(2));

const { browser, page } = await openStory({
  url: run.url,
  viewport: run.viewport,
  dpr: 1,
  colorScheme: "light",
  dark: boolArg(run.args, "dark"),
  localStorage: (run.args.ls ?? []).map(String),
  fonts: run.fonts,
  fontCheck: run.fontCheck,
  settleMs: run.settleMs ?? 1200,
});

let measurement;
let comparison;
let fonts;
try {
  // Plain string program: the collector is injected as source so the page never
  // needs a bundler transform (which would inject page-unknown helpers).
  measurement = await page.evaluate(
    `(${collectMeasurements.toString()})(${JSON.stringify(run.spec.frameSelector ?? null)}, ${JSON.stringify(
      run.spec.frameBox ?? "border",
    )}, ${JSON.stringify(run.spec.elements)})`,
  );
  fonts = await resolvedFonts(
    page,
    run.spec.elements.map((element) => element.selector),
  );
  comparison = compareAll(run.spec, measurement);
} finally {
  await browser.close();
}

for (const entry of comparison.report) {
  if (entry.pass) {
    console.log(`PASS ${entry.name}`);
    continue;
  }
  for (const failure of entry.failures) {
    console.log(`FAIL ${entry.name} ${failure.prop}: expected ${failure.expected} got ${failure.actual}`);
  }
}

if (comparison.frame.expected && comparison.frame.actual) {
  const { expected, actual, delta, keys } = comparison.frame;
  console.log(
    `FRAME expected ${expected.width}x${expected.height} (node ${run.spec.frame?.nodeId ?? "?"}) ` +
      `mapped ${keys.width}=${actual.width} ${keys.height}=${actual.height} ` +
      `delta ${delta.width}x${delta.height}` +
      (delta.width === 0 && delta.height === 0 ? "" : "  [hug-width frame vs stretch-width element? see audit.md]"),
  );
  if (measurement.frame) {
    console.log(
      `BOXES border ${measurement.frame.borderWidth}x${measurement.frame.borderHeight} ` +
        `padding ${measurement.frame.paddingWidth}x${measurement.frame.paddingHeight} ` +
        `content ${measurement.frame.contentWidth}x${measurement.frame.contentHeight}`,
    );
  }
}
for (const font of fonts) {
  console.log(`FONT ${font.selector} -> ${font.missing ? "NOT FOUND" : `${font.fontFamily} ${font.fontWeight} ${font.fontSize}/${font.lineHeight}`}`);
}

const report = {
  spec: run.specPath,
  url: run.url,
  story: run.spec.story,
  viewport: `${run.viewport.width}x${run.viewport.height}`,
  frame: comparison.frame,
  frameMeasurements: measurement.frame,
  elements: comparison.report,
  measurements: measurement.elements,
  fonts,
  failures: comparison.failures,
  pass: comparison.pass,
  generatedAt: new Date().toISOString(),
};
mkdirSync(dirname(run.out), { recursive: true });
writeFileSync(run.out, `${JSON.stringify(report, null, 2)}\n`);
console.log("REPORT", run.out);
console.log(
  comparison.pass
    ? `MEASURE PASS (${comparison.report.length} elements)`
    : `MEASURE FAIL (${comparison.failures} mismatches across ${comparison.report.length} elements)`,
);

process.exit(comparison.pass ? 0 : 1);
