import type { PropValue } from "./controls";

export type LibraryUrlState = { component?: string; story?: string; props: Record<string, PropValue> };

function parseProps(input: string | null): Record<string, PropValue> {
  if (!input) return {};
  try {
    const value: unknown = JSON.parse(input);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, PropValue] =>
      ["string", "number", "boolean"].includes(typeof entry[1])));
  } catch {
    return {};
  }
}

export function readLibraryUrl(url: URL): LibraryUrlState {
  return {
    component: url.searchParams.get("component") || undefined,
    story: url.searchParams.get("story") || undefined,
    props: parseProps(url.searchParams.get("props")),
  };
}

export function writeLibraryUrl(url: URL, update: Partial<LibraryUrlState>): URL {
  const next = new URL(url);
  if ("component" in update) {
    if (update.component) next.searchParams.set("component", update.component);
    else next.searchParams.delete("component");
  }
  if ("story" in update) {
    if (update.story) next.searchParams.set("story", update.story);
    else next.searchParams.delete("story");
  }
  if (update.props) {
    if (Object.keys(update.props).length) next.searchParams.set("props", JSON.stringify(update.props));
    else next.searchParams.delete("props");
  }
  return next;
}
