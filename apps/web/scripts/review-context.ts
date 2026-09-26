import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { storyViewport, type StoryIndexEntry } from "../stories/review/explorations/board/review-build";

export type ReviewManifest = {
  id: string;
  title: string;
  summary: string;
  refs?: { issue?: number; pr?: number };
  sections: {
    id: string;
    title: string;
    note?: string;
    frames: {
      id: string;
      story: string;
      label: string;
      viewport: "mobile" | "narrow" | "desktop" | { width: number; height: number };
      change: "changed" | "new" | "unchanged";
      note?: string;
      before?: string;
    }[];
  }[];
};

type Side = "after" | "before" | "both";
type ChangeStatus = "yes" | "no" | "unknown";

export function parseReviewUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Malformed review URL: expected an absolute Storybook iframe URL");
  }
  const id = url.searchParams.get("id") ?? "";
  const board = id.match(/^review-boards--([a-z0-9]+(?:-[a-z0-9]+)*)$/)?.[1];
  const frame = url.searchParams.get("frame");
  const side = url.searchParams.get("side") ?? "after";
  const variant: "before" | undefined = side === "both" && url.searchParams.get("variant") === "before"
    ? "before" : undefined;
  if (!(["https:", "http:"].includes(url.protocol) && url.pathname === "/iframe.html" && board && frame && (side === "after" || side === "before" || side === "both"))) {
    throw new Error("Malformed review URL: expected /iframe.html?id=review-boards--<board>&frame=<frame>&side=after|before|both");
  }
  const deployment = url.searchParams.get("deployment");
  let origin = url.origin;
  if (deployment) {
    if (!/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(deployment)) throw new Error("Malformed review URL: invalid deployment host");
    const candidate = new URL(`${url.protocol}//${deployment}`);
    if (!candidate.hostname) throw new Error("Malformed review URL: invalid deployment host");
    origin = candidate.origin;
  }
  return { board, frame, side: side as Side, variant, rev: url.searchParams.get("rev") || null, origin };
}

export function resolveFrame(manifest: ReviewManifest, frameId: string, side: Side, variant?: "before") {
  const section = manifest.sections.find((entry) => entry.frames.some((frame) => frame.id === frameId));
  const frame = section?.frames.find((entry) => entry.id === frameId);
  if (!section || !frame) throw new Error(`Unknown frame "${frameId}" on board "${manifest.id}"`);
  const viewport = typeof frame.viewport === "string" ? {
    mobile: { width: 390, height: 844 },
    narrow: { width: 320, height: 700 },
    desktop: { width: 1440, height: 900 },
  }[frame.viewport] : frame.viewport;
  if (!viewport || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error(`Invalid viewport for frame "${frameId}"`);
  }
  return {
    section: section.title,
    sectionNote: section.note ?? null,
    label: frame.label,
    story: (side === "before" || (side === "both" && variant === "before")) && frame.before
      ? frame.before : frame.story,
    viewport: `${viewport.width}x${viewport.height}`,
    change: frame.change,
    note: frame.note ?? null,
    stories: side === "both" ? { after: frame.story, before: frame.before ?? null } : undefined,
  };
}

export function changesReviewManifest(
  parsed: ReturnType<typeof parseReviewUrl>, entries: Record<string, StoryIndexEntry>,
): ReviewManifest {
  if (parsed.board !== "changes") throw new Error(`Unknown automatic board "${parsed.board}"`);
  const story = entries[parsed.frame];
  if (story?.type !== "story" || story.id !== parsed.frame || /^review-boards--/.test(story.id))
    throw new Error(`Unknown story frame "${parsed.frame}" in the story index`);
  return {
    id: "changes", title: "Changes in this PR", summary: "Stories for files changed in this build.",
    sections: [{ id: "stories", title: "Changed stories", frames: [{
      id: story.id, story: story.id, label: story.name,
      viewport: storyViewport(story),
      change: "changed",
    }] }],
  };
}

export function buildReviewContext(
  parsed: ReturnType<typeof parseReviewUrl>,
  manifest: ReviewManifest,
  source: string | null,
  head: string,
  manifestChanged: ChangeStatus,
  sourceChanged: ChangeStatus,
) {
  if (manifest.id !== parsed.board) throw new Error(`Unknown board "${parsed.board}" (manifest id does not match)`);
  const { variant } = parsed;
  const frame = resolveFrame(manifest, parsed.frame, parsed.side, variant);
  const story = encodeURIComponent(frame.story);
  const board = new URL("/iframe.html", parsed.origin);
  board.searchParams.set("id", `review-boards--${parsed.board}`);
  board.searchParams.set("viewMode", "story");
  board.searchParams.set("frame", parsed.frame);
  board.searchParams.set("side", parsed.side);
  if (variant) board.searchParams.set("variant", variant);
  if (parsed.rev) board.searchParams.set("rev", parsed.rev);
  board.searchParams.set("deployment", new URL(parsed.origin).host);
  const outdated = manifestChanged === "yes" || sourceChanged === "yes" ? "yes" :
    manifestChanged === "unknown" || sourceChanged === "unknown" ? "unknown" : "no";
  return {
    board: { id: manifest.id, title: manifest.title, summary: manifest.summary, refs: manifest.refs },
    frame: { id: parsed.frame, side: parsed.side, variant, ...frame },
    source: source ?? "build Storybook to resolve the source file",
    revision: { reviewed: parsed.rev, head, manifestChanged, sourceChanged, outdated },
    urls: {
      canvas: `${parsed.origin}/iframe.html?id=${story}&viewMode=story`,
      manager: `${parsed.origin}/?path=/story/${story}`,
      board: board.toString(),
    },
  };
}

export function formatReviewContext(context: ReturnType<typeof buildReviewContext>) {
  const { board, frame, revision, urls } = context;
  return [
    `Board: ${board.title} (${board.id})${board.refs?.issue ? `  issue #${board.refs.issue}` : ""}${board.refs?.pr ? `  PR #${board.refs.pr}` : ""}`,
    `Frame: ${frame.section} / ${frame.label} (${frame.id}, ${frame.side}${frame.variant ? `, ${frame.variant} variant` : ""})`,
    `Story: ${frame.story}  viewport: ${frame.viewport}  change: ${frame.change}`,
    ...(frame.stories ? [`Stories: after ${frame.stories.after}  before ${frame.stories.before ?? "none"}`] : []),
    ...(frame.sectionNote ? [`Section note: ${frame.sectionNote}`] : []),
    ...(frame.note ? [`Frame note: ${frame.note}`] : []),
    `Source: ${context.source}`,
    `Revision: reviewed ${revision.reviewed ?? "missing"}  HEAD ${revision.head}`,
    `Changed: manifest ${revision.manifestChanged}  source ${revision.sourceChanged}  outdated: ${revision.outdated}`,
    `Canvas: ${urls.canvas}`,
    `Manager: ${urls.manager}`,
    `Board: ${urls.board}`,
  ].join("\n");
}

function git(...args: string[]) {
  return Bun.spawnSync(["git", ...args], { cwd: resolve(import.meta.dir, "../../.."), stdout: "pipe", stderr: "pipe" });
}

function gitText(...args: string[]) {
  const result = git(...args);
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

function changed(rev: string | null, head: string, path: string | null): ChangeStatus {
  if (!rev || !path) return "unknown";
  const result = git("diff", "--quiet", rev, head, "--", path);
  return result.exitCode === 0 ? "no" : result.exitCode === 1 ? "yes" : "unknown";
}

function repoPath(path: string) {
  const relativePath = relative(resolve(import.meta.dir, "../../.."), path);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.startsWith(sep) ? null : relativePath;
}

function readOptions(args: string[]) {
  let url: string | undefined;
  let json = false;
  let atRevision = false;
  let boards = resolve(import.meta.dir, "../stories/review/boards");
  let index = resolve(import.meta.dir, "../storybook-static/index.json");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--at-revision") atRevision = true;
    else if (arg === "--boards" || arg === "--index") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--boards") boards = resolve(process.cwd(), value);
      else index = resolve(process.cwd(), value);
    } else if (!arg.startsWith("-") && !url) url = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!url) throw new Error("Usage: bun run --cwd apps/web review:context <url> [--json] [--boards <dir>] [--index <index.json path>] [--at-revision]");
  return { url, json, atRevision, boards, index };
}

function main() {
  const options = readOptions(process.argv.slice(2));
  const parsed = parseReviewUrl(options.url);
  const head = gitText("rev-parse", "HEAD");
  if (!head) throw new Error("Cannot determine current git HEAD");
  const validRev = parsed.rev && /^[0-9a-fA-F]{7,64}$/.test(parsed.rev) && git("cat-file", "-e", `${parsed.rev}^{commit}`).exitCode === 0 ? parsed.rev : null;
  if (options.atRevision && !validRev) throw new Error("--at-revision requires a rev available in local git");
  const manifestPath = parsed.board === "changes" ? null : resolve(options.boards, `${parsed.board}.json`);
  const path = manifestPath ? repoPath(manifestPath) : null;
  const historical = validRev && path ? gitText("show", `${validRev}:${path}`) : null;
  const contents = historical ?? (options.atRevision ? null : manifestPath && existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null);
  if (parsed.board !== "changes" && !contents) throw new Error(`Unknown board "${parsed.board}": manifest not found at ${manifestPath}${parsed.rev ? ` or revision ${parsed.rev}` : ""}`);
  const index = existsSync(options.index)
    ? JSON.parse(readFileSync(options.index, "utf8")) as { entries?: Record<string, StoryIndexEntry> } : null;
  if (parsed.board === "changes" && !index?.entries)
    throw new Error(`Story index unavailable for Changes board: build Storybook or pass --index <index.json path>`);
  const manifest = parsed.board === "changes" ? changesReviewManifest(parsed, index!.entries!) : JSON.parse(contents!) as ReviewManifest;
  const frame = resolveFrame(manifest, parsed.frame, parsed.side, parsed.variant);
  let source: string | null = null;
  const importPath = index?.entries?.[frame.story]?.importPath;
  if (importPath) {
    const candidate = resolve(import.meta.dir, "..", importPath);
    const located = repoPath(candidate);
    if (located?.startsWith("apps/web/")) source = located;
  }
  const context = buildReviewContext(parsed, manifest, source, head, path ? changed(validRev, head, path) : "no", changed(validRev, head, source));
  console.log(options.json ? JSON.stringify(context, null, 2) : formatReviewContext(context));
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
