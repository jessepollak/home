import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  caughtByPolicyStart,
  caughtByDetectors,
  commitLogFormat,
  fixScope,
  parseCommitLog,
  pullRequestNumber,
} from "./caught-by.mjs";
import { prBodyDetectors } from "./caught-by-pr-body.mjs";

// The report reads scoped fix commits' Caught-by trailers, recovering missing
// detectors from visible PR-body lines for title-only squashes. It ranks the
// detectors and lists fixes a home/* lint rule could have caught. It is a
// report, not a gate: every path exits 0 so a broken corpus cannot fail a build.

export const detectorOrder = ["lint", "bot", "review", "browser", "production", "mixed", "unknown"];
// review, bot, and production fixes are the rule-first triage queue.
export const ruleCandidateDetectors = ["review", "bot", "production"];
export const defaultSince = "30.days";
export const maxReportCharacters = 60_000;
export const pullRequestLookupBudgetMs = 180_000;
export const pullRequestLookupTimeoutMs = 15_000;
const maxCandidateRows = 50;
const maxCandidateFiles = 10;
const truncationNotice = "\n\n_Report truncated at 60,000 characters._";

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

// Whether a commit exists in this repository. Fixture repositories predate the
// policy start and report no policy line.
function commitExists(sha, cwd) {
  return spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, encoding: "utf8" }).status === 0;
}

// Whether `descendant` is at or after `ancestor` in history.
function isAncestor(ancestor, descendant, cwd) {
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, encoding: "utf8" }).status === 0;
}

// `--since` accepts the compact `N.days` form used by the scripts and CI; any
// other value passes to git unchanged so ISO dates keep working.
export function sinceArgument(since) {
  const compact = /^(\d+)\.(day|days|week|weeks|month|months)$/.exec(since);
  return compact ? `${compact[1]} ${compact[2]} ago` : since;
}

export function parseArguments(argv) {
  const options = { since: null, range: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const separator = argv[index].indexOf("=");
    const flag = separator === -1 ? argv[index] : argv[index].slice(0, separator);
    const inline = separator === -1 ? null : argv[index].slice(separator + 1);
    if (flag === "--since" || flag === "--range") {
      const value = inline ?? argv[index + 1];
      if (!value) throw new Error(`${flag} requires a value`);
      if (inline === null) index += 1;
      options[flag === "--since" ? "since" : "range"] = value;
      continue;
    }
    if (flag === "--json" && inline === null) {
      options.json = true;
      continue;
    }
    throw new Error(`unknown argument ${argv[index]}`);
  }
  if (options.since !== null && options.range !== null) {
    throw new Error("--since and --range are mutually exclusive");
  }
  if (options.since === null && options.range === null) options.since = defaultSince;
  return options;
}

export function collectFixCommits({ cwd = process.cwd(), range = null, since = defaultSince } = {}) {
  const args = ["log", commitLogFormat];
  if (range) args.push(range);
  else args.push(`--since=${sinceArgument(since)}`, "HEAD");
  return parseCommitLog(git(args, cwd));
}

export function githubPullRequestBody(number, { cwd, runner = spawnSync, timeout = pullRequestLookupTimeoutMs }) {
  try {
    const result = runner("gh", ["pr", "view", String(number), "--json", "body", "--jq", ".body"], {
      cwd, encoding: "utf8", timeout,
    });
    return result.status === 0 && typeof result.stdout === "string"
      ? result.stdout.replace(/\r?\n$/, "")
      : null;
  } catch {
    return null;
  }
}

export function summarizeFixCommits(commits, { isPrePolicy = () => false, pullRequestBody = () => null } = {}) {
  const fixes = commits.flatMap((commit) => {
    const scope = fixScope(commit.subject);
    if (scope === null) return [];
    const prePolicy = isPrePolicy(commit.sha);
    // Squash-merged fix PRs aggregate their inner commits' trailers into one
    // body: identical values dedupe, several distinct values are mixed.
    let values = caughtByDetectors(commit.body);
    let detectorSource = values.length > 0 ? "trailer" : "none";
    const number = pullRequestNumber(commit.subject);
    if (values.length === 0 && !prePolicy && number !== null) {
      const body = pullRequestBody(number);
      if (body === null) {
        detectorSource = "pr-body-unavailable";
      } else if (typeof body === "string") {
        values = prBodyDetectors(body);
        if (values.length > 0) detectorSource = "pr-body";
      }
    }
    return [{
      sha: commit.sha,
      subject: commit.subject,
      scope,
      detector: values.length === 1 ? values[0] : values.length > 1 ? "mixed" : "unknown",
      detectorSource,
      prePolicy,
    }];
  });
  const counted = fixes.filter((fix) => !fix.prePolicy);
  const detectors = detectorOrder.map((detector) => {
    const count = counted.filter((fix) => fix.detector === detector).length;
    return { detector, count, share: counted.length === 0 ? 0 : count / counted.length };
  });
  const scopes = [...new Set(counted.map((fix) => fix.scope))]
    .map((scope) => {
      const scoped = counted.filter((fix) => fix.scope === scope);
      const counts = Object.fromEntries(detectorOrder.map((detector) => [
        detector,
        scoped.filter((fix) => fix.detector === detector).length,
      ]));
      return { scope, total: scoped.length, counts };
    })
    .sort((left, right) => right.total - left.total || (left.scope < right.scope ? -1 : 1));
  return { fixes, detectors, scopes };
}

function changedFiles(sha, cwd) {
  const output = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha], cwd);
  return output === "" ? [] : output.split("\n").filter(Boolean);
}

export function collectReport({ cwd = process.cwd(), range = null, since = defaultSince, policyStart = caughtByPolicyStart, pullRequestBody, runner, now = Date.now, lookupBudgetMs = pullRequestLookupBudgetMs } = {}) {
  const deadline = now() + lookupBudgetMs;
  const commits = collectFixCommits({ cwd, range, since });
  const resolvedPolicyStart = commitExists(policyStart, cwd) ? policyStart : null;
  const bodies = new Map();
  const lookup = pullRequestBody ?? ((number) => {
    if (bodies.has(number)) return bodies.get(number);
    const remaining = deadline - now();
    if (remaining <= 0) return null;
    const body = githubPullRequestBody(number, { cwd, runner, timeout: Math.min(pullRequestLookupTimeoutMs, remaining) });
    bodies.set(number, body);
    return body;
  });
  const summary = summarizeFixCommits(commits, {
    isPrePolicy: (sha) => resolvedPolicyStart !== null && !isAncestor(resolvedPolicyStart, sha, cwd),
    pullRequestBody: lookup,
  });
  const candidates = summary.fixes
    .filter((fix) => !fix.prePolicy && ruleCandidateDetectors.includes(fix.detector))
    .map((fix) => ({ ...fix, files: changedFiles(fix.sha, cwd) }));
  return {
    range,
    since: range === null ? since : null,
    total: summary.fixes.length,
    prePolicyTotal: summary.fixes.filter((fix) => fix.prePolicy).length,
    policyStart: resolvedPolicyStart,
    prBodyRecovered: summary.fixes.filter((fix) => !fix.prePolicy && fix.detectorSource === "pr-body").length,
    prBodyUnavailable: summary.fixes.filter((fix) => !fix.prePolicy && fix.detectorSource === "pr-body-unavailable").length,
    detectors: summary.detectors,
    scopes: summary.scopes,
    candidates,
  };
}

function formatShare(share) {
  return `${(share * 100).toFixed(1)}%`;
}

function formatCandidateFiles(files) {
  if (files.length === 0) return "_no files_";
  const shown = files.slice(0, maxCandidateFiles).map((file) => `\`${file}\``);
  if (files.length > maxCandidateFiles) shown.push(`… +${files.length - maxCandidateFiles} more`);
  return shown.join(", ");
}

// The workflow posts this markdown as a GitHub comment, so the body stays
// below the comment limit even for a very large candidate list.
function boundReport(markdown) {
  if (markdown.length <= maxReportCharacters) return markdown;
  return `${markdown.slice(0, maxReportCharacters - truncationNotice.length)}${truncationNotice}`;
}

export function renderMarkdown(report) {
  const lines = ["# Caught-by report", "", `Fix commits: ${report.total}`];
  lines.push("", report.range ? `Range: \`${report.range}\`` : `Since: \`${report.since}\``);
  if (report.policyStart !== null) {
    lines.push("", `Trailer policy started at \`${report.policyStart.slice(0, 8)}\` (#709, 2026-09-21). Pre-policy fix commits in this range: ${report.prePolicyTotal} of ${report.total} — excluded from shares.`);
  }
  const recovered = report.prBodyRecovered ?? 0;
  const unavailable = report.prBodyUnavailable ?? 0;
  if (recovered > 0 || unavailable > 0) {
    lines.push("", `Detectors recovered from pull request bodies: ${recovered}. Pull request body lookups unavailable: ${unavailable} — counted as unknown.`);
  }
  lines.push("", "## Detectors", "", "| Detector | Fixes | Share |", "| --- | ---: | ---: |");
  for (const row of report.detectors) {
    lines.push(`| ${row.detector} | ${row.count} | ${formatShare(row.share)} |`);
  }
  lines.push(
    "",
    "## By scope",
    "",
    `| Scope | Fixes | ${detectorOrder.join(" | ")} |`,
    `| --- | ---: | ${detectorOrder.map(() => "---:").join(" | ")} |`,
  );
  if (report.scopes.length === 0) {
    lines.push(`| _(none)_ | 0 | ${detectorOrder.map(() => "0").join(" | ")} |`);
  } else {
    for (const scope of report.scopes) {
      lines.push(`| ${scope.scope} | ${scope.total} | ${detectorOrder.map((detector) => scope.counts[detector]).join(" | ")} |`);
    }
  }
  lines.push("", "## Rule candidates (review, bot, production)", "");
  if (report.candidates.length === 0) {
    lines.push("None in this range.");
  } else {
    for (const candidate of report.candidates.slice(0, maxCandidateRows)) {
      lines.push(`- \`${candidate.sha.slice(0, 12)}\` ${candidate.subject} — ${formatCandidateFiles(candidate.files)}`);
    }
    if (report.candidates.length > maxCandidateRows) {
      lines.push(`- … +${report.candidates.length - maxCandidateRows} more candidates`);
    }
  }
  return boundReport(lines.join("\n"));
}

export function run(argv = process.argv.slice(2), { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseArguments(argv);
    const report = collectReport({ cwd, range: options.range, since: options.since });
    stdout.write(`${options.json ? JSON.stringify(report, null, 2) : renderMarkdown(report)}\n`);
  } catch (error) {
    stderr.write(`caught-by-report: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
