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
