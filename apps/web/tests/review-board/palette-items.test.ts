import { describe, expect, test } from "bun:test";
import { buildPaletteItems, rankPaletteItems } from "../../stories/review/explorations/board/palette-items";
import type { BoardCommand } from "../../stories/review/explorations/board/commands";
import type { Section } from "../../stories/review/explorations/board/layout";
import type { StoryIndexEntry } from "../../stories/review/explorations/board/review-build";

const entries: Record<string, StoryIndexEntry> = {
  "review-boards--savings": { id: "review-boards--savings", title: "Review/Boards", name: "Savings", type: "story", importPath: "board" },
  "review-boards--changes": { id: "review-boards--changes", title: "Review/Boards", name: "Changes", type: "story", importPath: "board" },
  "review-boards--docs": { id: "review-boards--docs", title: "Review/Boards", name: "Docs", type: "docs", importPath: "board" },
  "account-settings--default": { id: "account-settings--default", title: "Account/Settings", name: "Default", type: "story", importPath: "settings" },
  "save-growth--projection": { id: "save-growth--projection", title: "Save/Growth", name: "Projection", type: "story", importPath: "growth" },
  "save-growth--docs": { id: "save-growth--docs", title: "Save/Growth", name: "Docs", type: "docs", importPath: "growth" },
};
const rect = { x: 0, y: 0, width: 500, height: 600 };
const sections: Section[] = [{ id: "intro", title: "Introduction", rect, frames: [{
  id: "frame", story: "save-growth--projection", before: false,
  section: "Introduction", rect, frame: { id: "frame", label: "Opening", story: "save-growth--projection",
    viewport: { width: 390, height: 844 }, change: "new" },
}] }];

function fixture(index = entries) {
  const calls: string[] = [];
  const items = buildPaletteItems({
    commands: [{ id: "fit", group: "Canvas", label: "Fit", keys: ["F"], run: () => calls.push("fit") } satisfies BoardCommand],
    sections, index, boardId: "savings", selectFrame: (id) => calls.push(`frame:${id}`),
    fitSection: (section) => calls.push(`section:${section.id}`),
    navigate: (url, newTab) => calls.push(`${newTab ? "tab" : "same"}:${url}`),
  });
  return { items, calls };
}

describe("board palette items", () => {
  test("builds grouped navigation from index stories, excluding current board and docs", () => {
    const { items, calls } = fixture();
    expect(items.map((item) => item.group)).toEqual([
      "Commands", "Frames", "Sections", "Boards", "Stories", "Stories",
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "Fit", "Opening", "Go to section: Introduction", "Open board: Changes", "Default", "Projection",
    ]);
    items.find((item) => item.group === "Frames")?.run();
    items.find((item) => item.group === "Sections")?.run();
    items.find((item) => item.group === "Boards")?.run();
    items.find((item) => item.id === "story:save-growth--projection")?.run(true);
    expect(calls).toEqual(["frame:frame", "section:intro",
      "same:./iframe.html?id=review-boards--changes&viewMode=story",
      "tab:./?path=%2Fstory%2Fsave-growth--projection"]);
  });

  test("filters fuzzily within ordered groups, hides empty stories and caps matches by rank", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => {
      const id = `sample-${index}--navigation`;
      return [id, { id, name: `Navigation ${index}`, title: "Samples", type: "story", importPath: "samples" }];
    })) as Record<string, StoryIndexEntry>;
    const { items } = fixture({ ...entries, ...many });
    expect(rankPaletteItems("", items).some((item) => item.group === "Stories")).toBe(false);
    expect(rankPaletteItems("nav", items).filter((item) => item.group === "Stories")).toHaveLength(30);
    expect(rankPaletteItems("projection", items).map((item) => item.id)).toEqual(["story:save-growth--projection"]);
    expect(rankPaletteItems("fit", items)[0]?.group).toBe("Commands");
  });
});
