export function toggleFocus(current: string | null, story: string): string | null {
  return current === story ? null : story;
}

export function restoredFocus(linked: string | undefined, stories: readonly string[]): string | null {
  return linked && stories.includes(linked) ? linked : null;
}

export type FrameSlots = { request: (id: string, grant: () => void) => () => void };

export function createFrameSlots(limit: number): FrameSlots {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Frame slots must be positive");
  const active = new Set<string>();
  const waiting: Array<{ id: string; grant: () => void }> = [];
  const drain = () => {
    while (active.size < limit && waiting.length) {
      const next = waiting.shift()!;
      active.add(next.id);
      next.grant();
    }
  };
  return {
    request(id, grant) {
      const ticket = { id, grant };
      waiting.push(ticket);
      drain();
      return () => {
        const index = waiting.indexOf(ticket);
        if (index >= 0) waiting.splice(index, 1);
        else if (active.delete(id)) drain();
      };
    },
  };
}

export const FRAME_WIDTH = 390;
export const FRAME_MIN_HEIGHT = 160;
export const FRAME_MAX_HEIGHT = 844;
const FRAME_PADDING = 48;

export function fittedFrameHeight(content: number, portals: boolean): number {
  if (portals || !Number.isFinite(content)) return FRAME_MAX_HEIGHT;
  return Math.round(Math.min(FRAME_MAX_HEIGHT, Math.max(FRAME_MIN_HEIGHT, content + FRAME_PADDING)));
}
