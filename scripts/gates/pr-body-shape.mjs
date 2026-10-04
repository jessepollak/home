import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleMarkdownLines } from "./failure-cases.mjs";

const factoryTitle = /^(?:product|design|feat|fix|test|ops|dx|docs|chore)(?:\([^)]+\))?!?:/;
const allowedHeadings = new Set([
  "What changes", "Preview", "Verification", "State transitions", "Test plan", "Review", "Real money", "Operator action required",
]);
const bulletLabels = ["Before", "After"];
const tableLabels = ["Who notices", "Decide", "Risk"];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bulletLine = (label) => new RegExp(`^[-*][ \\t]+\\*\\*${escape(label)}:\\*\\*(.*)$`);
const tableHeader = /^\|?[ \t]*Who notices[ \t]*\|[ \t]*Decide[ \t]*\|[ \t]*Risk[ \t]*\|?[ \t]*$/;
const tableCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const tableSeparator = /^\|?[ \t:|-]+\|?[ \t]*$/;
const placeholders = new Set([
  "What happens today, in plain words.",
  "What happens once this merges.",
  "users / developers (name the command, job, or file) / operators / nobody (refactor)",
]);

export function prBodyShapeFindings(title, body) {
  if (!factoryTitle.test(title)) return [];
  const lines = visibleMarkdownLines(body);
  const headings = lines.flatMap((line, index) => {
    const match = /^ {0,3}##[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    return match ? [{ name: match[1].trim(), index }] : [];
  });
  const findings = [];
  const section = headings.find((heading) => heading.name === "What changes");
  if (!section) {
    findings.push("PR body needs a visible ## What changes section.");
  } else {
    if (section !== headings[0]) findings.push("## What changes must be the first level-two heading.");
    const next = headings.find((heading) => heading.index > section.index);
    const content = lines.slice(section.index + 1, next?.index ?? lines.length);
    const prose = content.filter((line) => !tableSeparator.test(line)).join("\n").replace(/^[-*][ \t]+/gm, "").replace(/\|/g, " ");
    const words = prose.match(/\S+/g)?.length ?? 0;
    if (words > 200) findings.push(`## What changes has ${words} words; the limit is 200.`);
    const filled = (pattern) => content.some((line) => {
      const value = pattern.exec(line)?.[1]?.trim();
      return Boolean(value) && !placeholders.has(value);
    });
    for (const label of bulletLabels) {
      if (!filled(bulletLine(label))) findings.push(`## What changes needs a \`- **${label}:** …\` bullet with text that is not a template placeholder.`);
    }
    const header = content.findIndex((line) => tableHeader.test(line));
    if (header === -1) {
      findings.push("## What changes needs a `| Who notices | Decide | Risk |` table with one row of answers.");
    } else {
      const cells = tableSeparator.test(content[header + 1] ?? "") && content[header + 2]?.trim().startsWith("|")
        ? tableCells(content[header + 2])
        : [];
      tableLabels.forEach((label, index) => {
        const value = cells[index];
        if (!value || placeholders.has(value)) findings.push(`## What changes needs a ${label} answer in the table that is not a template placeholder.`);
      });
    }
  }
  for (const heading of headings) {
    if (!allowedHeadings.has(heading.name)) findings.push(`Disallowed level-two heading: ${heading.name || "(empty)"}.`);
  }
  return findings;
}

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/pr-body-shape.mjs");
  const findings = prBodyShapeFindings(process.env.PR_TITLE || "", process.env.PR_BODY || "");
  console.log("## PR body shape");
  if (findings.length === 0) {
    console.log("PR body shape gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
