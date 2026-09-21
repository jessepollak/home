import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectReport,
  maxReportCharacters,
  parseArguments,
  renderMarkdown,
  sinceArgument,
  summarizeFixCommits,
} from "../caught-by-report.mjs";

const cli = fileURLToPath(new URL("../caught-by-report.mjs", import.meta.url));

// Throwaway git repository fixture: real commits, real dates, real diffs. The
// corpus spans the default 30-day window and carries every detector plus the
// malformed-trailer cases the report must bucket as unknown.
const repo = mkdtempSync(path.join(tmpdir(), "caught-by-report-"));
after(() => rmSync(repo, { recursive: true, force: true }));

function git(args, options = {}) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

git(["init", "-q", "-b", "main"]);
git(["config", "user.email", "gates-fixture@example.com"]);
git(["config", "user.name", "Gates Fixture"]);

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const shas = {};

function commit(key, { subject, body = null, files, date }) {
  for (const [file, contents] of Object.entries(files)) {
    const destination = path.join(repo, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }
  git(["add", "--", ...Object.keys(files)]);
  const message = body === null ? subject : `${subject}\n\n${body}`;
  git(["commit", "-q", "-m", message], {
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  shas[key] = git(["rev-parse", "HEAD"]);
}

commit("feat", {
  subject: "feat(balances): add price feed",
  files: { "apps/web/balance.ts": "export const price = 0;\n" },
  date: daysAgo(45),
});
commit("lint", {
  subject: "fix(balances): guard null price",
  body: "Caught-by: lint",
  files: { "apps/web/balance.ts": "export const price = null;\n" },
  date: daysAgo(35),
});
commit("bot", {
  subject: "fix(access): repair session restore",
  body: "Caught-by: bot",
  files: { "apps/web/session.ts": "export const session = null;\n", "apps/web/cookie.ts": "export const cookie = null;\n" },
  date: daysAgo(20),
});
commit("review", {
  subject: "fix(balances): refresh stale snapshot",
  body: "Caught-by: review",
  files: { "apps/web/balance.ts": "export const price = undefined;\n" },
  date: daysAgo(15),
});
commit("production", {
  subject: "fix(home): restore redirect state",
  body: "Caught-by: production",
  files: { "apps/web/redirect.ts": "export const redirect = null;\n" },
  date: daysAgo(10),
});
commit("browser", {
  subject: "fix(balances): dismiss modal",
  body: "Caught-by: browser",
  files: { "apps/web/modal.ts": "export const modal = null;\n" },
  date: daysAgo(6),
});
commit("missing", {
  subject: "fix(access): recover missing cookie",
  files: { "apps/web/cookie.ts": "export const cookie = undefined;\n" },
  date: daysAgo(4),
});
commit("double", {
  subject: "fix(balances): reset cache",
  body: "Caught-by: lint\nCaught-by: review",
  files: { "apps/web/cache.ts": "export const cache = null;\n" },
  date: daysAgo(2),
});
commit("docs", {
  subject: "docs(balances): explain price",
  files: { "docs/price.md": "prices can be unavailable\n" },
  date: daysAgo(1),
});

const commit_ = (sha, subject, body = "") => ({ sha, subject, body });

test("parses --since, --range, and --json", () => {
  assert.deepEqual(parseArguments([]), { since: "30.days", range: null, json: false });
  assert.deepEqual(parseArguments(["--since", "7.days"]), { since: "7.days", range: null, json: false });
  assert.deepEqual(parseArguments(["--since=7.days"]), { since: "7.days", range: null, json: false });
  assert.deepEqual(parseArguments(["--range", "a..b", "--json"]), { since: null, range: "a..b", json: true });
  assert.throws(() => parseArguments(["--since"]), /--since requires a value/);
  assert.throws(() => parseArguments(["--range"]), /--range requires a value/);
  assert.throws(() => parseArguments(["--since", "7.days", "--range", "a..b"]), /mutually exclusive/);
  assert.throws(() => parseArguments(["--bogus"]), /unknown argument/);
});

test("normalizes the compact N.days form and passes other dates through", () => {
  assert.equal(sinceArgument("30.days"), "30 days ago");
  assert.equal(sinceArgument("7.days"), "7 days ago");
  assert.equal(sinceArgument("2.weeks"), "2 weeks ago");
  assert.equal(sinceArgument("2026-09-01"), "2026-09-01");
});

test("classifies scoped fixes by their deduped Caught-by trailer", () => {
  const summary = summarizeFixCommits([
    commit_("1".repeat(40), "feat(balances): add price"),
    commit_("2".repeat(40), "fix(balances): guard", "\n\nCaught-by: lint"),
    commit_("3".repeat(40), "fix(access): repair"),
    commit_("4".repeat(40), "fix(home): restore", "Caught-by: lint\nCaught-by: review"),
    commit_("5".repeat(40), "fix(home): restore", "Caught-by: guess"),
    commit_("6".repeat(40), "fix(home): restore", "Caught-by: browser\nCaught-by: browser"),
  ]);
  assert.deepEqual(summary.fixes.map((fix) => [fix.scope, fix.detector]), [
    ["balances", "lint"],
    ["access", "unknown"],
    ["home", "mixed"],
    ["home", "unknown"],
    ["home", "browser"],
  ]);
  assert.deepEqual(summary.detectors.map((row) => [row.detector, row.count, row.share]), [
    ["lint", 1, 1 / 5],
    ["bot", 0, 0],
    ["review", 0, 0],
    ["browser", 1, 1 / 5],
    ["production", 0, 0],
    ["mixed", 1, 1 / 5],
    ["unknown", 2, 2 / 5],
  ]);
  assert.deepEqual(summary.scopes.map((row) => [row.scope, row.total]), [
    ["home", 3],
    ["access", 1],
    ["balances", 1],
  ]);
});

test("excludes fixes marked pre-policy from detector counts and shares", () => {
  const prePolicySha = "1".repeat(40);
  const summary = summarizeFixCommits([
    commit_(prePolicySha, "fix(balances): guard", "Caught-by: lint"),
    commit_("2".repeat(40), "fix(access): repair", "Caught-by: bot"),
  ], { isPrePolicy: (sha) => sha === prePolicySha });
  assert.deepEqual(summary.fixes.map((fix) => fix.prePolicy), [true, false]);
  assert.deepEqual(summary.detectors.map((row) => [row.detector, row.count, row.share]), [
    ["lint", 0, 0],
    ["bot", 1, 1],
    ["review", 0, 0],
    ["browser", 0, 0],
    ["production", 0, 0],
    ["mixed", 0, 0],
    ["unknown", 0, 0],
  ]);
});

test("defaults to the last 30 days on the current branch", () => {
  const report = collectReport({ cwd: repo });
  assert.equal(report.since, "30.days");
  assert.equal(report.range, null);
  assert.equal(report.total, 6, "the 35-day-old lint fix is outside the window");
  assert.deepEqual(report.detectors.map((row) => [row.detector, row.count, row.share]), [
    ["lint", 0, 0],
    ["bot", 1, 1 / 6],
    ["review", 1, 1 / 6],
    ["browser", 1, 1 / 6],
    ["production", 1, 1 / 6],
    ["mixed", 1, 1 / 6],
    ["unknown", 1, 1 / 6],
  ]);
  assert.deepEqual(report.scopes.map((row) => [row.scope, row.total, row.counts]), [
    ["balances", 3, { lint: 0, bot: 0, review: 1, browser: 1, production: 0, mixed: 1, unknown: 0 }],
    ["access", 2, { lint: 0, bot: 1, review: 0, browser: 0, production: 0, mixed: 0, unknown: 1 }],
    ["home", 1, { lint: 0, bot: 0, review: 0, browser: 0, production: 1, mixed: 0, unknown: 0 }],
  ]);
});

test("lists review, bot, and production fixes as rule candidates with their files", () => {
  const { candidates } = collectReport({ cwd: repo });
  assert.deepEqual(candidates.map(({ sha, scope, detector, subject, files }) => ({ sha, scope, detector, subject, files })), [
    { sha: shas.production, scope: "home", detector: "production", subject: "fix(home): restore redirect state", files: ["apps/web/redirect.ts"] },
    { sha: shas.review, scope: "balances", detector: "review", subject: "fix(balances): refresh stale snapshot", files: ["apps/web/balance.ts"] },
    { sha: shas.bot, scope: "access", detector: "bot", subject: "fix(access): repair session restore", files: ["apps/web/cookie.ts", "apps/web/session.ts"] },
  ]);
});

test("honors --range over the since default", () => {
  const report = collectReport({ cwd: repo, range: `${shas.bot}..HEAD` });
  assert.equal(report.range, `${shas.bot}..HEAD`);
  assert.equal(report.since, null);
  assert.equal(report.total, 5);
  assert.deepEqual(report.candidates.map((candidate) => candidate.detector), ["production", "review"]);
});

test("a wider window recovers the out-of-window lint fix", () => {
  const report = collectReport({ cwd: repo, since: "90.days" });
  assert.equal(report.total, 7);
  assert.equal(report.detectors.find((row) => row.detector === "lint").count, 1);
});

test("renders detector shares, scope columns, and candidate files as markdown", () => {
  const markdown = renderMarkdown(collectReport({ cwd: repo }));
  for (const expected of [
    "# Caught-by report",
    "Fix commits: 6",
    "Since: `30.days`",
    "| lint | 0 | 0.0% |",
    "| mixed | 1 | 16.7% |",
    "| unknown | 1 | 16.7% |",
    "| balances | 3 | 0 | 0 | 1 | 1 | 0 | 1 | 0 |",
    "| access | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 1 |",
    `- \`${shas.production.slice(0, 12)}\` fix(home): restore redirect state — \`apps/web/redirect.ts\``,
    `- \`${shas.bot.slice(0, 12)}\` fix(access): repair session restore — \`apps/web/cookie.ts\`, \`apps/web/session.ts\``,
  ]) {
    assert.ok(markdown.includes(expected), `missing: ${expected}`);
  }
});

test("renders an empty corpus without rows or candidates", () => {
  const markdown = renderMarkdown(summarizeReport(0));
  assert.ok(markdown.includes("Fix commits: 0"));
  assert.ok(markdown.includes("| _(none)_ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |"));
  assert.ok(markdown.includes("None in this range."));
});

function summarizeReport(total, candidates = []) {
  const detectors = ["lint", "bot", "review", "browser", "production", "mixed", "unknown"].map((detector) => ({ detector, count: 0, share: 0 }));
  return { range: null, since: "30.days", total, prePolicyTotal: 0, policyStart: null, detectors, scopes: [], candidates, fixes: [] };
}

test("caps candidate rows and files per candidate with an overflow note", () => {
  const candidates = Array.from({ length: 55 }, (_, index) => ({
    sha: String(index).padStart(40, "0"),
    subject: `fix(balances): candidate ${index}`,
    scope: "balances",
    detector: "review",
    prePolicy: false,
    files: Array.from({ length: 13 }, (_, file) => `apps/web/balance-${file}.ts`),
  }));
  const markdown = renderMarkdown(summarizeReport(55, candidates));
  const rows = markdown.split("\n").filter((line) => line.startsWith("- `"));
  assert.equal(rows.length, 50);
  assert.equal((rows[0].match(/`apps\/web\/balance-\d+\.ts`/g) ?? []).length, 10);
  assert.ok(rows[0].includes(", … +3 more"), rows[0]);
  assert.ok(markdown.includes("- … +5 more candidates"));
});

test("truncates an oversized report body at the character cap", () => {
  const candidates = Array.from({ length: 50 }, (_, index) => ({
    sha: String(index).padStart(40, "0"),
    subject: `fix(balances): ${"pending state ".repeat(150)}`,
    scope: "balances",
    detector: "review",
    prePolicy: false,
    files: [],
  }));
  const markdown = renderMarkdown(summarizeReport(50, candidates));
  assert.equal(markdown.length, maxReportCharacters);
  assert.ok(markdown.endsWith("_Report truncated at 60,000 characters._"));
});

test("omits the policy line when the repository predates the trailer policy", () => {
  const report = collectReport({ cwd: repo });
  assert.equal(report.policyStart, null);
  assert.equal(report.prePolicyTotal, 0);
  assert.ok(!renderMarkdown(report).includes("Trailer policy started at"), "fixture repositories have no policy-start commit");
});

test("marks fixes that predate the policy commit and reports the excluded count", () => {
  const report = collectReport({ cwd: repo, policyStart: shas.review });
  assert.equal(report.policyStart, shas.review);
  assert.equal(report.total, 6);
  assert.equal(report.prePolicyTotal, 1);
  assert.deepEqual(report.candidates.map((candidate) => candidate.detector), ["production", "review"]);
  const markdown = renderMarkdown(report);
  assert.ok(markdown.includes(`Trailer policy started at \`${shas.review.slice(0, 8)}\` (#709, 2026-09-21). Pre-policy fix commits in this range: 1 of 6 — excluded from shares.`));
  assert.ok(markdown.includes("| bot | 0 | 0.0% |"));
  assert.ok(markdown.includes("| review | 1 | 20.0% |"));
});

test("the CLI prints JSON for a range and the markdown summary otherwise", () => {
  const jsonRun = spawnSync(process.execPath, [cli, "--range", `${shas.bot}..HEAD`, "--json"], { cwd: repo, encoding: "utf8" });
  assert.equal(jsonRun.status, 0, jsonRun.stderr);
  const report = JSON.parse(jsonRun.stdout);
  assert.equal(report.total, 5);
  assert.equal(report.candidates.length, 2);
  assert.equal(report.candidates[0].sha.length, 40);

  const markdownRun = spawnSync(process.execPath, [cli, "--since", "90.days"], { cwd: repo, encoding: "utf8" });
  assert.equal(markdownRun.status, 0, markdownRun.stderr);
  assert.match(markdownRun.stdout, /^# Caught-by report\n/);
  assert.ok(markdownRun.stdout.includes("Fix commits: 7"));
});

test("the CLI reports failures without a non-zero exit", () => {
  const run = spawnSync(process.execPath, [cli, "--range", "no-such-ref..HEAD", "--json"], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /^caught-by-report: /);
});
