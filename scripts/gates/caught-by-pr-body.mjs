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

const text = (lines) => lines.map((line) => `${line}\n`).join("");

export function runCaughtByPrBody({ args = process.argv.slice(2), env = process.env } = {}) {
  const stdout = [];
  if (args.length !== 0) throw new Error("Usage: node scripts/gates/caught-by-pr-body.mjs");
  const findings = caughtByPrBodyFindings(env.PR_TITLE || "", env.PR_BODY || "");
  stdout.push("## Caught-by PR body");
  if (findings.length === 0) {
    stdout.push("Caught-by PR body gate passed.");
    return { status: 0, stdout: text(stdout) };
  }
  for (const finding of findings) stdout.push(`- ${finding}`);
  return { status: 1, stdout: text(stdout) };
}

function main() {
  const result = runCaughtByPrBody();
  process.stdout.write(result.stdout);
  process.exitCode = result.status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
