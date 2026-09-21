import { spawnSync } from "node:child_process";

export const caughtByValues = ["lint", "bot", "review", "browser", "production"];

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

// Every well-formed Caught-by trailer value in a commit body. The provenance
// gate accepts a commit only when exactly one value matches.
export function caughtByTrailerValues(body) {
  return [...body.matchAll(caughtByTrailer)].map((match) => match[1]);
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
    return caughtByTrailerValues(commit.body).length === 1
      ? []
      : [`${commit.sha.slice(0, 12)} ${commit.subject} must include exactly one Caught-by trailer`];
  });
}
