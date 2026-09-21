#!/usr/bin/env node
// Deterministic capture of a Storybook story element, for pixel diffing against
// a Figma frame export.
//
// Usage (from the worktree root):
//   node .agents/skills/figma-implementation/scripts/capture.mjs \
//     --spec docs/design/<task>/audit.spec.json \
//     [--base http://127.0.0.1:6006] [--story <id>] [--url <canvas-url>] \
//     [--viewport 390x844] [--selector "<css>"] [--box border|content] \
//     [--crop x,y,w,h] --out /tmp/figma-verify/<task>/actual.png [--report <json>] \
//     [--dark] [--color-scheme dark] [--ls key=value ...] [--hover "<css>" ...] \
//     [--wait-text "..."] [--fonts "SF Pro Text"] [--font-check] [--settle 1200]
//
// Rules that keep a capture diffable:
//   * viewport = the Figma frame's W×H (or the story's review viewport) and dpr 1,
//     so one CSS pixel is one image pixel;
//   * the element's own box is shot (never the padded wrapper), with `--box content`
//     when the Figma frame corresponds to the element's content box;
//   * animations, transitions, scrollbars and the caret are disabled, the clock is
//     frozen, and the mouse is parked at 0,0 before the shot.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { boolArg, numberArg, parseArgs, parseBox, parseViewport, stringArg } from "./lib/cli.mjs";
import { openStory, resolvedFonts, STORYBOOK_DEFAULT_BASE } from "./lib/browser.mjs";
import { collectMeasurements } from "./lib/inspect.mjs";
import { pngSize } from "./lib/diff-core.mjs";
import { frameComparison, parseAuditSpec, storyCanvasUrl } from "./lib/spec.mjs";
import { resolveRepoRoot } from "./lib/repo.mjs";

const args = parseArgs(process.argv.slice(2), { repeatable: ["ls", "hover"] });
const specPath = stringArg(args, "spec");
const spec = specPath ? parseAuditSpec(readFileSync(resolve(resolveRepoRoot(), specPath), "utf8")) : null;

const selector = stringArg(args, "selector") ?? spec?.capture?.selector ?? spec?.frameSelector;
if (!selector) {
  console.error("Required: --selector <css> (or a spec with frameSelector/capture.selector).");
  process.exit(2);
}
const out = stringArg(args, "out");
if (!out) {
  console.error("Required: --out <png>");
  process.exit(2);
}

const url =
  stringArg(args, "url") ??
  (spec
    ? typeof spec.url === "string"
      ? spec.url
      : storyCanvasUrl({
          base: stringArg(args, "base") ?? STORYBOOK_DEFAULT_BASE,
          story: stringArg(args, "story") ?? spec.story,
        })
    : storyCanvasUrl({
        base: stringArg(args, "base") ?? STORYBOOK_DEFAULT_BASE,
        story: stringArg(args, "story"),
      }));

const viewport =
  parseViewport(stringArg(args, "viewport")) ??
  (spec?.viewport ? parseViewport(spec.viewport) : null) ??
  (spec?.frame?.width && spec?.frame?.height
    ? { width: spec.frame.width, height: spec.frame.height }
    : { width: 390, height: 844 });

const boxMode = stringArg(args, "box") ?? spec?.capture?.box ?? "border";
if (!["border", "padding", "content"].includes(boxMode)) {
  console.error(`--box must be border|padding|content, got: ${boxMode}`);
  process.exit(2);
}
// `--crop none` overrides a spec crop (matrix captures want the whole element box).
const cropArg = stringArg(args, "crop");
const crop = cropArg === "none" ? null : parseBox(cropArg) ?? parseBox(spec?.capture?.crop);

const { browser, page } = await openStory({
  url,
  viewport,
  dpr: 1,
  colorScheme: stringArg(args, "color-scheme") ?? (boolArg(args, "dark") ? "dark" : "light"),
  dark: boolArg(args, "dark"),
  localStorage: (args.ls ?? []).map(String),
  hover: (args.hover ?? []).map(String),
  waitText: stringArg(args, "wait-text"),
  fonts: stringArg(args, "fonts")?.split(",").map((font) => font.trim()).filter(Boolean) ?? [],
  fontCheck: boolArg(args, "font-check"),
  settleMs: numberArg(args, "settle") ?? 1200,
});

const warnings = [];
let image;
let elementBox;
let clipBox;
let measurements = null;
let fonts = [];
try {
  const element = page.locator(selector).first();
  await element.waitFor({ state: "visible", timeout: 15000 });
  await element.scrollIntoViewIfNeeded();
  const geometry = await element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const px = (value) => Number.parseFloat(value) || 0;
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
      border: {
        left: px(style.borderLeftWidth),
        top: px(style.borderTopWidth),
        right: px(style.borderRightWidth),
        bottom: px(style.borderBottomWidth),
      },
      padding: {
        left: px(style.paddingLeft),
        top: px(style.paddingTop),
        right: px(style.paddingRight),
        bottom: px(style.paddingBottom),
      },
    };
  });

  // box: border = the element's border box; padding = border box minus border
  // (the box a Figma auto-layout frame corresponds to); content = inside the
  // element's own padding.
  const inset = boxMode === "content"
    ? {
        left: geometry.border.left + geometry.padding.left,
        top: geometry.border.top + geometry.padding.top,
        right: geometry.border.right + geometry.padding.right,
        bottom: geometry.border.bottom + geometry.padding.bottom,
      }
    : boxMode === "padding"
      ? {
          left: geometry.border.left,
          top: geometry.border.top,
          right: geometry.border.right,
          bottom: geometry.border.bottom,
        }
      : { left: 0, top: 0, right: 0, bottom: 0 };

  clipBox = {
    x: geometry.x + inset.left + (crop?.x ?? 0),
    y: geometry.y + inset.top + (crop?.y ?? 0),
    width: crop?.width ?? Math.max(1, geometry.width - inset.left - inset.right),
    height: crop?.height ?? Math.max(1, geometry.height - inset.top - inset.bottom),
  };
  elementBox = {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    box: boxMode,
  };

  mkdirSync(dirname(out), { recursive: true });
  // page.screenshot clip uses document coordinates; verify the result below.
  await page.screenshot({ path: out, clip: clipBox });
  const size = pngSize(readFileSync(out));
  if (size.width !== Math.round(clipBox.width) || size.height !== Math.round(clipBox.height)) {
    warnings.push(
      `PNG is ${size.width}x${size.height} but the clip asked for ${Math.round(clipBox.width)}x${Math.round(clipBox.height)} — ` +
        "check --viewport/--crop; the capture is not 1:1 with CSS pixels.",
    );
  }
  image = { width: size.width, height: size.height, path: out };

  if (spec) {
    measurements = await page.evaluate(
      `(${collectMeasurements.toString()})(${JSON.stringify(spec.frameSelector ?? null)}, ${JSON.stringify(
        spec.frameBox ?? "border",
      )}, ${JSON.stringify(spec.elements)})`,
    );
    fonts = await resolvedFonts(page, spec.elements.map((element) => element.selector));
  }
} finally {
  await browser.close();
}

const frame = spec ? frameComparison(spec, measurements?.frame ?? null) : null;
if (frame?.expected && frame?.actual && frame.delta && (frame.delta.width !== 0 || frame.delta.height !== 0)) {
  warnings.push(
    `frame ${frame.expected.width}x${frame.expected.height} vs mapped ${frame.keys.width}=${frame.actual.width} ` +
      `${frame.keys.height}=${frame.actual.height} (delta ${frame.delta.width}x${frame.delta.height}) — ` +
      "a hug-width Figma frame against a stretch-width element; pass --crop or diff the shared box (references/verification.md).",
  );
}
const overflow = (measurements?.elements ?? []).filter((entry) => entry.overflowsHorizontally)
  .map((entry) => entry.name);

const report = {
  url,
  story: spec?.story ?? stringArg(args, "story") ?? null,
  selector,
  box: boxMode,
  viewport: `${viewport.width}x${viewport.height}`,
  dpr: 1,
  colorScheme: stringArg(args, "color-scheme") ?? (boolArg(args, "dark") ? "dark" : "light"),
  element: elementBox,
  clip: clipBox,
  crop: crop ?? null,
  image,
  frame,
  overflow,
  fonts,
  measurements: measurements?.elements ?? null,
  warnings,
  generatedAt: new Date().toISOString(),
};

const reportPath = stringArg(args, "report");
if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(`BOX ${image.width}x${image.height} ${out}`);
for (const warning of warnings) console.log(`WARN ${warning}`);
console.log("CAPTURE", out);
if (reportPath) console.log("REPORT", reportPath);
