import { readFileSync } from "node:fs";

const owned = {
  shadow: new Set(["raised", "floating", "overlay", "toast", "none"]),
  duration: new Set(["fast", "base", "moderate", "slow"]),
  ease: new Set(["standard", "enter", "exit", "emphasized"]),
};

export const styleDriftFamilies = ["shadow", "duration", "ease", "radius", "status-color", "status-motion", "status-mark"];
export const statusStyleOwners = ["components/ui/status-texture.tsx", "components/ui/coverage-status-preview.tsx", "components/finance-rows.tsx", "components/load-error.tsx"];

export function isStatusStyleOwner(file) {
  return statusStyleOwners.includes(file);
}

export const primitiveStyleScope = "components/ui/";

export function isPrimitiveStyleFile(file) {
  return file.startsWith(primitiveStyleScope);
}

export function isStyleDriftExempt(file, family) {
  const status = family.startsWith("status-");
  return status ? isStatusStyleOwner(file) : isPrimitiveStyleFile(file);
}

export function classifyStatusMark(name) {
  return /^(?:Loader|Loader2|LoaderCircle|LoaderPinwheel)(?:Icon)?$/u.test(name)
    ? { family: "status-mark", token: `<${name}>` } : null;
}

export function classifyStyleDriftToken(token) {
  return /^<[^<>]+>$/u.test(token) ? classifyStatusMark(token.slice(1, -1)) : classifyStyleUtility(token);
}

function maskQuotedContents(value) {
  const parts = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") { index += 1; continue; }
    if (quote) {
      if (character === quote) {
        parts.push(" ".repeat(index - start + 1));
        start = index + 1;
        quote = null;
      }
    } else if (character === "'" || character === '"') {
      parts.push(value.slice(start, index));
      start = index;
      quote = character;
    }
  }
  parts.push(quote ? " ".repeat(value.length - start) : value.slice(start));
  return parts.join("");
}

function arbitraryStyleBody(base) {
  const start = base.match(/^(?:[a-z][a-z0-9-]*-)?\[/u)?.[0].length;
  if (start === undefined) return null;
  let brackets = 1;
  for (let index = start; index < base.length; index += 1) {
    const character = base[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "[") brackets += 1;
    else if (character === "]") {
      brackets -= 1;
      if (brackets === 0) {
        return index > start && /^(?:\/[^/\s]+)?$/u.test(base.slice(index + 1)) ? base.slice(start, index) : null;
      }
    }
  }
  return null;
}

/** @typedef {{ family: "shadow" | "duration" | "ease" | "radius" | "status-color" | "status-motion" | "status-mark", token: string }} StyleDriftFinding */

/**
 * @param {string} token
 * @returns {StyleDriftFinding | null}
 */
export function classifyStyleUtility(token) {
  let base = token.replace(/^!|!$/gu, "");
  let unquotedBase = maskQuotedContents(base);
  let brackets = 0;
  let parentheses = 0;
  let start = 0;
  for (let index = 0; index < base.length; index += 1) {
    const character = unquotedBase[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === ":" && brackets === 0 && parentheses === 0) start = index + 1;
  }
  base = base.slice(start).replace(/^!|!$/gu, "");
  unquotedBase = unquotedBase.slice(start).replace(/^!|!$/gu, "");
  for (const family of ["shadow", "duration", "ease"]) {
    if (base.startsWith(`${family}-`) && base.length > family.length + 1 && !owned[family].has(base.slice(family.length + 1))) {
      return { family, token: base };
    }
  }
  if (/^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-\[.+\]$/u.test(base)) return { family: "radius", token: base };
  if (/^[a-z][a-z0-9-]*-(?:destructive|warning|status-(?:positive|caution|negative))(?:\/[^/\s]+)?$/u.test(base)) return { family: "status-color", token: base };
  const arbitraryBody = arbitraryStyleBody(unquotedBase);
  const arbitraryProperty = base.startsWith("[") ? arbitraryBody?.match(/^([a-z][a-z0-9-]*):(.+)$/u) : null;
  const arbitraryValue = base.startsWith("[") ? arbitraryProperty?.[2] : arbitraryBody;
  const shorthandValue = unquotedBase.match(/^[a-z][a-z0-9-]*-\(\s*(?:[a-z]+:)?(--.+)\)(?:\/[^/\s]+)?$/iu)?.[1];
  const value = arbitraryValue ?? (shorthandValue ? `var(${shorthandValue})` : "");
  const properties = [
    ...value.matchAll(/var\(\s*--([^,()\s]+)/giu),
    ...value.matchAll(/theme\(\s*colors\.([^,()\s]+)/giu),
  ].map((match) => match[1]);
  if (properties.some((property) => /(?:^|-)(?:destructive|warning|status-(?:positive|caution|negative))$/u.test(property))) return { family: "status-color", token: base };
  const animation = base.startsWith("animate-") || ["animation", "animation-name"].includes(arbitraryProperty?.[1]) ? value : null;
  if (/^animate-(?:spin|pulse|ping|bounce)$/u.test(base)
    || (animation && properties.some((property) => /(?:^|-)(?:spin|pulse|ping|bounce)(?:$|-)/u.test(property)))
    || (animation && /(?:^|_|,|\))(?:spin|pulse|ping|bounce)(?=_|,|\)|$)/u.test(animation.replace(/var\(\s*--[^,()\s]+/giu, "")))) return { family: "status-motion", token: base };
  return null;
}

/**
 * @param {string} value
 * @returns {StyleDriftFinding[]}
 */
export function styleDriftOccurrences(value) {
  return value.split(/\s+/u).map(classifyStyleUtility).filter((entry) => entry !== null);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(new URL("./style-drift-baseline.json", import.meta.url), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  baseline = { files: {} };
}

export function styleDriftBaselineFor(file) {
  return Object.hasOwn(baseline.files, file) ? baseline.files[file] : {};
}
