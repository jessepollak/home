import { startRenderDeadline, type DeadlineClock } from "../board/render-deadline";
import type { StoryIndexEntry } from "../board/review-build";

type StoryIndex = Record<string, StoryIndexEntry>;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function indexEntries(value: unknown): StoryIndex | null {
  if (!plainObject(value) || !plainObject(value.entries)) return null;
  for (const entry of Object.values(value.entries)) {
    if (!plainObject(entry) || typeof entry.id !== "string" || typeof entry.title !== "string" ||
      typeof entry.name !== "string" || typeof entry.importPath !== "string" || typeof entry.type !== "string" ||
      (entry.tags !== undefined && (!Array.isArray(entry.tags) || !entry.tags.every((tag) => typeof tag === "string")))) {
      return null;
    }
  }
  return value.entries as StoryIndex;
}

export function loadLibraryIndex(setIndex: (index: StoryIndex | "unavailable") => void, clock?: DeadlineClock): () => void {
  const abort = new AbortController();
  let pending = true;
  const finish = (index: StoryIndex | "unavailable") => {
    if (!pending) return;
    pending = false;
    cancelDeadline();
    setIndex(index);
  };
  const cancelDeadline = startRenderDeadline(() => {
    abort.abort();
    finish("unavailable");
  }, clock);
  fetch("./index.json", { signal: abort.signal }).then((response) => {
    if (!response.ok) throw new Error("Story index unavailable");
    return response.json() as Promise<unknown>;
  }).then((data) => finish(indexEntries(data) ?? "unavailable")).catch(() => finish("unavailable"));
  return () => {
    pending = false;
    cancelDeadline();
    abort.abort();
  };
}
