import { changesBoard, hasChangeData, type ReviewBuild, type StoryIndexEntry } from "../board/review-build";

export type LibraryItem = {
  id: string;
  name: string;
  title: string;
  story: string;
  storyName: string;
  stories: number;
  changed: boolean;
};

export const OVERVIEW = "overview";
export const COMPOSITIONS = "compositions";

export type LibraryCatalog = { items: LibraryItem[]; changes: number | null };

const OWNED_STORY = /^(?:\.\/)?(?:apps\/web\/)?components\/ui\/[^/]+\.stories\.[^/]+$/;

export function libraryCatalog(entries: Record<string, StoryIndexEntry>, build: ReviewBuild): LibraryCatalog {
  const groups = new Map<string, StoryIndexEntry[]>();
  for (const entry of Object.values(entries)) {
    if (entry.type !== "story" || !entry.title.startsWith("UI/") || !OWNED_STORY.test(entry.importPath)) continue;
    const group = groups.get(entry.title);
    if (group) group.push(entry);
    else groups.set(entry.title, [entry]);
  }
  const changedTitles = new Set(changesBoard(build, entries)?.sections.map((section) => section.title));
  const items = [...groups].map(([title, stories]) => {
    const primary = stories.find((story) => story.name === "Default") ?? stories[0];
    return {
      id: primary.id.split("--")[0],
      name: title.slice("UI/".length),
      title,
      story: primary.id,
      storyName: primary.name,
      stories: stories.length,
      changed: changedTitles.has(title),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return {
    items,
    changes: hasChangeData(build) ? items.filter((item) => item.changed).length : null,
  };
}

export function monogram(name: string): string {
  const words = name.split(/[\s-]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}
