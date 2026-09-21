import { spawnSync } from "node:child_process";

export const caughtByValues = ["lint", "bot", "review", "browser", "production"];

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

export function readCommitsForRange(range, cwd = process.cwd()) {
  const output = git(["log", range, "--format=%H%x1f%s%x1f%B%x1e"], cwd);
  if (!output) return [];
  return output.split("\x1e").flatMap((entry) => {
    const clean = entry.trim();
    if (!clean) return [];
    const [sha = "", subject = "", body = ""] = clean.split("\x1f");
    return [{ sha, subject, body }];
  });
}

export function caughtByViolations(commits) {
  const trailer = new RegExp(`^Caught-by: (${caughtByValues.join("|")})$`, "gm");
  return commits.flatMap((commit) => {
    if (!/^fix\([^)]+\):/.test(commit.subject)) return [];
    return [...commit.body.matchAll(trailer)].length === 1
      ? []
      : [`${commit.sha.slice(0, 12)} ${commit.subject} must include exactly one Caught-by trailer`];
  });
}
