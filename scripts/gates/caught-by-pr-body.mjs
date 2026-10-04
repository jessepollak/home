import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/caught-by-pr-body.mjs");
  const findings = caughtByPrBodyFindings(process.env.PR_TITLE || "", process.env.PR_BODY || "");
  console.log("## Caught-by PR body");
  if (findings.length === 0) {
    console.log("Caught-by PR body gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
