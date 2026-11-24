import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleMarkdownLines } from "./failure-cases.mjs";

const implementationTitle = /^(?:feat|fix|test|ops|dx|docs|chore)(?:\([^)]+\))?!?:/;
const issueTarget = String.raw`(?:#[1-9]\d*|jessepollak/home#[1-9]\d*|https://github\.com/jessepollak/home/issues/[1-9]\d*)`;
const closingLink = new RegExp(
  String.raw`^[ \t]*(?:(?:>[ \t]*)+|(?:[-*+]|\d+[.)])[ \t]+)?(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?):?[ \t]+${issueTarget}(?:[ \t]*,[ \t]*${issueTarget})*[ \t]*$`,
  "i",
);
const noIssue = /^No issue:[ \t]*\S.*$/;

export function prClosingLinkFindings(title, body) {
  if (!implementationTitle.test(title)) return [];
  return visibleMarkdownLines(body).some((line) => closingLink.test(line) || noIssue.test(line))
    ? []
    : ["An implementation PR body must have a visible Closes #<n>, Fixes #<n>, or Resolves #<n> line, or No issue: <reason>."];
}

const text = (lines) => lines.map((line) => `${line}\n`).join("");

export function runPrClosingLink({ args = process.argv.slice(2), env = process.env } = {}) {
  const stdout = [];
  if (args.length !== 0) throw new Error("Usage: node scripts/gates/pr-closing-link.mjs");
  const findings = prClosingLinkFindings(env.PR_TITLE || "", env.PR_BODY || "");
  stdout.push("## PR closing link");
  if (findings.length === 0) {
    stdout.push("PR closing link gate passed.");
    return { status: 0, stdout: text(stdout) };
  }
  for (const finding of findings) stdout.push(`- ${finding}`);
  return { status: 1, stdout: text(stdout) };
}

function main() {
  const result = runPrClosingLink();
  process.stdout.write(result.stdout);
  process.exitCode = result.status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
