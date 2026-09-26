import type { ReviewBoard } from "./manifest";
import { viewports } from "./manifest";

export type ReviewBuild = {
  revision: string;
  deployment: string;
  branch: string;
  repo: { owner: string; name: string } | null;
  pr: number | null;
  changedFiles: string[] | null;
  addedFiles?: string[] | null;
};

export type StoryIndexEntry = { id: string; title: string; name: string; importPath: string; type: string; tags?: string[] };

export function storyViewport(story: Pick<StoryIndexEntry, "id" | "name">): keyof typeof viewports {
  const label = `${story.id} ${story.name}`;
  return /desktop/i.test(label) ? "desktop" : /narrow/i.test(label) ? "narrow" : "mobile";
}

export type PrStatus = {
  number: number;
  url: string;
  title: string;
  state: "draft" | "open" | "merged" | "closed";
  headSha: string;
  current: boolean;
  checks: "passing" | "failing" | "pending" | "none";
};

function fileList(input: string | undefined): string[] | null {
  if (input === undefined || input === "") return null;
  try {
    const value: unknown = JSON.parse(input);
    return Array.isArray(value) && value.every((file) => typeof file === "string") ? value : null;
  } catch {
    return null;
  }
}

export function readReviewBuild(env: Record<string, string | undefined>): ReviewBuild {
  const repo = env.STORYBOOK_REVIEW_REPO?.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  const pr = env.STORYBOOK_REVIEW_PR;
  const number = pr && /^\d+$/.test(pr) ? Number(pr) : NaN;
  return {
    revision: env.STORYBOOK_REVIEW_REVISION ?? "local",
    deployment: env.STORYBOOK_REVIEW_DEPLOYMENT ?? "",
    branch: env.STORYBOOK_REVIEW_BRANCH ?? "",
    repo: repo ? { owner: repo[1], name: repo[2] } : null,
    pr: Number.isSafeInteger(number) && number > 0 ? number : null,
    changedFiles: fileList(env.STORYBOOK_REVIEW_CHANGED_FILES),
    addedFiles: fileList(env.STORYBOOK_REVIEW_ADDED_FILES),
  };
}

export function hasChangeData(build: ReviewBuild): build is ReviewBuild & { changedFiles: string[] } {
  return build.changedFiles !== null;
}

export function prUrl(build: ReviewBuild): string | null {
  return build.repo && build.pr ? `https://github.com/${build.repo.owner}/${build.repo.name}/pull/${build.pr}` : null;
}

type Pull = { title: string; state: string; draft: boolean; merged_at: string | null; head: { sha: string } };
type CheckRun = { status: string; conclusion: string | null };

export async function fetchPrStatus(build: ReviewBuild, signal?: AbortSignal): Promise<PrStatus | null> {
  const url = prUrl(build);
  if (!url || signal?.aborted) return null;
  const key = `review-pr:${build.repo!.owner}/${build.repo!.name}#${build.pr}`;
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const value = JSON.parse(cached) as { at: number; status: PrStatus };
      if (Date.now() - value.at < 60_000 && value.at <= Date.now() && value.status?.headSha) {
        return { ...value.status, current: value.status.headSha.startsWith(build.revision) };
      }
    }
  } catch { /* sessionStorage may be disabled or unavailable */ }
  try {
    const api = `https://api.github.com/repos/${build.repo!.owner}/${build.repo!.name}`;
    const options = { headers: { Accept: "application/vnd.github+json" }, signal };
    const response = await fetch(`${api}/pulls/${build.pr}`, options);
    if (!response.ok) return null;
    const pull = await response.json() as Pull;
    if (typeof pull.title !== "string" || typeof pull.head?.sha !== "string" || !/^[a-f0-9]{7,64}$/i.test(pull.head.sha)) return null;
    const runs: CheckRun[] = [];
    for (let page = 1; page <= 100; page++) {
      const checksResponse = await fetch(`${api}/commits/${pull.head.sha}/check-runs?per_page=100&page=${page}`, options);
      if (!checksResponse.ok) return null;
      const checks = await checksResponse.json() as { check_runs: CheckRun[] };
      if (!Array.isArray(checks.check_runs)) return null;
      runs.push(...checks.check_runs);
      if (checks.check_runs.length < 100) break;
      if (page === 100) return null;
    }
    const checks = runs.length === 0 ? "none" :
      runs.some((run) => ["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(run.conclusion ?? "")) ? "failing" :
      runs.some((run) => run.status !== "completed") ? "pending" :
      runs.every((run) => ["success", "neutral", "skipped"].includes(run.conclusion ?? "")) ? "passing" : "pending";
    const state = pull.merged_at ? "merged" : pull.state === "closed" ? "closed" : pull.draft ? "draft" : "open";
    const status: PrStatus = {
      number: build.pr!, url, title: pull.title, state, headSha: pull.head.sha,
      current: pull.head.sha.startsWith(build.revision), checks,
    };
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), status })); } catch { /* storage is optional */ }
    return status;
  } catch {
    return null;
  }
}

export function resolveBoard(board: ReviewBoard, entries: Record<string, StoryIndexEntry>): ReviewBoard | null {
  const sections = board.sections.map((section) => ({
    ...section,
    frames: section.frames.filter((frame) => entries[frame.story]?.type === "story")
      .map((frame) => frame.before && entries[frame.before]?.type !== "story" ? { ...frame, before: undefined } : frame),
  })).filter((section) => section.frames.length > 0);
  return sections.length ? { ...board, sections } : null;
}

function storyPath(importPath: string): string {
  const path = importPath.replace(/^\.\//, "");
  return path.startsWith("apps/web/") ? path : `apps/web/${path}`;
}

function storyStem(path: string): string {
  return path.replace(/\.[^.\/]+$/, "").replace(/\.stories$/, "");
}

function buildChanges(build: ReviewBuild): ((entry: StoryIndexEntry) => "new" | "changed" | null) | null {
  if (!hasChangeData(build)) return null;
  const changed = new Set(build.changedFiles);
  const stems = new Set(build.changedFiles.filter((path) => !/\.stories\.[^/]+$/.test(path)).map(storyStem));
  const added = new Set(build.addedFiles ?? []);
  return (entry) => {
    const path = storyPath(entry.importPath);
    if (!/\.stories\.[^/]+$/.test(path) || !(changed.has(path) || stems.has(storyStem(path)))) return null;
    return added.has(path) ? "new" : "changed";
  };
}

export function markBuildChanges(board: ReviewBoard, build: ReviewBuild, entries: Record<string, StoryIndexEntry>): ReviewBoard {
  const change = buildChanges(build);
  if (!change) return board;
  return {
    ...board,
    sections: board.sections.map((section) => ({
      ...section,
      frames: section.frames.map((frame) => {
        const entry = entries[frame.story];
        if (frame.change !== "unchanged") return frame;
        const derived = entry?.type === "story" && entry.importPath ? change(entry) : null;
        return derived ? { ...frame, change: derived } : frame;
      }),
    })),
  };
}

export function changesBoard(build: ReviewBuild, entries: Record<string, StoryIndexEntry>): ReviewBoard | null {
  const change = buildChanges(build);
  if (!change) return null;
  const groups = new Map<string, { story: StoryIndexEntry; change: "new" | "changed" }[]>();
  for (const entry of Object.values(entries)) {
    if (entry.type !== "story" || /^review-boards--/.test(entry.id)) continue;
    const kind = change(entry);
    if (!kind) continue;
    const group = groups.get(entry.title) ?? [];
    group.push({ story: entry, change: kind });
    groups.set(entry.title, group);
  }
  if (groups.size === 0) return null;
  return {
    id: "changes",
    title: build.pr ? `PR #${build.pr} changes` : "Changes in this PR",
    summary: "Stories for files changed in this build.",
    refs: build.pr ? { pr: build.pr } : undefined,
    sections: Array.from(groups, ([title, stories], index) => ({
      id: `stories-${index + 1}`,
      title,
      frames: stories.map(({ story, change }) => ({
        id: story.id,
        story: story.id,
        label: story.name,
        viewport: viewports[storyViewport(story)],
        change,
      })),
    })),
  };
}
