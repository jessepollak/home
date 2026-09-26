export const viewports = {
  mobile: { width: 390, height: 844 },
  narrow: { width: 320, height: 700 },
  desktop: { width: 1440, height: 900 },
} as const;

export type BoardFrame = {
  id: string;
  story: string;
  label: string;
  viewport: { width: number; height: number };
  change: "changed" | "new" | "unchanged";
  note?: string;
  before?: string;
};
export function changeLabel(change: BoardFrame["change"]): string {
  return change[0].toUpperCase() + change.slice(1);
}

export type BoardSection = { id: string; title: string; note?: string; frames: BoardFrame[] };
export type ReviewBoard = {
  id: string;
  title: string;
  summary: string;
  refs?: { issue?: number; pr?: number };
  sections: BoardSection[];
};

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${where}: expected object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${where}: missing ${where.split(".").at(-1)}`);
  return value;
}
function optionalText(value: unknown, where: string): string | undefined {
  return value === undefined ? undefined : text(value, where);
}
function positiveInt(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`${where}: expected positive integer`);
  return value as number;
}

export function parseBoard(json: unknown): ReviewBoard {
  const data = record(json, "board");
  if (!Array.isArray(data.sections) || !data.sections.length)
    throw new Error("board.sections: missing sections");
  const ids = new Set<string>();
  const sectionIds = new Set<string>();
  const sections = data.sections.map((raw, index) => {
    const section = record(raw, `section ${index}`);
    const id = text(section.id, `section ${index}.id`);
    if (sectionIds.has(id)) throw new Error(`Duplicate section id: ${id}`);
    sectionIds.add(id);
    if (!Array.isArray(section.frames) || !section.frames.length)
      throw new Error(`section ${id}: missing frames`);
    return {
      id,
      title: text(section.title, `section ${id}.title`),
      note: optionalText(section.note, `section ${id}.note`),
      frames: section.frames.map((rawFrame, frameIndex) => {
        const frame = record(rawFrame, `frame ${frameIndex}`);
        const frameId = text(frame.id, `frame ${frameIndex}.id`);
        if (ids.has(frameId)) throw new Error(`Duplicate frame id: ${frameId}`);
        ids.add(frameId);
        const viewport =
          typeof frame.viewport === "string"
            ? viewports[frame.viewport as keyof typeof viewports]
            : (() => {
                const size = record(frame.viewport, `frame ${frameId}.viewport`);
                return {
                  width: positiveInt(size.width, `frame ${frameId}.viewport.width`),
                  height: positiveInt(size.height, `frame ${frameId}.viewport.height`),
                };
              })();
        if (!viewport) throw new Error(`Unknown viewport key: ${String(frame.viewport)} (frame ${frameId})`);
        if (!(["changed", "new", "unchanged"] as unknown[]).includes(frame.change))
          throw new Error(`Bad change: ${String(frame.change)} (frame ${frameId})`);
        return {
          id: frameId,
          story: text(frame.story, `frame ${frameId}.story`),
          label: text(frame.label, `frame ${frameId}.label`),
          viewport,
          change: frame.change as BoardFrame["change"],
          note: optionalText(frame.note, `frame ${frameId}.note`),
          before: optionalText(frame.before, `frame ${frameId}.before`),
        };
      }),
    };
  });
  const refs = data.refs === undefined ? undefined : record(data.refs, "board.refs");
  return {
    id: text(data.id, "board.id"),
    title: text(data.title, "board.title"),
    summary: text(data.summary, "board.summary"),
    refs: refs && {
      issue: refs.issue === undefined ? undefined : positiveInt(refs.issue, "board.refs.issue"),
      pr: refs.pr === undefined ? undefined : positiveInt(refs.pr, "board.refs.pr"),
    },
    sections,
  };
}
