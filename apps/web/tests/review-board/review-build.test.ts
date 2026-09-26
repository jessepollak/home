import { afterEach, beforeEach, expect, test, mock } from "bun:test";
import { changesBoard, fetchPrStatus, hasChangeData, markBuildChanges, prUrl, readReviewBuild, resolveBoard, type ReviewBuild, type StoryIndexEntry } from "../../stories/review/explorations/board/review-build";
import { parseBoard } from "../../stories/review/explorations/board/manifest";

const build: ReviewBuild = { revision: "abc1234", deployment: "", branch: "", repo: { owner: "example", name: "home" }, pr: 999, changedFiles: [] };
const entries: Record<string, StoryIndexEntry> = {
  "foo--normal": { id: "foo--normal", title: "UI/Foo", name: "Normal", importPath: "./client/foo.stories.tsx", type: "story" },
  "foo--desktop": { id: "foo--desktop", title: "UI/Foo", name: "Desktop", importPath: "./client/foo.stories.tsx", type: "story" },
  "other--narrow": { id: "other--narrow", title: "UI/Other", name: "Narrow", importPath: "./client/other.stories.tsx", type: "story" },
  "review-boards--changes": { id: "review-boards--changes", title: "Review/Boards", name: "Changes", importPath: "./stories/review/review-boards.stories.tsx", type: "story" },
  "foo--docs": { id: "foo--docs", title: "UI/Foo", name: "Docs", importPath: "./client/foo.stories.tsx", type: "docs" },
};

test("reads validated review identity and distinguishes unknown from no changes", () => {
  const parsed = readReviewBuild({ STORYBOOK_REVIEW_REPO: "example/home", STORYBOOK_REVIEW_PR: "999", STORYBOOK_REVIEW_CHANGED_FILES: "[]", STORYBOOK_REVIEW_ADDED_FILES: "[]" });
  expect(parsed).toMatchObject({ repo: { owner: "example", name: "home" }, pr: 999, changedFiles: [], addedFiles: [] });
  expect(hasChangeData(parsed)).toBe(true);
  expect(prUrl(parsed)).toBe("https://github.com/example/home/pull/999");
  expect(readReviewBuild({ STORYBOOK_REVIEW_REPO: "bad/name/extra", STORYBOOK_REVIEW_PR: "0", STORYBOOK_REVIEW_CHANGED_FILES: "garbage" })).toMatchObject({ repo: null, pr: null, changedFiles: null, addedFiles: null });
  expect(hasChangeData(readReviewBuild({}))).toBe(false);
  expect(readReviewBuild({ STORYBOOK_REVIEW_PR: "1.5", STORYBOOK_REVIEW_CHANGED_FILES: "[5]" }).pr).toBeNull();
});

test("resolves only present stories, removes missing before and empty sections without mutating input", () => {
  const board = parseBoard({ id: "fixture", title: "Fixture", summary: "Review", sections: [
    { id: "one", title: "One", frames: [
      { id: "missing", story: "gone--normal", label: "Gone", viewport: "mobile", change: "new" },
      { id: "present", story: "foo--normal", before: "gone--before", label: "Normal", viewport: "mobile", change: "changed" },
    ] },
    { id: "two", title: "Two", frames: [{ id: "gone", story: "gone--other", label: "Gone", viewport: "desktop", change: "new" }] },
  ] });
  const resolved = resolveBoard(board, entries);
  expect(resolved?.sections.map((section) => section.id)).toEqual(["one"]);
  expect(resolved?.sections[0].frames).toMatchObject([{ id: "present", story: "foo--normal" }]);
  expect(resolved?.sections[0].frames[0].before).toBeUndefined();
  expect(board.sections[0].frames[1].before).toBe("gone--before");
  expect(resolveBoard(board, {})).toBeNull();
});

test("builds matching story sections from changed stories and sibling source files", () => {
  const board = changesBoard({ ...build, changedFiles: ["apps/web/client/foo.tsx", "apps/web/client/other.stories.tsx", "apps/web/stories/review/review-boards.stories.tsx"], addedFiles: ["apps/web/client/other.stories.tsx"] }, entries);
  expect(board?.title).toBe("PR #999 changes");
  expect(board?.sections.map((section) => section.title)).toEqual(["UI/Foo", "UI/Other"]);
  expect(board?.sections[0].frames.map((frame) => [frame.story, frame.change, frame.viewport.width])).toEqual([
    ["foo--normal", "changed", 390], ["foo--desktop", "changed", 1440],
  ]);
  expect(board?.sections[1].frames.map((frame) => [frame.story, frame.change, frame.viewport.width])).toEqual([["other--narrow", "new", 320]]);
  expect(board?.sections.flatMap((section) => section.frames).some((frame) => frame.story === "review-boards--changes")).toBe(false);
});

test("does not invent an automatic board for unknown changes or unrelated files", () => {
  expect(changesBoard({ ...build, changedFiles: null }, entries)).toBeNull();
  expect(changesBoard({ ...build, changedFiles: ["apps/web/client/different.tsx"] }, entries)).toBeNull();
});

test("marks board frames changed or new from the build's changed and added files", () => {
  const board = parseBoard({ id: "fixture", title: "Fixture", summary: "Review", sections: [
    { id: "one", title: "One", frames: [
      { id: "source", story: "foo--normal", label: "Normal", viewport: "mobile", change: "unchanged" },
      { id: "added", story: "other--narrow", label: "Narrow", viewport: "narrow", change: "unchanged" },
      { id: "manual", story: "review-boards--changes", label: "Manual", viewport: "desktop", change: "new" },
      { id: "missing", story: "gone--normal", label: "Gone", viewport: "mobile", change: "unchanged" },
    ] },
  ] });
  const marked = markBuildChanges(board, { ...build, changedFiles: ["apps/web/client/foo.tsx", "apps/web/client/other.stories.tsx"], addedFiles: ["apps/web/client/other.stories.tsx"] }, entries);
  expect(marked.sections[0].frames.map((frame) => [frame.id, frame.change])).toEqual([
    ["source", "changed"], ["added", "new"], ["manual", "new"], ["missing", "unchanged"],
  ]);
  expect(board.sections[0].frames[0].change).toBe("unchanged");
  expect(markBuildChanges(board, { ...build, changedFiles: null }, entries)).toBe(board);
});

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("reads draft and checks, then reuses session cache and recomputes current for the build", async () => {
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return response(String(input).includes("check-runs") ? { check_runs: [{ status: "completed", conclusion: "success" }] } :
      { title: "Review", state: "open", draft: true, merged_at: null, head: { sha: "abc123456789" } });
  }) as unknown as typeof fetch;
    expect(await fetchPrStatus(build)).toMatchObject({ state: "draft", current: true, checks: "passing", number: 999 });
    expect(await fetchPrStatus({ ...build, revision: "different" })).toMatchObject({ current: false, checks: "passing" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("https://api.github.com/repos/example/home/pulls/999");
});

test("maps merged and failing checks and returns null on failed API responses", async () => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => String(input).includes("check-runs") ? response({ check_runs: [
    { status: "completed", conclusion: "failure" }, { status: "in_progress", conclusion: null },
  ] }) : response({ title: "Merged", state: "closed", draft: false, merged_at: "2026-01-01", head: { sha: "abc123456789" } })) as unknown as typeof fetch;
  expect(await fetchPrStatus(build)).toMatchObject({ state: "merged", checks: "failing" });
  storage.clear();
  globalThis.fetch = mock(async () => response({}, 403)) as unknown as typeof fetch;
  expect(await fetchPrStatus(build)).toBeNull();
});

test("reports pending or no checks and respects an aborted signal", async () => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => String(input).includes("check-runs") ? response({ check_runs: [{ status: "in_progress", conclusion: null }] }) : response({ title: "Open", state: "open", draft: false, merged_at: null, head: { sha: "abc123456789" } })) as unknown as typeof fetch;
  expect((await fetchPrStatus(build))?.checks).toBe("pending");
  storage.clear();
  globalThis.fetch = mock(async (input: RequestInfo | URL) => String(input).includes("check-runs") ? response({ check_runs: [] }) : response({ title: "Open", state: "open", draft: false, merged_at: null, head: { sha: "abc123456789" } })) as unknown as typeof fetch;
  expect((await fetchPrStatus(build))?.checks).toBe("none");
  storage.clear();
  const controller = new AbortController(); controller.abort();
  expect(await fetchPrStatus(build, controller.signal)).toBeNull();
});
