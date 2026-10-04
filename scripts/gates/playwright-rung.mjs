import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playwrightRungs = new Set([
  "layout", "scrolling", "focus", "history", "persisted-state", "media-query",
  "hydration", "dispatch", "journey",
]);

function isBrowserFile(path) {
  return /^apps\/web\/tests\/browser\/(?:.*\/)?[^/]+\.pw\.ts$/.test(path);
}

function isPlaywrightDeclaration(line) {
  return /^\s*test(?:\.describe)?\s*\(/.test(line);
}

export function playwrightRungReport(diff, body) {
  let path = "";
  let oldPath = "";
  let inHunk = false;
  let playwrightDelta = 0;

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
        if (isBrowserFile(path) && isPlaywrightDeclaration(line.slice(1))) playwrightDelta += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        if (isBrowserFile(oldPath) && isPlaywrightDeclaration(line.slice(1))) playwrightDelta -= 1;
      }
    }
  }
  const netNewPlaywright = Math.max(0, playwrightDelta);

  const findings = [];
  if (netNewPlaywright > 0) {
    const rung = body.match(/^Playwright-rung:[ \t]*(\S+)[ \t]*$/m)?.[1];
    if (!playwrightRungs.has(rung)) {
      findings.push("Net-new Playwright test/describe requires a PR-body line Playwright-rung: <layout|scrolling|focus|history|persisted-state|media-query|hydration|dispatch|journey>.");
    }
  }
  return { findings, netNewPlaywright };
}

export function playwrightRungFindings(diff, body) {
  return playwrightRungReport(diff, body).findings;
}

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
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
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/playwright-rung.mjs");
  const base = resolveBaseRef();
  const diff = git(["diff", "--no-ext-diff", "--no-color", "--unified=0", `${base}...HEAD`, "--", "apps/web"]);
  const { findings, netNewPlaywright } = playwrightRungReport(diff, process.env.PR_BODY || "");
  console.log("## Playwright rung");
  console.log(`Net-new Playwright declarations: ${netNewPlaywright}.`);
  if (findings.length === 0) {
    console.log("Playwright-rung gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
