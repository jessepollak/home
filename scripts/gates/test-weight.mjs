import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playwrightRungs = new Set([
  "layout", "scrolling", "focus", "history", "persisted-state", "media-query",
  "hydration", "dispatch", "journey",
]);

function isTestFile(path) {
  if (!path.startsWith("apps/web/")) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return path.startsWith("apps/web/tests/")
    || path.startsWith("apps/web/oxlint/tests/")
    || name.includes("fixture")
    || /\.stories\./.test(name)
    || /\.test\.mjs$/.test(name)
    || /\.(?:test\.tsx?|pw\.ts)$/.test(name);
}

function isProductFile(path) {
  return path.startsWith("apps/web/")
    && /\.(?:[cm]?[jt]sx?|css|py)$/.test(path)
    && !isTestFile(path)
    && !path.startsWith("apps/web/stories/")
    && !path.startsWith("apps/web/verify/")
    && !/\.(?:test|stories|pw)\.[jt]sx?$/.test(path);
}

function isBrowserFile(path) {
  return /^apps\/web\/tests\/browser\/(?:.*\/)?[^/]+\.pw\.ts$/.test(path);
}

function isPlaywrightDeclaration(line) {
  return /^\s*test(?:\.describe)?\s*\(/.test(line);
}

export function testWeightReport(diff, title, body) {
  let path = "";
  let oldPath = "";
  let inHunk = false;
  let filePlaywrightDelta = 0;
  let netNewPlaywright = 0;
  let addedTests = 0;
  let productLines = 0;

  function finishFile() {
    netNewPlaywright += Math.max(0, filePlaywrightDelta);
    filePlaywrightDelta = 0;
  }

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finishFile();
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
        if (isBrowserFile(path) && isPlaywrightDeclaration(line.slice(1))) filePlaywrightDelta += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        if (isProductFile(oldPath)) productLines += 1;
        if (isBrowserFile(oldPath) && isPlaywrightDeclaration(line.slice(1))) filePlaywrightDelta -= 1;
      }
    }
  }
  finishFile();

  const findings = [];
  if (netNewPlaywright > 0) {
    const rung = body.match(/^Playwright-rung:[ \t]*(\S+)[ \t]*$/m)?.[1];
    if (!playwrightRungs.has(rung)) {
      findings.push("Net-new Playwright test/describe requires a PR-body line Playwright-rung: <layout|scrolling|focus|history|persisted-state|media-query|hydration|dispatch|journey>.");
    }
  }
  if (/^fix\([^)]+\):\s*\S/i.test(title) && addedTests > productLines
    && !/^Test-weight:[ \t]*\S.*$/m.test(body)) {
    findings.push(`Scoped fix adds ${addedTests} test lines versus ${productLines} added/deleted product lines; add a PR-body line Test-weight: <reason>.`);
  }
  return { findings, netNewPlaywright, addedTests, productLines };
}

export function testWeightFindings(diff, title, body) {
  return testWeightReport(diff, title, body).findings;
}

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function resolveBaseRef({ base = process.env.BASE_REF || "main", cwd = process.cwd(), gitRunner = git } = {}) {
  const remoteBase = `origin/${base}`;
  try {
    gitRunner(["rev-parse", "--verify", remoteBase], cwd);
  } catch {
    try {
      gitRunner(["fetch", "--no-tags", "--depth=200", "origin", base], cwd);
      gitRunner(["rev-parse", "--verify", remoteBase], cwd);
    } catch (error) {
      throw new Error(`could not resolve base ref ${remoteBase}`, { cause: error });
    }
  }
  return remoteBase;
}

function main() {
  const base = resolveBaseRef();
  const diff = git(["diff", "--no-ext-diff", "--no-color", "--unified=0", `${base}...HEAD`, "--", "apps/web"]);
  const { findings, netNewPlaywright, addedTests, productLines } = testWeightReport(diff, process.env.PR_TITLE || "", process.env.PR_BODY || "");
  console.log("## Test weight");
  console.log(`Net-new Playwright declarations: ${netNewPlaywright}; added test lines: ${addedTests}; added/deleted product lines: ${productLines}.`);
  if (findings.length === 0) {
    console.log("Test-weight gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
