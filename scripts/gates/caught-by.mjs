import { spawnSync } from "node:child_process";

export const caughtByValues = ["lint", "bot", "review", "browser", "production"];

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function detectCommitRange({ cwd = process.cwd(), env = process.env } = {}) {
  if (!env.GITHUB_BASE_REF) return "HEAD^!";
  const remoteBase = `origin/${env.GITHUB_BASE_REF}`;
  const base = git(["merge-base", "HEAD", remoteBase], cwd);
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
  const trailer = new RegExp(`^Caught-by: (${caughtByValues.join("|")})$`, "m");
  return commits.flatMap((commit) => {
    if (!/^fix\([^)]+\):/.test(commit.subject)) return [];
    return trailer.test(commit.body)
      ? []
      : [`${commit.sha.slice(0, 12)} ${commit.subject} must include Caught-by: ${caughtByValues.join("|")}`];
  });
}
