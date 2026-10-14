import { readFileSync } from "node:fs";

const owned = {
  shadow: new Set(["raised", "floating", "overlay", "toast", "none"]),
  duration: new Set(["fast", "base", "moderate", "slow"]),
  ease: new Set(["standard", "enter", "exit", "emphasized"]),
};

/** @typedef {{ family: "shadow" | "duration" | "ease" | "radius", token: string }} StyleDriftFinding */

/**
 * @param {string} token
 * @returns {StyleDriftFinding | null}
 */
export function classifyStyleUtility(token) {
  let base = token.replace(/^!|!$/gu, "");
  let brackets = 0;
  let parentheses = 0;
  let start = 0;
  for (let index = 0; index < base.length; index += 1) {
    const character = base[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === ":" && brackets === 0 && parentheses === 0) start = index + 1;
  }
  base = base.slice(start).replace(/^!|!$/gu, "");
  for (const family of ["shadow", "duration", "ease"]) {
    if (base.startsWith(`${family}-`) && base.length > family.length + 1 && !owned[family].has(base.slice(family.length + 1))) {
      return { family, token: base };
    }
  }
  if (/^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-\[.+\]$/u.test(base)) return { family: "radius", token: base };
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
