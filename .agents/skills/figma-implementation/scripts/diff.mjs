#!/usr/bin/env node
// Quantitative pixel diff between a Figma frame export and a captured story.
// Replaces "the two screenshots look the same".
//
// Usage (from the worktree root):
//   node .agents/skills/figma-implementation/scripts/diff.mjs \
//     --ref /tmp/figma-verify/<task>/row-ref.png \
//     --actual /tmp/figma-verify/<task>/row-actual.png \
//     --out /tmp/figma-verify/<task> [--target 2] [--threshold 0.1] \
//     [--crop x,y,w,h] [--mask x,y,w,h ...] [--spec docs/design/<task>/audit.spec.json]
//
// Outputs `<out>/diff.png` (heatmap) and `<out>/diff.json` (numbers). Exit 0 on
// PASS, 1 on FAIL, 2 on a bad invocation.
//
// Dependency choice: this script decodes and encodes the PNGs with the headless
// Chromium canvas that Playwright already provides, so the diff itself adds no
// package to the repository. The pixel math lives in `lib/diff-core.mjs` as pure
// functions, is injected into that page as source, and is unit tested in Node.
// `pngjs`/`pixelmatch` exist only transitively through Vitest; depending on a
// transitive package from a committed script would break on any lockfile change.
//
// Platform tolerance (see references/verification.md for the full guidance):
//   * Figma rasterises text with its own renderer; a browser rasterises with the
//     platform font stack (`--font-sans` is `ui-sans-serif, system-ui, …`).
//     Glyph edges therefore differ pixel by pixel even when the design matches.
//   * Only the image-level `--target` absorbs that. `--threshold` stays at 0.1
//     (10% per channel) and is not a per-run tuning knob.
//   * Text-heavy sections: target 2. Chrome-only sections: target 0.5.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { numberArg, parseArgs, parseBox, parseBoxList, stringArg } from "./lib/cli.mjs";
import {
  DEFAULT_THRESHOLD,
  TEXT_TARGET_PERCENT,
  applyMask,
  buildHeatmap,
  classifyPixels,
  cropImage,
  formatSizeDelta,
  pngSize,
  percentOf,
  suggestedSharedCrop,
  verdictFor,
} from "./lib/diff-core.mjs";
import { loadPlaywright } from "./lib/browser.mjs";
import { parseAuditSpec } from "./lib/spec.mjs";

const args = parseArgs(process.argv.slice(2), { repeatable: ["mask"] });
const refPath = stringArg(args, "ref");
const actualPath = stringArg(args, "actual");
if (!refPath || !actualPath) {
  console.error("Required: --ref <png> --actual <png> [--out <dir>]");
  process.exit(2);
}
const outDir = stringArg(args, "out") ?? "/tmp/figma-verify/diff";

let spec = null;
if (stringArg(args, "spec")) {
  spec = parseAuditSpec(readFileSync(stringArg(args, "spec"), "utf8"));
}
const target = numberArg(args, "target") ?? spec?.diff?.target ?? TEXT_TARGET_PERCENT;
const threshold = numberArg(args, "threshold") ?? DEFAULT_THRESHOLD;
const masks = parseBoxList(args.mask ?? spec?.diff?.masks ?? []);
const crop = parseBox(stringArg(args, "crop")) ?? parseBox(spec?.diff?.crop);

const refBytes = readFileSync(refPath);
const actualBytes = readFileSync(actualPath);
const refSize = pngSize(refBytes);
const actualSize = pngSize(actualBytes);

if (!crop && (refSize.width !== actualSize.width || refSize.height !== actualSize.height)) {
  const suggestion = suggestedSharedCrop(refSize, actualSize);
  console.error(
    `DIMENSION MISMATCH ref ${refSize.width}x${refSize.height} vs actual ${actualSize.width}x${actualSize.height} ` +
      `(delta ${formatSizeDelta(actualSize, refSize)}).\n` +
      "Do NOT resample. Re-export the Figma reference at scale=1 (figma-export.mjs) and re-capture at the frame's " +
      "viewport with dpr 1. If the Figma frame is hug-width and the DOM element stretches, diff the shared box " +
      `explicitly: --crop ${suggestion.x},${suggestion.y},${suggestion.width},${suggestion.height}`,
  );
  process.exit(2);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
let result;
try {
  const page = await browser.newPage();
  const program = `
    (async () => {
      const applyMask = ${applyMask.toString()};
      const cropImage = ${cropImage.toString()};
      const classifyPixels = ${classifyPixels.toString()};
      const buildHeatmap = ${buildHeatmap.toString()};
      const decode = async (base64) => {
        const response = await fetch("data:image/png;base64," + base64);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
        return { width: bitmap.width, height: bitmap.height, data: image.data };
      };
      const encode = async (data, width, height) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        context.putImageData(new ImageData(data, width, height), 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.readAsDataURL(blob);
        });
      };
      const ref = await decode(${JSON.stringify(refBytes.toString("base64"))});
      const actual = await decode(${JSON.stringify(actualBytes.toString("base64"))});
      const crop = ${JSON.stringify(crop)};
      const refBounded = crop ? cropImage({ data: ref.data, width: ref.width, height: ref.height, crop }) : ref;
      const actualBounded = crop ? cropImage({ data: actual.data, width: actual.width, height: actual.height, crop }) : actual;
      if (refBounded.width !== actualBounded.width || refBounded.height !== actualBounded.height) {
        throw new Error("The bounded reference and capture dimensions differ.");
      }
      const masked = applyMask({
        ref: refBounded.data,
        actual: actualBounded.data,
        width: refBounded.width,
        height: refBounded.height,
        masks: ${JSON.stringify(masks)},
      });
      const classified = classifyPixels({
        ref: masked.ref,
        actual: masked.actual,
        width: refBounded.width,
        height: refBounded.height,
        threshold: ${JSON.stringify(threshold)},
      });
      const heatmap = buildHeatmap({
        ref: masked.ref,
        classes: classified.classes,
        width: refBounded.width,
        height: refBounded.height,
      });
      const heatmapPng = await encode(heatmap, refBounded.width, refBounded.height);
      return {
        width: refBounded.width,
        height: refBounded.height,
        diffPixels: classified.diffPixels,
        softPixels: classified.softPixels,
        totalPixels: classified.totalPixels,
        heatmapPng,
      };
    })()
  `;
  result = await page.evaluate(program);
} finally {
  await browser.close();
}

const pct = percentOf(result.diffPixels, result.totalPixels);
const verdict = verdictFor(pct, target);

mkdirSync(dirname(`${outDir}/diff.png`), { recursive: true });
writeFileSync(`${outDir}/diff.png`, Buffer.from(result.heatmapPng, "base64"));
const diff = {
  ref: refPath,
  actual: actualPath,
  refSize,
  actualSize,
  width: result.width,
  height: result.height,
  crop: crop ?? null,
  masks,
  threshold,
  target,
  diffPixels: result.diffPixels,
  softPixels: result.softPixels,
  totalPixels: result.totalPixels,
  pct,
  pass: verdict.pass,
  heatmap: `${outDir}/diff.png`,
  legend: "red = counted difference, yellow = inside the per-pixel threshold, gray = reference luma at 40%",
  generatedAt: new Date().toISOString(),
};
writeFileSync(`${outDir}/diff.json`, `${JSON.stringify(diff, null, 2)}\n`);

console.log(
  `PCT ${pct} PIXELS ${result.diffPixels}/${result.totalPixels} SOFT ${result.softPixels} ` +
    `${verdict.pass ? "PASS" : "FAIL"} (target ${target}%, threshold ${threshold})`,
);
console.log("HEATMAP", diff.heatmap);
process.exit(verdict.pass ? 0 : 1);
