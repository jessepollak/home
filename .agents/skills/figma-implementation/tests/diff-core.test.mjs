import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CHROME_TARGET_PERCENT,
  DEFAULT_THRESHOLD,
  TEXT_TARGET_PERCENT,
  applyMask,
  buildHeatmap,
  classifyPixels,
  cropBuffers,
  cropImage,
  formatSizeDelta,
  percentOf,
  pngSize,
  suggestedSharedCrop,
  verdictFor,
} from "../scripts/lib/diff-core.mjs";

/** Build a solid RGBA buffer of `count` pixels. */
function solid(count, [r, g, b, a = 255]) {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

/** Minimal but valid-enough PNG header (signature + IHDR length/type + W/H). */
function pngHeader(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("constants", () => {
  test("threshold and targets match the documented defaults", () => {
    assert.equal(DEFAULT_THRESHOLD, 0.1);
    assert.equal(TEXT_TARGET_PERCENT, 2);
    assert.equal(CHROME_TARGET_PERCENT, 0.5);
  });
});

describe("pngSize", () => {
  test("reads the IHDR dimensions", () => {
    assert.deepEqual(pngSize(pngHeader(326, 56)), { width: 326, height: 56 });
  });

  test("rejects a truncated file and a non-PNG", () => {
    assert.throws(() => pngSize(Buffer.alloc(4)), /truncated/);
    assert.throws(() => pngSize(Buffer.alloc(32)), /signature mismatch/);
  });
});

describe("classifyPixels", () => {
  const options = (ref, actual, width, height, threshold = DEFAULT_THRESHOLD) => ({
    ref,
    actual,
    width,
    height,
    threshold,
  });

  test("identical images have no differences and no soft pixels", () => {
    const ref = solid(4, [255, 255, 255]);
    const result = classifyPixels(options(ref, new Uint8ClampedArray(ref), 2, 2));
    assert.equal(result.diffPixels, 0);
    assert.equal(result.softPixels, 0);
    assert.equal(result.totalPixels, 4);
    assert.deepEqual([...result.classes], [0, 0, 0, 0]);
  });

  test("a difference under the threshold is soft, not counted", () => {
    const ref = solid(1, [10, 10, 10]);
    const actual = solid(1, [23, 23, 23]); // 13/255 = 0.051
    const result = classifyPixels(options(ref, actual, 1, 1));
    assert.equal(result.diffPixels, 0);
    assert.equal(result.softPixels, 1);
    assert.deepEqual([...result.classes], [2]);
  });

  test("a difference over the threshold is counted", () => {
    const ref = solid(1, [255, 255, 255]);
    const actual = solid(1, [0, 0, 0]);
    const result = classifyPixels(options(ref, actual, 1, 1));
    assert.equal(result.diffPixels, 1);
    assert.equal(result.softPixels, 0);
    assert.deepEqual([...result.classes], [1]);
  });

  test("the metric is the max channel difference, so one channel is enough", () => {
    const ref = solid(1, [0, 0, 0]);
    const actual = solid(1, [0, 0, 30]); // only blue moves: 30/255 = 0.118
    assert.equal(classifyPixels(options(ref, actual, 1, 1)).diffPixels, 1);
  });

  test("a strict threshold counts a soft pixel", () => {
    const ref = solid(1, [10, 10, 10]);
    const actual = solid(1, [20, 20, 20]);
    assert.equal(classifyPixels(options(ref, actual, 1, 1, 0.01)).diffPixels, 1);
  });
});

describe("applyMask", () => {
  test("blackens the same rectangle on both images only", () => {
    const ref = solid(4, [255, 255, 255]);
    const actual = solid(4, [0, 0, 0]);
    const masked = applyMask({
      ref,
      actual,
      width: 2,
      height: 2,
      masks: [{ x: 1, y: 1, width: 1, height: 1 }],
    });
    // Pixel 3 (x=1,y=1) becomes black on both; pixel 0 is untouched.
    assert.deepEqual([...masked.ref.slice(12, 16)], [0, 0, 0, 255]);
    assert.deepEqual([...masked.actual.slice(12, 16)], [0, 0, 0, 255]);
    assert.deepEqual([...masked.ref.slice(0, 4)], [255, 255, 255, 255]);
    assert.deepEqual([...actual.slice(12, 16)], [0, 0, 0, 255]);
    const result = classifyPixels({
      ref: masked.ref,
      actual: masked.actual,
      width: 2,
      height: 2,
      threshold: DEFAULT_THRESHOLD,
    });
    assert.equal(result.diffPixels, 3);
  });

  test("clips masks that stick out of the image", () => {
    const ref = solid(1, [255, 255, 255]);
    const masked = applyMask({
      ref,
      actual: new Uint8ClampedArray(ref),
      width: 1,
      height: 1,
      masks: [{ x: -5, y: -5, width: 99, height: 99 }],
    });
    assert.deepEqual([...masked.ref.slice(0, 4)], [0, 0, 0, 255]);
  });
});

describe("cropBuffers", () => {
  test("crops both images to the same sub-rectangle", () => {
    // 2x2 image, one pixel per quadrant colour.
    const ref = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    const cropped = cropBuffers({
      ref,
      actual: new Uint8ClampedArray(ref),
      width: 2,
      height: 2,
      crop: { x: 1, y: 1, width: 1, height: 1 },
    });
    assert.equal(cropped.width, 1);
    assert.equal(cropped.height, 1);
    assert.deepEqual([...cropped.ref.slice(0, 4)], [255, 255, 255, 255]);
  });

  test("crops different source widths with each image's own row stride", () => {
    const ref = solid(6, [255, 0, 0]);
    const actual = new Uint8ClampedArray([
      0, 0, 0, 255, 10, 0, 0, 255,
      20, 0, 0, 255, 30, 0, 0, 255,
    ]);
    const crop = { x: 0, y: 0, width: 2, height: 2 };
    const refCrop = cropImage({ data: ref, width: 3, height: 2, crop });
    const actualCrop = cropImage({ data: actual, width: 2, height: 2, crop });
    assert.deepEqual([...refCrop.data], [
      255, 0, 0, 255, 255, 0, 0, 255,
      255, 0, 0, 255, 255, 0, 0, 255,
    ]);
    assert.deepEqual([...actualCrop.data], [...actual]);
  });

  test("rejects a crop that does not fit", () => {
    const ref = solid(1, [255, 255, 255]);
    assert.throws(
      () => cropBuffers({ ref, actual: ref, width: 1, height: 1, crop: { x: 0, y: 0, width: 2, height: 1 } }),
      /does not fit/,
    );
    assert.throws(
      () => cropBuffers({ ref, actual: ref, width: 1, height: 1, crop: { x: 0, y: 0, width: 0, height: 1 } }),
      /Invalid crop/,
    );
  });
});

describe("buildHeatmap", () => {
  test("counted pixels are red, soft pixels yellow, matches are dimmed grayscale", () => {
    const ref = new Uint8ClampedArray([
      255, 255, 255, 255, // 0: match
      0, 0, 0, 255, // 1: counted
      0, 0, 0, 255, // 2: soft
    ]);
    const heatmap = buildHeatmap({ ref, classes: new Uint8Array([0, 1, 2]), width: 3, height: 1 });
    assert.deepEqual([...heatmap.slice(0, 4)], [102, 102, 102, 255]); // 255 * 0.4
    assert.deepEqual([...heatmap.slice(4, 8)], [255, 0, 0, 255]);
    assert.deepEqual([...heatmap.slice(8, 12)], [255, 255, 0, 255]);
  });
});

describe("verdicts", () => {
  test("percentOf rounds to three decimals and rejects zero pixels", () => {
    assert.equal(percentOf(1, 3), 33.333);
    assert.equal(percentOf(0, 18256), 0);
    assert.throws(() => percentOf(0, 0), /zero pixels/);
  });

  test("the target is inclusive", () => {
    assert.deepEqual(verdictFor(2, 2), { pct: 2, target: 2, pass: true });
    assert.equal(verdictFor(2.001, 2).pass, false);
  });

  test("suggestedSharedCrop takes the shared origin box", () => {
    assert.deepEqual(
      suggestedSharedCrop({ width: 326, height: 56 }, { width: 324, height: 58 }),
      { x: 0, y: 0, width: 324, height: 56 },
    );
  });

  test("formatSizeDelta signs both axes", () => {
    assert.equal(formatSizeDelta({ width: 324, height: 56 }, { width: 326, height: 56 }), "-2x0");
    assert.equal(formatSizeDelta({ width: 366, height: 58 }, { width: 326, height: 56 }), "+40x+2");
  });
});

describe("injected-source contract", () => {
  // diff.mjs stringifies these functions into the browser. They must therefore
  // never reference module-scope helpers.
  test("the injected functions are self-contained", () => {
    for (const fn of [applyMask, cropImage, classifyPixels, buildHeatmap]) {
      const source = fn.toString();
      assert.ok(!source.includes("import "), `${fn.name} must not import`);
      assert.ok(!/require\(/.test(source), `${fn.name} must not require`);
    }
  });
});
