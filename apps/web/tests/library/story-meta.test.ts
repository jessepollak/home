import { describe, expect, test } from "bun:test";
import { requireStoryMeta } from "./fixtures/story-meta";

describe("story meta runtime guard", () => {
  test("accepts component and composition metadata", () => {
    expect(requireStoryMeta({ default: { title: "UI/Button", id: "ui-button" } }).id).toBe("ui-button");
    expect(requireStoryMeta({ default: { title: "UI/Button" } }).title).toBe("UI/Button");
    expect(requireStoryMeta({ default: { title: "Compositions/Home", parameters: { library: { render: "frame" } } } })
      .parameters?.library?.render).toBe("frame");
    expect(requireStoryMeta({ default: { title: "Compositions/Home", parameters: { library: { order: 1 } } } })
      .parameters?.library?.order).toBe(1);
  });

  for (const fixture of [null, {}, { default: null }, { default: { title: 7 } },
    { default: { title: "UI/Button", id: 7 } }, { default: { title: "UI/Button", parameters: "frame" } },
    { default: { title: "UI/Button", parameters: { library: "frame" } } },
    { default: { title: "UI/Button", parameters: { library: { render: 7 } } } },
    { default: { title: "Compositions/Home", parameters: { library: { order: "1" } } } },
    { default: { title: "Compositions/Home", parameters: { library: { order: Infinity } } } }]) {
    test(`rejects invalid metadata: ${JSON.stringify(fixture)}`, () => {
      expect(() => requireStoryMeta(fixture)).toThrow();
    });
  }
});
