import { describe, expect, test } from "bun:test";
import { changeLabel, parseBoard } from "../../stories/review/explorations/board/manifest";
const fixture = {
  id: "b",
  title: "Board",
  summary: "Summary",
  sections: [
    {
      id: "s",
      title: "Section",
      frames: [{ id: "f", story: "story-id", label: "Frame", viewport: "mobile", change: "new" }],
    },
  ],
};
describe("board manifest", () => {
  test("capitalizes every change marker", () => {
    expect(["new", "changed", "unchanged"].map((change) =>
      changeLabel(change as "new" | "changed" | "unchanged")))
      .toEqual(["New", "Changed", "Unchanged"]);
  });
  test("resolves viewports and preserves metadata", () => {
    expect(parseBoard(fixture).sections[0].frames[0].viewport).toEqual({ width: 390, height: 844 });
    expect(
      parseBoard({
        ...fixture,
        sections: [
          {
            ...fixture.sections[0],
            frames: [{ ...fixture.sections[0].frames[0], viewport: { width: 420, height: 320 } }],
          },
        ],
      }).sections[0].frames[0].viewport.width,
    ).toBe(420);
  });
  test("rejects duplicate frame ids across sections", () => {
    expect(() =>
      parseBoard({
        ...fixture,
        sections: [...fixture.sections, { id: "other", title: "Other", frames: fixture.sections[0].frames }],
      }),
    ).toThrow("Duplicate frame id: f");
  });
  test.each([
    [{ ...fixture.sections[0].frames[0], story: "" }, "missing story"],
    [{ ...fixture.sections[0].frames[0], viewport: "tablet" }, "Unknown viewport key"],
    [{ ...fixture.sections[0].frames[0], change: "changedish" }, "Bad change"],
  ])("rejects invalid frame %p", (frame, message) => {
    expect(() => parseBoard({ ...fixture, sections: [{ ...fixture.sections[0], frames: [frame] }] })).toThrow(
      message,
    );
  });
});
