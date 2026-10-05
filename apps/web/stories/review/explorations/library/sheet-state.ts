export function toggleFocus(current: string | null, story: string): string | null {
  return current === story ? null : story;
}

export function restoredFocus(linked: string | undefined, stories: readonly string[]): string | null {
  return linked && stories.includes(linked) ? linked : null;
}

type FramePriority = { visible: () => boolean };
export type FrameSlots = {
  request: (id: string, grant: () => void, priority?: FramePriority) => () => void;
  prioritize: () => void;
};

export function createFrameSlots(limit: number): FrameSlots {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Frame slots must be positive");
  type Ticket = { id: string; grant: () => void; priority?: FramePriority };
  const active = new Map<string, Ticket>();
  const waiting: Ticket[] = [];
  const drain = () => {
    while (waiting.length && active.size < limit) {
      const visible = waiting.findIndex((ticket) => ticket.priority?.visible());
      const [next] = waiting.splice(visible < 0 ? 0 : visible, 1);
      active.set(next.id, next);
      next.grant();
    }
  };
  return {
    prioritize: drain,
    request(id, grant, priority) {
      const ticket = { id, grant, priority };
      waiting.push(ticket);
      drain();
      return () => {
        const index = waiting.indexOf(ticket);
        if (index >= 0) waiting.splice(index, 1);
        else if (active.get(id) === ticket) { active.delete(id); drain(); }
      };
    },
  };
}

export const PHONE_VIEWPORT: FrameViewport = { width: 390, height: 844 };
export const FRAME_WIDTH = PHONE_VIEWPORT.width;
export const FRAME_MIN_HEIGHT = 160;
const FRAME_MAX_HEIGHT = PHONE_VIEWPORT.height;
const PORTAL_FRAME_HEIGHT = 560;
const FRAME_PADDING = 48;

export function fittedFrameHeight(content: number, portals: boolean, fullscreen = false): number {
  if (fullscreen) return FRAME_MAX_HEIGHT;
  if (portals) return PORTAL_FRAME_HEIGHT;
  if (!Number.isFinite(content)) return FRAME_MAX_HEIGHT;
  return Math.round(Math.min(FRAME_MAX_HEIGHT, Math.max(FRAME_MIN_HEIGHT, content + FRAME_PADDING)));
}

export type FrameViewport = { width: number; height: number };

export function framedWidth(available: number): number {
  return Number.isFinite(available) && available > 0 ? Math.min(FRAME_WIDTH, available) : FRAME_WIDTH;
}

export function spansFullRow(story: { layout: string; frame: unknown; portals: boolean; viewport?: FrameViewport }): boolean {
  return story.viewport !== undefined && story.viewport.width >= 768;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function pixels(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:px)?$/.test(value)) return Number.NaN;
  return Number.parseFloat(value);
}

export function declaredViewport(parameters: Record<string, unknown>, globals: Record<string, unknown> = {}, minWidth = 768): FrameViewport | undefined {
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
  return viewport.width >= minWidth ? viewport : undefined;
}

export function scaledViewport(viewport: FrameViewport, available: number): FrameViewport & { scale: number } {
  const width = Number.isFinite(available) && available > 0 ? available : FRAME_WIDTH;
  const scale = Math.min(1, width / viewport.width);
  return { width: viewport.width * scale, height: viewport.height * scale, scale };
}
