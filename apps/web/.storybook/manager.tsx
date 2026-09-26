import { createElement } from "react";
import { Button } from "storybook/internal/components";
import { addons, types, useStorybookState } from "storybook/manager-api";
import { changesBoard, type ReviewBuild, type StoryIndexEntry } from "../stories/review/explorations/board/review-build";

declare global {
  interface Window { __REVIEW_BUILD__?: ReviewBuild }
}

function ReviewBoardLink() {
  const { index } = useStorybookState();
  const build = window.__REVIEW_BUILD__;
  const hasChanges = build && index && changesBoard(build, index as unknown as Record<string, StoryIndexEntry>);
  const board = [hasChanges ? "review-boards--changes" : null, "review-boards--savings"].find((id) => id && index?.[id]);
  if (!board) return null;
  return createElement(Button, { asChild: true, padding: "small", variant: "ghost", ariaLabel: false },
    createElement("a", { href: `./iframe.html?id=${board}&viewMode=story` }, "Review board"));
}

addons.register("home/review-board", () => {
  addons.add("home/review-board/link", {
    type: types.TOOL,
    title: "Review board",
    render: () => createElement(ReviewBoardLink),
  });
});
