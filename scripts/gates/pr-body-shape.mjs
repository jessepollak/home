import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { caughtByPrBodyFindings } from "./caught-by-pr-body.mjs";
import { visibleMarkdownLines } from "./failure-cases.mjs";
import { prClosingLinkFindings } from "./pr-closing-link.mjs";

const factoryTitle = /^(?:product|design|feat|fix|test|ops|dx|docs|chore)(?:\([^)]+\))?!?:/;

export function prBodyShapeFindings(title, body) {
  if (!factoryTitle.test(title)) return [];
  const headings = visibleMarkdownLines(body).flatMap((line) => {
    const match = /^ {0,3}##[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    return match ? [match[1].trim()] : [];
  });
  if (!headings.includes("What changes")) return ["PR body needs a visible ## What changes section."];
  return headings[0] === "What changes"
    ? []
    : ["The first visible level-two heading must be ## What changes."];
}

const text = (lines) => lines.map((line) => `${line}\n`).join("");

export function runPrBodyShape({ args = process.argv.slice(2), env = process.env } = {}) {
  const stdout = [];
  if (args.length !== 0) throw new Error("Usage: node scripts/gates/pr-body-shape.mjs");
  const title = env.PR_TITLE || "";
  const body = env.PR_BODY || "";
  const generated = env.PR_GENERATED_BODY === "true";
  const findings = [
    ...(generated ? [] : prClosingLinkFindings(title, body)),
    ...(generated ? [] : prBodyShapeFindings(title, body)),
    ...caughtByPrBodyFindings(title, body),
  ];
  stdout.push("## PR body");
  if (generated) stdout.push("Generated PR body: closing link and What changes checks skipped.");
  if (findings.length === 0) {
    stdout.push("PR body checks passed.");
    return { status: 0, stdout: text(stdout) };
  }
  for (const finding of findings) stdout.push(`- ${finding}`);
  return { status: 1, stdout: text(stdout) };
}

function main() {
  const result = runPrBodyShape();
  process.stdout.write(result.stdout);
  process.exitCode = result.status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
