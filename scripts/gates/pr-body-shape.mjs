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

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/pr-body-shape.mjs");
  const title = process.env.PR_TITLE || "";
  const body = process.env.PR_BODY || "";
  const generated = process.env.PR_GENERATED_BODY === "true";
  const findings = [
    ...(generated ? [] : prClosingLinkFindings(title, body)),
    ...(generated ? [] : prBodyShapeFindings(title, body)),
    ...caughtByPrBodyFindings(title, body),
  ];
  console.log("## PR body");
  if (generated) console.log("Generated PR body: closing link and What changes checks skipped.");
  if (findings.length === 0) {
    console.log("PR body checks passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
