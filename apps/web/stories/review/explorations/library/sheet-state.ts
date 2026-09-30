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

export type FrameViewport = { width: number; height: number };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function pixels(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:px)?$/.test(value)) return Number.NaN;
  return Number.parseFloat(value);
}

export function declaredViewport(parameters: Record<string, unknown>, globals: Record<string, unknown> = {}): FrameViewport | undefined {
  const settings = record(parameters.viewport);
  if (settings.disable === true) return undefined;
  const global = globals.viewport;
  const selection = typeof global === "string" ? global : record(global).value;
  const name = selection ?? settings.defaultViewport;
  if (typeof name !== "string") return undefined;
  const options = { ...record(settings.viewports), ...record(settings.options) };
  const styles = record(record(options[name]).styles);
  const width = pixels(styles.width);
  const height = pixels(styles.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const viewport = record(global).isRotated === true ? { width: height, height: width } : { width, height };
  return viewport.width >= 768 ? viewport : undefined;
}

export function scaledViewport(viewport: FrameViewport, available: number): FrameViewport & { scale: number } {
  const width = Number.isFinite(available) && available > 0 ? available : FRAME_WIDTH;
  const scale = Math.min(1, width / viewport.width);
  return { width: viewport.width * scale, height: viewport.height * scale, scale };
}
