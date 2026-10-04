import "@/client/account/dom-test-harness";

import { afterEach, expect, spyOn, test } from "bun:test";
import type { ReviewBuild } from "@/stories/review/explorations/board/review-build";
import * as stories from "@/stories/review/explorations/library/stories";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { LibraryView } = await import("@/stories/review/explorations/library/library");
const originalUrl = location.href;
const build: ReviewBuild = { revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };
const storyIndex = Object.fromEntries(["Button", "Input", "Switch"].map((name) => {
  const id = `ui-${name.toLowerCase()}--default`;
  return [id, { id, title: `UI/${name}`, name: "Default", type: "story", importPath: `./components/ui/${name.toLowerCase()}.stories.tsx` }];
}));

afterEach(() => {
  cleanup();
  history.replaceState(history.state, "", originalUrl);
});

for (const action of ["hover", "focus"]) {
  test(`sidebar ${action} preloads that row and the next row without selecting`, () => {
    const load = spyOn(stories, "loadStoryModule").mockImplementation(async () => ({}));
    try {
      const url = new URL(location.href);
      url.searchParams.set("component", "foundations/color");
      history.replaceState(history.state, "", url);
      const view = render(<LibraryView build={build} storyIndex={storyIndex} frameSource="blank" />);
      load.mockClear();
      const input = view.getByRole("option", { name: "Input, 1 story" });
      if (action === "hover") fireEvent.mouseEnter(input);
      else fireEvent.focus(input);
      expect(load.mock.calls.map(([path]) => path)).toEqual([
        "./components/ui/input.stories.tsx", "./components/ui/switch.stories.tsx",
      ]);
      expect(view.getByRole("main", { name: "Color foundations" })).toBeTruthy();
      expect(input.getAttribute("aria-selected")).toBe("false");
    } finally { load.mockRestore(); }
  });
}
