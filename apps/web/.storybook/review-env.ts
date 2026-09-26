import { execFileSync } from "node:child_process";

function git(args: string[], timeout = 2_000): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function repoName(): string {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const name = process.env.VERCEL_GIT_REPO_SLUG;
  if (owner && name) return `${owner}/${name}`;
  const remote = git(["remote", "get-url", "origin"]);
  return remote?.match(/(?:github\.com[:/])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)?.[1] ?? "";
}

function prNumber(): string {
  if (process.env.VERCEL_GIT_PULL_REQUEST_ID) return process.env.VERCEL_GIT_PULL_REQUEST_ID;
  try {
    const value = execFileSync("gh", ["pr", "view", "--json", "number"], {
      encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const number: unknown = (JSON.parse(value) as { number?: unknown }).number;
    return Number.isSafeInteger(number) && (number as number) > 0 ? String(number) : "";
  } catch {
    return "";
  }
}

type Change = { path: string; status: "added" | "modified" };

function gitChanges(): Change[] | null {
  let base: string | null = null;
  for (const ref of ["origin/main", "main"]) {
    if (git(["rev-parse", "--verify", ref])) {
      base = git(["merge-base", ref, "HEAD"]);
      if (base) break;
    }
  }
  if (!base && process.env.VERCEL) {
    git(["fetch", "--depth=50", "origin", "main"], 5_000);
    base = git(["merge-base", "origin/main", "HEAD"]) ?? git(["merge-base", "FETCH_HEAD", "HEAD"]);
  }
  if (!base) return null;
  const output = git(["diff", "--name-status", "--diff-filter=ACMR", base + "...HEAD"]);
  if (output === null) return null;
  if (!output) return [];
  return output.split("\n").flatMap((line) => {
    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);
    return path ? [{ path, status: status === "A" ? "added" as const : "modified" as const }] : [];
  });
}

async function apiChanges(repo: string, pr: string): Promise<Change[] | null> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[1-9]\d*$/.test(pr)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const changes: Change[] = [];
    const headers = { Accept: "application/vnd.github+json" };
    for (let page = 1; page <= 100; page++) {
      const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`, {
        signal: controller.signal, headers,
      });
      if (!response.ok) return null;
      const files: unknown = await response.json();
      if (!Array.isArray(files) || !files.every((file) => typeof file.filename === "string" && typeof file.status === "string")) return null;
      changes.push(...files.filter((file) => file.status !== "removed").map((file) => ({
        path: file.filename as string, status: file.status === "added" ? "added" as const : "modified" as const,
      })));
      if (files.length < 100) return changes;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function reviewEnv(): Promise<Record<string, string>> {
  try {
    const repo = repoName();
    const pr = prNumber();
    const changes = (repo && pr ? await apiChanges(repo, pr) : null) ?? gitChanges();
    return {
      STORYBOOK_REVIEW_REVISION: process.env.VERCEL_GIT_COMMIT_SHA ?? git(["rev-parse", "HEAD"]) ?? "local",
      STORYBOOK_REVIEW_DEPLOYMENT: process.env.VERCEL_URL ?? "",
      STORYBOOK_REVIEW_BRANCH: process.env.VERCEL_GIT_COMMIT_REF ?? "",
      STORYBOOK_REVIEW_REPO: repo,
      STORYBOOK_REVIEW_PR: pr,
      STORYBOOK_REVIEW_CHANGED_FILES: changes === null ? "" : JSON.stringify(changes.map((change) => change.path)),
      STORYBOOK_REVIEW_ADDED_FILES: changes === null ? "" : JSON.stringify(changes.filter((change) => change.status === "added").map((change) => change.path)),
    };
  } catch {
    return {
      STORYBOOK_REVIEW_REVISION: "local", STORYBOOK_REVIEW_DEPLOYMENT: "", STORYBOOK_REVIEW_BRANCH: "",
      STORYBOOK_REVIEW_REPO: "", STORYBOOK_REVIEW_PR: "", STORYBOOK_REVIEW_CHANGED_FILES: "", STORYBOOK_REVIEW_ADDED_FILES: "",
    };
  }
}
