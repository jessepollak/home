import { caughtByDetectors, fixScope } from "./caught-by.mjs";
import { visibleMarkdownLines } from "./failure-cases.mjs";

export function prBodyDetectors(body) {
  return caughtByDetectors(visibleMarkdownLines(body).join("\n"));
}

export function caughtByPrBodyFindings(title, body) {
  if (fixScope(title) === null) return [];
  const detectors = prBodyDetectors(body);
  return detectors.length === 1
    ? []
    : ["A scoped fix PR body must name exactly one Caught-by detector: lint, unit, bot, review, browser, or production."];
}
