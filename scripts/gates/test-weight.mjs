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
    || path.includes("/test-fixtures/")
    || /^fixtures?\.[cm]?[jt]sx?$/.test(name)
    || /\.stories\./.test(name)
    || /\.test\.mjs$/.test(name)
    || /\.(?:test\.tsx?|pw\.ts)$/.test(name);
}

function isProductFile(path) {
  return path.startsWith("apps/web/")
    && /\.(?:[cm]?[jt]sx?|css|py)$/.test(path)
    && !isTestFile(path)
    && !path.startsWith("apps/web/stories/")
    && !/\.(?:test|stories|pw)\.[jt]sx?$/.test(path);
}

function isBrowserFile(path) {
  return /^apps\/web\/tests\/browser\/(?:.*\/)?[^/]+\.pw\.ts$/.test(path);
}

function isPlaywrightDeclaration(line) {
  return /^\s*test(?:\.describe)?\s*\(/.test(line);
}

export function testWeightReport(diff, title, body, check = "all") {
  if (!["all", "rung", "weight"].includes(check)) throw new Error(`Unknown test-weight check: ${check}`);
  let path = "";
  let oldPath = "";
  let inHunk = false;
  let playwrightDelta = 0;
  let addedTests = 0;
  let productLines = 0;

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
        if (isBrowserFile(path) && isPlaywrightDeclaration(line.slice(1))) playwrightDelta += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        if (isProductFile(oldPath)) productLines += 1;
        if (isBrowserFile(oldPath) && isPlaywrightDeclaration(line.slice(1))) playwrightDelta -= 1;
      }
    }
  }
  const netNewPlaywright = Math.max(0, playwrightDelta);

  const findings = [];
  if (check !== "weight" && netNewPlaywright > 0) {
    const rung = body.match(/^Playwright-rung:[ \t]*(\S+)[ \t]*$/m)?.[1];
    if (!playwrightRungs.has(rung)) {
      findings.push("Net-new Playwright test/describe requires a PR-body line Playwright-rung: <layout|scrolling|focus|history|persisted-state|media-query|hydration|dispatch|journey>.");
    }
  }
  if (check !== "rung" && /^fix\([^)]+\):\s*\S/i.test(title) && productLines > 0 && addedTests > productLines
    && !/^Test-weight:[ \t]*\S.*$/m.test(body)) {
    findings.push(`Scoped fix adds ${addedTests} test lines versus ${productLines} added/deleted product lines; add a PR-body line Test-weight: <reason>.`);
  }
  return { findings, netNewPlaywright, addedTests, productLines };
}

export function testWeightFindings(diff, title, body, check = "all") {
  return testWeightReport(diff, title, body, check).findings;
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
  const check = process.argv.length === 2 ? "all" : process.argv[2]?.match(/^--check=(rung|weight)$/)?.[1];
  if (!check || process.argv.length > 3) throw new Error("Usage: node scripts/gates/test-weight.mjs [--check=rung|--check=weight]");
  const base = resolveBaseRef();
  const diff = git(["diff", "--no-ext-diff", "--no-color", "--unified=0", `${base}...HEAD`, "--", "apps/web"]);
  const { findings, netNewPlaywright, addedTests, productLines } = testWeightReport(diff, process.env.PR_TITLE || "", process.env.PR_BODY || "", check);
  console.log(check === "rung" ? "## Playwright rung" : "## Test weight");
  if (check === "rung") console.log(`Net-new Playwright declarations: ${netNewPlaywright}.`);
  else console.log(`Added test lines: ${addedTests}; added/deleted product lines: ${productLines}.`);
  if (findings.length === 0) {
    console.log(check === "rung" ? "Playwright-rung gate passed." : "Test-weight gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
