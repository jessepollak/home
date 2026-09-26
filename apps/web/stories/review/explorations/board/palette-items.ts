import { rank, type BoardCommand } from "./commands";
import { frameLabel, type Section } from "./layout";
import type { StoryIndexEntry } from "./review-build";
import { storyCanvasUrl, storyManagerUrl } from "./url-state";

export const paletteGroups = ["Commands", "Frames", "Sections", "Boards", "Stories"] as const;
export type PaletteGroup = typeof paletteGroups[number];
export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  detail: string;
  keys?: string[];
  run: (newTab?: boolean) => void;
};

export function buildPaletteItems({ commands, sections, index, boardId, selectFrame, fitSection, navigate }: {
  commands: BoardCommand[];
  sections: Section[];
  index: Record<string, StoryIndexEntry> | null;
  boardId: string;
  selectFrame: (id: string) => void;
  fitSection: (section: Section) => void;
  navigate: (url: string, newTab: boolean) => void;
}): PaletteItem[] {
  return [
    ...commands.filter((command) => command.run && command.palette !== false && command.enabled !== false)
      .map((command) => ({ id: command.id, group: "Commands" as const, label: command.label,
        detail: command.group, keys: command.keys, run: () => command.run?.() })),
    ...sections.flatMap((section) => section.frames.map((position) => ({
      id: `frame:${position.id}`, group: "Frames" as const, label: frameLabel(position),
      detail: section.title, run: () => selectFrame(position.id),
    }))),
    ...sections.map((section) => ({
      id: `section:${section.id}`, group: "Sections" as const, label: `Go to section: ${section.title}`,
      detail: "", run: () => fitSection(section),
    })),
    ...Object.values(index ?? {}).filter((entry) => entry.type === "story" &&
      entry.id.startsWith("review-boards--") && entry.tags?.includes("review-board") &&
      entry.id !== `review-boards--${boardId}`)
      .map((entry) => ({
        id: `board:${entry.id}`, group: "Boards" as const, label: `Open board: ${entry.name}`,
        detail: entry.title, run: (newTab = false) => navigate(storyCanvasUrl(entry.id), newTab),
      })),
    ...Object.values(index ?? {}).filter((entry) => entry.type === "story" &&
      !entry.id.startsWith("review-boards--"))
      .map((entry) => ({
        id: `story:${entry.id}`, group: "Stories" as const, label: entry.name,
        detail: entry.title, run: (newTab = false) => navigate(storyManagerUrl(entry.id), newTab),
      })),
  ];
}

export function rankPaletteItems(query: string, items: PaletteItem[]): PaletteItem[] {
  const matches = rank(query, items.filter((item) => item.group !== "Stories" || query.trim()));
  let stories = 0;
  const capped = matches.filter((item) => item.group !== "Stories" || ++stories <= 30);
  return paletteGroups.flatMap((group) => capped.filter((item) => item.group === group));
}
