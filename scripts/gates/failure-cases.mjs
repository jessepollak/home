import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function visibleMarkdownLines(body) {
  let fence = null;
  let inComment = false;
  const lines = body.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    let start = 0;
    if (inComment) {
      const end = line.indexOf("-->");
      if (end < 0) return "";
      inComment = false;
      start = end + 3;
    } else if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (closing?.[0] === fence[0] && closing.length >= fence.length) fence = null;
      return "";
    } else {
      fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
      if (fence) return "";
    }
    let result = "";
    let from = start;
    const ticks = /`+/g;
    for (let i = start; i < line.length;) {
      if (line[i] === "`") {
        ticks.lastIndex = i;
        const opening = ticks.exec(line);
        let closing;
        while ((closing = ticks.exec(line)) && closing[0].length !== opening[0].length) {}
        i = closing ? ticks.lastIndex : opening.index + opening[0].length;
      } else if (line.startsWith("<!--", i)) {
        result += line.slice(from, i);
        const end = line.indexOf("-->", i + 4);
        if (end < 0) {
          inComment = true;
          return result;
        }
        i = end + 3;
        from = i;
      } else {
        i++;
      }
    }
    return result + line.slice(from);
  });
  return lines;
}

export function failureCasesReport(body) {
  const lines = visibleMarkdownLines(body);
  const findings = [];
  const entries = [];
  let hasTestPlan = false;
  let inTestPlan = false;
  for (const line of lines) {
    if (/^ {0,3}#{1,2}(?:[ \t]|$)/.test(line)) inTestPlan = /^ {0,3}##[ \t]+Test plan[ \t]*$/.test(line);
    else if (/^ {0,3}<\/details>/.test(line)) inTestPlan = false;
    if (inTestPlan) hasTestPlan = true;
    if (inTestPlan && /^Failure-cases:/.test(line)) entries.push(line);
  }
  if (!hasTestPlan) {
    findings.push("PR body needs a ## Test plan section with a Failure-cases line.");
    return { findings, value: null };
  }
  if (entries.length === 0) {
    findings.push(lines.some((line) => /^Failure-cases:/.test(line))
      ? "Failure-cases line must be inside ## Test plan."
      : "Failure-cases line is missing from ## Test plan.");
    return { findings, value: null };
  }
  if (entries.length > 1) {
    findings.push("## Test plan must contain exactly one Failure-cases line.");
    return { findings, value: null };
  }

  const value = entries[0].slice("Failure-cases:".length).trim();
  const counts = /^(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(value);
  if (counts) {
    if (BigInt(counts[1]) > BigInt(counts[2])) findings.push("Failure-cases tested count cannot exceed dependency calls; expected Failure-cases: <tested>/<dependency calls> or Failure-cases: N/A: <reason>.");
  } else if (!/^N\/A:[ \t]*\S/.test(value)) {
    findings.push("Malformed Failure-cases line; expected Failure-cases: <tested>/<dependency calls> or Failure-cases: N/A: <reason>.");
  }
  return { findings, value };
}

export function failureCasesFindings(body) {
  return failureCasesReport(body).findings;
}

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/failure-cases.mjs");
  const { findings, value } = failureCasesReport(process.env.PR_BODY || "");
  console.log("## Failure cases");
  if (findings.length === 0) {
    console.log(`Failure-cases: ${value}.`);
    console.log("Failure-cases gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
