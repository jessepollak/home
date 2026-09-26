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
