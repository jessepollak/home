import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  caughtByTrailerValues,
  commitLogFormat,
  fixScope,
  parseCommitLog,
} from "./caught-by.mjs";

// The report reads the same scoped fix subjects and Caught-by trailers the
// provenance gate enforces, then ranks the detectors and lists the fixes a
// home/* lint rule could have caught. It is a report, not a gate: every path
// exits 0 so a broken corpus can never fail a build.

export const detectorOrder = ["lint", "bot", "review", "browser", "production", "unknown"];
// review, bot, and production fixes are the rule-first triage queue.
export const ruleCandidateDetectors = ["review", "bot", "production"];
export const defaultSince = "30.days";

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
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

export function summarizeFixCommits(commits) {
  const fixes = commits.flatMap((commit) => {
    const scope = fixScope(commit.subject);
    if (scope === null) return [];
    const values = caughtByTrailerValues(commit.body);
    return [{
      sha: commit.sha,
      subject: commit.subject,
      scope,
      detector: values.length === 1 ? values[0] : "unknown",
    }];
  });
  const detectors = detectorOrder.map((detector) => {
    const count = fixes.filter((fix) => fix.detector === detector).length;
    return { detector, count, share: fixes.length === 0 ? 0 : count / fixes.length };
  });
  const scopes = [...new Set(fixes.map((fix) => fix.scope))]
    .map((scope) => {
      const scoped = fixes.filter((fix) => fix.scope === scope);
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

export function collectReport({ cwd = process.cwd(), range = null, since = defaultSince } = {}) {
  const commits = collectFixCommits({ cwd, range, since });
  const summary = summarizeFixCommits(commits);
  const candidates = summary.fixes
    .filter((fix) => ruleCandidateDetectors.includes(fix.detector))
    .map((fix) => ({ ...fix, files: changedFiles(fix.sha, cwd) }));
  return {
    range,
    since: range === null ? since : null,
    total: summary.fixes.length,
    detectors: summary.detectors,
    scopes: summary.scopes,
    candidates,
  };
}

function formatShare(share) {
  return `${(share * 100).toFixed(1)}%`;
}

export function renderMarkdown(report) {
  const lines = ["# Caught-by report", "", `Fix commits: ${report.total}`];
  lines.push("", report.range ? `Range: \`${report.range}\`` : `Since: \`${report.since}\``);
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
    for (const candidate of report.candidates) {
      const files = candidate.files.length === 0
        ? "_no files_"
        : candidate.files.map((file) => `\`${file}\``).join(", ");
      lines.push(`- \`${candidate.sha.slice(0, 12)}\` ${candidate.subject} — ${files}`);
    }
  }
  return lines.join("\n");
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
