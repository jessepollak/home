import { describe, expect, test } from "bun:test";
import {
  readBoardUrl,
  revisionLink,
  storyCanvasUrl,
  storyManagerUrl,
  writeBoardUrl,
} from "../../stories/review/explorations/board/url-state";
describe("board links", () => {
  test("keeps story params and round-trips selection/revision", () => {
    const original = new URL(
      "https://example.test/iframe.html?id=review-boards--savings&viewMode=story&side=before",
    );
    const updated = writeBoardUrl(original, { frame: "funded", rev: "abc123", deployment: "example.test" });
    expect(updated.searchParams.get("id")).toBe("review-boards--savings");
    expect(updated.searchParams.get("viewMode")).toBe("story");
    expect(readBoardUrl(updated)).toEqual({
      frame: "funded",
      focus: undefined,
      side: "before",
      variant: undefined,
      rev: "abc123",
      deployment: "example.test",
    });
    expect(revisionLink("evil.test/path", updated)).toBeUndefined();
  });
  test("preserves side by side selection", () => {
    const url = writeBoardUrl(new URL("http://example.test/iframe.html"),
      { frame: "funded", side: "both", variant: "before" });
    expect(readBoardUrl(url)).toMatchObject({ frame: "funded", side: "both", variant: "before" });
    const changed = writeBoardUrl(url, { variant: undefined });
    expect(changed.searchParams.has("variant")).toBe(false);
    expect(readBoardUrl(new URL("http://example.test/iframe.html?variant=unknown")).variant)
      .toBeUndefined();
  });
  test("produces same-build story URLs", () => {
    expect(storyCanvasUrl("a--b")).toBe("./iframe.html?id=a--b&viewMode=story");
    expect(storyManagerUrl("a--b")).toBe("./?path=%2Fstory%2Fa--b");
    expect(readBoardUrl(new URL("http://example.test/")).side).toBe("after");
  });
});

test("focus survives frame and revision writes, with ordered deduplication", () => {
  const url = new URL("https://example.test/iframe.html?id=review-boards--changes&focus=foo--normal,other--narrow,foo--normal,,missing--story");
  expect(readBoardUrl(url).focus).toEqual(["foo--normal", "other--narrow", "missing--story"]);
  const updated = writeBoardUrl(url, { frame: "foo--normal", rev: "abc123", deployment: "example.test" });
  expect(updated.searchParams.get("focus")).toBe("foo--normal,other--narrow,foo--normal,,missing--story");
  expect(readBoardUrl(updated).focus).toEqual(["foo--normal", "other--narrow", "missing--story"]);
  expect(readBoardUrl(writeBoardUrl(updated, { focus: ["other--narrow", "foo--normal", "other--narrow"] })).focus)
    .toEqual(["other--narrow", "foo--normal"]);
  expect(readBoardUrl(writeBoardUrl(updated, { focus: [] })).focus).toBeUndefined();
});
