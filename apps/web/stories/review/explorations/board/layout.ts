import { FRAME_HEADROOM, type Rect, type Size } from "./camera";
import type { BoardFrame, ReviewBoard } from "./manifest";

export type Side = "after" | "before" | "both";
export type Positioned = {
  frame: BoardFrame;
  section: string;
  story: string;
  id: string;
  before: boolean;
  rect: Rect;
};
export type Section = { id: string; title: string; note?: string; rect: Rect; frames: Positioned[] };

export function layout(board: ReviewBoard, side: Side): { sections: Section[]; size: Size } {
  let y = 48;
  let maxWidth = 0;
  const sections = board.sections.map((section) => {
    let x = 96;
    let height = 0;
    const frames = section.frames.flatMap((frame) => {
      const variants = side === "both" && frame.before
        ? [{ story: frame.before, before: true }, { story: frame.story, before: false }]
        : [{
          story: side === "before" && frame.before ? frame.before : frame.story,
          before: side === "before" && !!frame.before,
        }];
      return variants.map(({ story, before }) => {
        const positioned = {
          frame,
          section: section.title,
          story,
          before,
          id: before ? `${frame.id}:before` : frame.id,
          rect: { x, y: y + FRAME_HEADROOM, width: frame.viewport.width, height: frame.viewport.height },
        };
        x += frame.viewport.width + 96;
        height = Math.max(height, frame.viewport.height);
        return positioned;
      });
    });
    const rect = { x: 48, y, width: x, height: height + FRAME_HEADROOM + 64 };
    maxWidth = Math.max(maxWidth, rect.x + rect.width);
    y += rect.height + 220;
    return { id: section.id, title: section.title, note: section.note, rect, frames };
  });
  return { sections, size: { width: maxWidth + 48, height: y - 172 } };
}
