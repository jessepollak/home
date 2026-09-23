import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playwrightRungs = new Set([
  "layout", "scrolling", "focus", "history", "persisted-state", "media-query",
  "hydration", "dispatch", "journey",
]);

function isTestFile(path) {
  return /\.(?:test\.tsx?|pw\.ts|stories\.tsx)$/.test(path);
}

function isProductFile(path) {
  return path.startsWith("apps/web/")
    && /\.(?:[cm]?[jt]sx?|css|py)$/.test(path)
    && !path.startsWith("apps/web/tests/")
    && !path.startsWith("apps/web/stories/")
    && !path.startsWith("apps/web/verify/")
    && !/\.(?:test|stories|pw)\.[jt]sx?$/.test(path);
}

export function testWeightFindings(diff, title, body) {
  let path = "";
  let oldPath = "";
  let inHunk = false;
  let addedTests = 0;
  let productLines = 0;
  let addedPlaywright = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      path = "";
      oldPath = "";
      inHunk = false;
    } else if (line.startsWith("--- a/")) {
      oldPath = line.slice(6);
    } else if (line.startsWith("+++ ")) {
      path = line.startsWith("+++ b/") ? line.slice(6) : "";
    } else if (line.startsWith("@@ ")) {
      inHunk = true;
    } else if (inHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        if (isTestFile(path)) addedTests += 1;
        else if (isProductFile(path)) productLines += 1;
        if (/^apps\/web\/tests\/browser\/(?:.*\/)?[^/]+\.pw\.ts$/.test(path)
          && /^\s*test(?:\.describe)?\s*\(/.test(line.slice(1))) addedPlaywright = true;
      } else if (line.startsWith("-") && !line.startsWith("---") && isProductFile(oldPath)) {
        productLines += 1;
      }
    }
  }

  const findings = [];
  if (addedPlaywright) {
    const rung = body.match(/^Playwright-rung:[ \t]*(\S+)[ \t]*$/m)?.[1];
    if (!playwrightRungs.has(rung)) {
      findings.push("Added Playwright test/describe requires a PR-body line Playwright-rung: <layout|scrolling|focus|history|persisted-state|media-query|hydration|dispatch|journey>.");
    }
  }
  if (/^fix\([^)]+\):\s*\S/i.test(title) && addedTests > productLines
    && !/^Test-weight:[ \t]*\S.*$/m.test(body)) {
    findings.push(`Scoped fix adds ${addedTests} test lines versus ${productLines} added/deleted product lines; add a PR-body line Test-weight: <reason>.`);
  }
  return findings;
}

function main() {
  const base = process.env.BASE_REF || "main";
  const diff = execFileSync("git", ["diff", "--no-ext-diff", "--no-color", "--unified=0", `origin/${base}...HEAD`, "--", "apps/web"], { encoding: "utf8" });
  const findings = testWeightFindings(diff, process.env.PR_TITLE || "", process.env.PR_BODY || "");
  if (findings.length === 0) {
    console.log("Test-weight gate passed.");
    return;
  }
  for (const finding of findings) console.error(finding);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
