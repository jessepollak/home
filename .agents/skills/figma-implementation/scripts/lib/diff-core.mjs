// Pure pixel-diff core for `scripts/diff.mjs`.
//
// Every function in this module is self-contained on purpose: diff.mjs injects
// the source of `applyMask`, `cropImage`, `classifyPixels` and `buildHeatmap`
// into a headless Chromium page with `Function.prototype.toString()` so the
// browser canvas can serve as the PNG codec while the logic stays plain,
// dependency-free JavaScript. Because of that:
//   * no module-scope helpers or constants may be referenced inside them;
//   * no `import.meta` / Node APIs may be used inside them.
// The same functions run directly in Node under `node --test`
// (`tests/diff-core.test.mjs`), which is where their behaviour is pinned.

/** Per-pixel channel tolerance. 0.1 means "a channel may differ by 10% and be ignored". */
export const DEFAULT_THRESHOLD = 0.1;

/** Image-level targets in percent of pixels. Text can never reach 0% across rasterizers. */
export const TEXT_TARGET_PERCENT = 2;
export const CHROME_TARGET_PERCENT = 0.5;

/** Byte offsets of the PNG IHDR width/height (8-byte signature + 4-byte length + "IHDR"). */
export const PNG_HEADER_BYTES = 24;

/**
 * Read width/height out of a PNG buffer's IHDR chunk without decoding the image.
 * Used to report capture dimensions and to fail fast on an unexpected export.
 *
 * @param {Uint8Array | Buffer} buffer
 */
export function pngSize(buffer) {
  const bytes = buffer;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < PNG_HEADER_BYTES) {
    throw new Error(`Not a PNG (${bytes.length} bytes): the file is truncated.`);
  }
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) throw new Error("Not a PNG: signature mismatch.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Blacken identical rectangles on both images (unmockable regions: avatars,
 * charts, timestamps). Returns new buffers so callers keep their originals.
 *
 * @param {{ ref: Uint8ClampedArray, actual: Uint8ClampedArray, width: number, height: number, masks: {x:number,y:number,width:number,height:number}[] }} input
 */
export function applyMask(input) {
  const { width, height, masks } = input;
  const ref = new Uint8ClampedArray(input.ref);
  const actual = new Uint8ClampedArray(input.actual);
  for (const mask of masks) {
    const x0 = Math.max(0, Math.floor(mask.x));
    const y0 = Math.max(0, Math.floor(mask.y));
    const x1 = Math.min(width, Math.floor(mask.x + mask.width));
    const y1 = Math.min(height, Math.floor(mask.y + mask.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        ref[i] = 0;
        ref[i + 1] = 0;
        ref[i + 2] = 0;
        ref[i + 3] = 255;
        actual[i] = 0;
        actual[i + 1] = 0;
        actual[i + 2] = 0;
        actual[i + 3] = 255;
      }
    }
  }
  return { ref, actual };
}

/**
 * Crop one image to a sub-rectangle using that image's own row stride.
 * References and captures may have different source widths, so each image must
 * be cropped independently before their output buffers can be compared.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number, crop: {x:number,y:number,width:number,height:number} }} input
 */
export function cropImage(input) {
  const { width, crop } = input;
  const x0 = Math.floor(crop.x);
  const y0 = Math.floor(crop.y);
  const outWidth = Math.floor(crop.width);
  const outHeight = Math.floor(crop.height);
  if (x0 < 0 || y0 < 0 || outWidth <= 0 || outHeight <= 0) {
    throw new Error(`Invalid crop ${JSON.stringify(crop)}.`);
  }
  if (x0 + outWidth > width || y0 + outHeight > input.height) {
    throw new Error(
      `Crop ${JSON.stringify(crop)} does not fit inside ${width}x${input.height}.`,
    );
  }
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const from = ((y + y0) * width + x0) * 4;
    data.set(input.data.subarray(from, from + outWidth * 4), y * outWidth * 4);
  }
  return { data, width: outWidth, height: outHeight };
}

/** Crop two same-sized images. Kept as the compact pure helper used by tests. */
export function cropBuffers(input) {
  const ref = cropImage({ data: input.ref, width: input.width, height: input.height, crop: input.crop });
  const actual = cropImage({ data: input.actual, width: input.width, height: input.height, crop: input.crop });
  return { ref: ref.data, actual: actual.data, width: ref.width, height: ref.height };
}

/**
 * Classify every pixel.
 *
 * Metric: the per-channel maximum absolute difference divided by 255, i.e. a
 * 0..1 distance that is symmetric and trivially explainable. A pixel counts as
 * a difference when that distance is greater than `threshold`; pixels at or
 * below it are "soft" (rasterizer noise, near-identical tones) and are drawn
 * yellow in the heatmap but never counted.
 *
 * There is deliberately no anti-aliasing exclusion pass: text edges are exactly
 * where two rasterizers disagree, so the honest trade is a fixed per-pixel
 * threshold plus a section-level target (see references/verification.md).
 *
 * @param {{ ref: Uint8ClampedArray, actual: Uint8ClampedArray, width: number, height: number, threshold: number }} input
 * @returns {{ classes: Uint8Array, diffPixels: number, softPixels: number, totalPixels: number }}
 */
export function classifyPixels(input) {
  const { ref, actual, width, height, threshold } = input;
  const totalPixels = width * height;
  const classes = new Uint8Array(totalPixels);
  const delta = (i) => {
    const dr = Math.abs(ref[i] - actual[i]);
    const dg = Math.abs(ref[i + 1] - actual[i + 1]);
    const db = Math.abs(ref[i + 2] - actual[i + 2]);
    const da = Math.abs(ref[i + 3] - actual[i + 3]);
    return Math.max(dr, dg, db, da) / 255;
  };
  let diffPixels = 0;
  let softPixels = 0;
  for (let p = 0; p < totalPixels; p++) {
    const i = p * 4;
    const distance = delta(i);
    if (distance > threshold) {
      classes[p] = 1;
      diffPixels++;
    } else if (distance > 0) {
      classes[p] = 2;
      softPixels++;
    }
  }
  return { classes, diffPixels, softPixels, totalPixels };
}

/**
 * Heatmap: dimmed grayscale of the reference, red where pixels were counted,
 * yellow where they were inside the per-pixel tolerance.
 *
 * @param {{ ref: Uint8ClampedArray, classes: Uint8Array, width: number, height: number }} input
 * @returns {Uint8ClampedArray} RGBA output
 */
export function buildHeatmap(input) {
  const { ref, classes, width, height } = input;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const classification = classes[p];
    if (classification === 1) {
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 255;
      continue;
    }
    if (classification === 2) {
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 0;
      out[i + 3] = 255;
      continue;
    }
    const luma = Math.round(0.2126 * ref[i] + 0.7152 * ref[i + 1] + 0.0722 * ref[i + 2]);
    const dimmed = Math.round(luma * 0.4);
    out[i] = dimmed;
    out[i + 1] = dimmed;
    out[i + 2] = dimmed;
    out[i + 3] = 255;
  }
  return out;
}

/** Percent of pixels that differed, rounded to three decimals. */
export function percentOf(diffPixels, totalPixels) {
  if (!totalPixels) throw new Error("Cannot compute a percentage of zero pixels.");
  return Math.round((diffPixels / totalPixels) * 100 * 1000) / 1000;
}

/** The one image-level verdict. */
export function verdictFor(pct, target) {
  return { pct, target, pass: pct <= target };
}

/**
 * Suggested crop when a reference and a capture disagree on size: the shared
 * box anchored at the origin. diff.mjs prints it instead of silently resizing.
 */
export function suggestedSharedCrop(refSize, actualSize) {
  return {
    x: 0,
    y: 0,
    width: Math.min(refSize.width, actualSize.width),
    height: Math.min(refSize.height, actualSize.height),
  };
}

/** Human-readable dimension delta, e.g. "+14x0" or "-2x0". */
export function formatSizeDelta(actual, expected) {
  const dx = actual.width - expected.width;
  const dy = actual.height - expected.height;
  const sign = (value) => (value > 0 ? `+${value}` : String(value));
  return `${sign(dx)}x${sign(dy)}`;
}
