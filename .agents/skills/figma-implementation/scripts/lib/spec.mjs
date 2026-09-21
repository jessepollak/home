// Pure logic for `docs/design/<task>/audit.spec.json`: parsing, validation, and
// the DOM-vs-audit comparison that `scripts/measure.mjs` reports.
//
// Everything here is unit tested (`tests/spec.test.mjs`). The browser-side
// collection lives in `inspect.mjs`; this module never touches a DOM.

/** Thrown for a malformed spec so the message points at the offending field. */
export class SpecError extends Error {
  name = "SpecError";
}

const RECT_KEYS = [
  "width",
  "height",
  "left",
  "top",
  "right",
  "bottom",
  "contentWidth",
  "contentHeight",
  "paddingWidth",
  "paddingHeight",
];
const ELEMENT_KEYS = [
  "name",
  "selector",
  "rect",
  "gapToNext",
  "direction",
  "styles",
  "tolerance",
  "figma",
  "notes",
];

/**
 * @param {string | Record<string, unknown>} raw
 * @returns {Record<string, any>}
 */
export function parseAuditSpec(raw) {
  let spec;
  try {
    spec = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new SpecError(`audit.spec.json is not valid JSON: ${error.message}`);
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new SpecError("audit.spec.json must be a JSON object.");
  }
  if (typeof spec.story !== "string" && typeof spec.url !== "string") {
    throw new SpecError(
      'audit.spec.json needs "story" (a Storybook story id such as "pilot-financial-row--normal") or "url" (a full canvas URL).',
    );
  }
  if (spec.frame !== undefined) {
    if (!spec.frame || typeof spec.frame !== "object") {
      throw new SpecError('"frame" must be an object.');
    }
    for (const key of ["width", "height"]) {
      if (spec.frame[key] !== undefined && !Number.isFinite(spec.frame[key])) {
        throw new SpecError(`frame.${key} must be a number.`);
      }
    }
    for (const key of ["nodeId", "fileKey", "url", "name", "lastModified"]) {
      if (spec.frame[key] !== undefined && typeof spec.frame[key] !== "string") {
        throw new SpecError(`frame.${key} must be a string.`);
      }
    }
  }
  if (spec.frameSelector !== undefined && typeof spec.frameSelector !== "string") {
    throw new SpecError('"frameSelector" must be a selector string.');
  }
  if (spec.frameSize !== undefined) {
    if (!spec.frameSize || typeof spec.frameSize !== "object" || Array.isArray(spec.frameSize)) {
      throw new SpecError('"frameSize" must be an object such as { "width": "contentWidth", "height": "paddingHeight" }.');
    }
    const bad = Object.entries(spec.frameSize).filter(
      ([axis, key]) => !["width", "height"].includes(axis) || !FRAME_BOX_KEYS.includes(key),
    );
    if (bad.length) {
      throw new SpecError(
        `frameSize has unsupported entries: ${bad.map(([axis, key]) => `${axis}=${key}`).join(", ")} ` +
          `(allowed keys: ${FRAME_BOX_KEYS.join(", ")}; axes: width, height).`,
      );
    }
  }
  if (spec.frameBox !== undefined && !["border", "content"].includes(spec.frameBox)) {
    throw new SpecError('"frameBox" must be "border" or "content".');
  }
  if (!Array.isArray(spec.elements) || spec.elements.length === 0) {
    throw new SpecError('audit.spec.json needs a non-empty "elements" array.');
  }
  const names = new Set();
  const elements = spec.elements.map((element, index) => {
    const validated = validateElement(element, index);
    if (names.has(validated.name)) {
      throw new SpecError(`elements[${index}] reuses the name "${validated.name}".`);
    }
    names.add(validated.name);
    return validated;
  });
  return { ...spec, elements };
}

/**
 * @param {unknown} element
 * @param {number} index
 */
export function validateElement(element, index) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    throw new SpecError(`elements[${index}] must be an object.`);
  }
  const record = /** @type {Record<string, any>} */ (element);
  if (typeof record.name !== "string" || !record.name) {
    throw new SpecError(`elements[${index}].name must be a non-empty string.`);
  }
  if (typeof record.selector !== "string" || !record.selector) {
    throw new SpecError(`elements[${index}] (${record.name}).selector must be a non-empty string.`);
  }
  const unknown = Object.keys(record).filter((key) => !ELEMENT_KEYS.includes(key));
  if (unknown.length) {
    throw new SpecError(
      `elements[${index}] (${record.name}) has unsupported key(s): ${unknown.join(", ")}.`,
    );
  }
  if (record.tolerance !== undefined && !Number.isFinite(record.tolerance)) {
    throw new SpecError(`elements[${index}] (${record.name}).tolerance must be a number.`);
  }
  if (record.direction !== undefined && !["h", "v"].includes(record.direction)) {
    throw new SpecError(`elements[${index}] (${record.name}).direction must be "h" or "v".`);
  }
  if (record.gapToNext !== undefined && !Number.isFinite(record.gapToNext)) {
    throw new SpecError(`elements[${index}] (${record.name}).gapToNext must be a number.`);
  }
  if (record.rect !== undefined) {
    if (!record.rect || typeof record.rect !== "object" || Array.isArray(record.rect)) {
      throw new SpecError(`elements[${index}] (${record.name}).rect must be an object.`);
    }
    const bad = Object.keys(record.rect).filter(
      (key) => !RECT_KEYS.includes(key) || !Number.isFinite(record.rect[key]),
    );
    if (bad.length) {
      throw new SpecError(
        `elements[${index}] (${record.name}).rect has unsupported or non-numeric key(s): ${bad.join(", ")} (allowed: ${RECT_KEYS.join(", ")}).`,
      );
    }
  }
  if (record.styles !== undefined) {
    if (!record.styles || typeof record.styles !== "object" || Array.isArray(record.styles)) {
      throw new SpecError(`elements[${index}] (${record.name}).styles must be an object.`);
    }
    for (const [key, value] of Object.entries(record.styles)) {
      if (typeof value !== "string" && typeof value !== "number") {
        throw new SpecError(
          `elements[${index}] (${record.name}).styles.${key} must be a string or number.`,
        );
      }
    }
  }
  return record;
}

/**
 * The canonical Storybook canvas URL for a story id.
 *
 * @param {{ base?: string, story?: string, viewMode?: string }} input
 */
export function storyCanvasUrl({ base = "http://127.0.0.1:6006", story, viewMode = "story" }) {
  if (!story) throw new SpecError("A story id is required to build the canvas URL.");
  const url = new URL(`${base.replace(/\/+$/, "")}/iframe.html`);
  url.searchParams.set("id", story);
  url.searchParams.set("viewMode", viewMode);
  return url.toString();
}

/** `#fff`, `#ffffff`, `#ffffff80` → `rgb()` / `rgba()`; anything else is lowercased. */
export function normalizeColor(value) {
  if (typeof value !== "string") return value;
  const lower = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(lower);
  if (!hex) return lower.replace(/\s+/g, " ");
  let digits = hex[1];
  if (digits.length === 3) {
    digits = [...digits].map((char) => char + char).join("");
  }
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  if (digits.length === 8) {
    const alpha = Number.parseInt(digits.slice(6, 8), 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/** Normalize a computed-style value for comparison. */
export function normalizeStyleValue(value) {
  if (value === undefined || value === null) return "";
  const asString = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  const color = normalizeColor(asString);
  return typeof color === "string" ? color : asString;
}

/**
 * Compare one audited element against its measurement.
 *
 * `rect.left` / `rect.top` are offsets from the frame element's content box
 * origin; `rect.right` / `rect.bottom` are insets from that content box's right
 * and bottom edges. Without a `frameSelector` those four are page-relative.
 *
 * @param {Record<string, any>} element
 * @param {{ missing?: boolean, rect?: Record<string, number>, styles?: Record<string, string>, gapToNext?: number | null } | undefined} measured
 * @returns {{ prop: string, expected: unknown, actual: unknown }[]}
 */
export function compareElement(element, measured) {
  const tolerance = element.tolerance ?? 1;
  if (!measured || measured.missing) {
    return [{ prop: "selector", expected: element.selector, actual: "NOT FOUND" }];
  }
  const failures = [];
  for (const [key, expected] of Object.entries(element.rect ?? {})) {
    const actual = measured.rect?.[key];
    if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
      failures.push({ prop: key, expected, actual: actual ?? "NOT MEASURED" });
    }
  }
  if (element.gapToNext !== undefined) {
    const actual = measured.gapToNext;
    if (typeof actual !== "number" || Math.abs(actual - element.gapToNext) > tolerance) {
      failures.push({ prop: "gapToNext", expected: element.gapToNext, actual: actual ?? "NOT MEASURED" });
    }
  }
  for (const [key, expected] of Object.entries(element.styles ?? {})) {
    const actual = measured.styles?.[key];
    const expectedValue = normalizeStyleValue(expected);
    const actualValue = normalizeStyleValue(actual);
    const expectedPx = /^-?[\d.]+px$/.test(expectedValue);
    const actualPx = /^-?[\d.]+px$/.test(actualValue);
    const same = expectedPx && actualPx
      ? Math.abs(Number.parseFloat(expectedValue) - Number.parseFloat(actualValue)) <= tolerance
      : expectedValue === actualValue;
    if (!same) failures.push({ prop: key, expected, actual: actual ?? "NOT MEASURED" });
  }
  return failures;
}

/**
 * Compare a whole spec against a collection result.
 *
 * @param {Record<string, any>} spec
 * @param {{ frame?: Record<string, number> | null, elements: Record<string, any>[] }} measurement
 */
export function compareAll(spec, measurement) {
  const report = spec.elements.map((element, index) => {
    const measured = measurement.elements[index];
    const failures = compareElement(element, measured);
    return { name: element.name, selector: element.selector, failures, pass: failures.length === 0 };
  });
  const failures = report.reduce((total, entry) => total + entry.failures.length, 0);
  const frame = frameComparison(spec, measurement.frame ?? null);
  return { failures, pass: failures === 0, report, frame };
}

/**
 * Box keys the frame comparison may read from the measured frame ladder.
 * Figma auto-layout pads inside a frame, so a Figma frame is usually the DOM
 * padding box vertically and the content box horizontally when the owned
 * component supplies its own horizontal padding.
 */
export const FRAME_BOX_KEYS = [
  "width",
  "height",
  "contentWidth",
  "contentHeight",
  "paddingWidth",
  "paddingHeight",
];

/**
 * The frame element reported as "expected WxH vs actual WxH (dx x dy)".
 * A hug-width Figma frame and a stretch-width DOM row legitimately disagree;
 * the delta is recorded rather than silently tolerated.
 *
 * `spec.frameSize` names which measured box each axis maps to, defaulting to
 * the boxes `frameBox` selected.
 *
 * @param {Record<string, any>} spec
 * @param {Record<string, number> | null} frame
 */
export function frameComparison(spec, frame) {
  const expected = spec.frame ? { width: spec.frame.width, height: spec.frame.height } : null;
  if (!expected || !frame) return { expected, actual: frame, delta: null, keys: frameSizeKeys(spec) };
  const keys = frameSizeKeys(spec);
  const actual = {};
  const delta = {};
  for (const axis of ["width", "height"]) {
    const key = keys[axis];
    const value = frame[key];
    actual[axis] = value ?? null;
    delta[axis] = typeof value === "number" ? Math.round((value - expected[axis]) * 100) / 100 : null;
  }
  return { expected, actual, delta, keys };
}

/** @param {Record<string, any>} spec */
export function frameSizeKeys(spec) {
  return {
    width: spec.frameSize?.width ?? "width",
    height: spec.frameSize?.height ?? "height",
  };
}

/** The frame element's content-box size must match the Figma frame size. */
export function frameMatched(spec, frame) {
  const comparison = frameComparison(spec, frame);
  if (!comparison.expected || !comparison.actual) return null;
  return comparison.delta.width === 0 && comparison.delta.height === 0;
}
