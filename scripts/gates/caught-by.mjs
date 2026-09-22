import { spawnSync } from "node:child_process";

export const caughtByValues = ["lint", "bot", "review", "browser", "production"];

// The commit that introduced the trailer policy (#709, 2026-09-21). The report
// marks fixes that do not descend from it as pre-policy.
export const caughtByPolicyStart = "226d2f26fd9a16045b8b6c6339c3fe46028da2bd";

export const commitLogFormat = "--format=%H%x1f%s%x1f%B%x1e";

const fixSubject = /^fix\(([^)]+)\):/;
const caughtByTrailer = new RegExp(`^Caught-by: (${caughtByValues.join("|")})$`, "gm");

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function detectCommitRange({ cwd = process.cwd(), env = process.env, gitRunner = git } = {}) {
  if (!env.GITHUB_BASE_REF) return "HEAD^!";
  const baseRef = env.GITHUB_BASE_REF;
  const remoteBase = `origin/${baseRef}`;
  try {
    gitRunner(["rev-parse", "--verify", remoteBase], cwd);
  } catch {
    gitRunner(["fetch", "--no-tags", "--depth=200", "origin", baseRef], cwd);
    try {
      gitRunner(["rev-parse", "--verify", remoteBase], cwd);
    } catch (error) {
      throw new Error(`could not resolve base ref ${remoteBase}`, { cause: error });
    }
  }
  const base = gitRunner(["merge-base", "HEAD", remoteBase], cwd);
  return `${base}..HEAD`;
}

export function parseCommitLog(output) {
  if (!output) return [];
  return output.split("\x1e").flatMap((entry) => {
    const clean = entry.trim();
    if (!clean) return [];
    const [sha = "", subject = "", body = ""] = clean.split("\x1f");
    return [{ sha, subject, body }];
  });
}

export function readCommitsForRange(range, cwd = process.cwd()) {
  return parseCommitLog(git(["log", range, commitLogFormat], cwd));
}

// Every well-formed Caught-by trailer value in a commit body, in order and
// with repeats, for callers that want the raw trailers.
export function caughtByTrailerValues(body) {
  return [...body.matchAll(caughtByTrailer)].map((match) => match[1]);
}

// The distinct detectors a commit body names. A squash merge concatenates every
// inner commit's body, so a multi-commit fix PR repeats the same trailer once
// per commit; identical repeats are one detector, distinct values stay apart.
// The gate and the report both classify commits from this set.
export function caughtByDetectors(body) {
  return [...new Set(caughtByTrailerValues(body))];
}

// The scope token of a scoped fix subject (fix(<scope>): ...), or null when the
// subject is not a scoped fix.
export function fixScope(subject) {
  const match = subject.match(fixSubject);
  return match ? match[1] : null;
}

export function caughtByViolations(commits) {
  return commits.flatMap((commit) => {
    if (fixScope(commit.subject) === null) return [];
    return caughtByDetectors(commit.body).length === 1
      ? []
      : [`${commit.sha.slice(0, 12)} ${commit.subject} must name exactly one Caught-by detector`];
  });
}
