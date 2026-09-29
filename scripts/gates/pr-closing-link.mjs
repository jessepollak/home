import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleMarkdownLines } from "./failure-cases.mjs";

const implementationTitle = /^(?:feat|fix|test|ops|dx|docs|chore)(?:\([^)]+\))?:/;
const closingLink = /^(?:Closes|Fixes|Resolves) #[1-9]\d*[ \t]*$/;
const noIssue = /^No issue:[ \t]*\S.*$/;

export function prClosingLinkFindings(title, body) {
  if (!implementationTitle.test(title)) return [];
  return visibleMarkdownLines(body).some((line) => closingLink.test(line) || noIssue.test(line))
    ? []
    : ["An implementation PR body must have a visible Closes #<n>, Fixes #<n>, or Resolves #<n> line, or No issue: <reason>."];
}

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/pr-closing-link.mjs");
  const findings = prClosingLinkFindings(process.env.PR_TITLE || "", process.env.PR_BODY || "");
  console.log("## PR closing link");
  if (findings.length === 0) {
    console.log("PR closing link gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
