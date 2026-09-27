export type BoardUrlState = { frame?: string; focus?: string[]; side: "after" | "before" | "both"; variant?: "before"; rev?: string; deployment?: string };

export function readBoardUrl(url: URL): BoardUrlState {
  const focus = url.searchParams.get("focus")?.split(",").map((id) => id.trim()).filter(Boolean);
  return {
    frame: url.searchParams.get("frame") || undefined,
    focus: focus?.length ? [...new Set(focus)] : undefined,
    side: url.searchParams.get("side") === "before" ? "before" :
      url.searchParams.get("side") === "both" ? "both" : "after",
    variant: url.searchParams.get("variant") === "before" ? "before" : undefined,
    rev: url.searchParams.get("rev") || undefined,
    deployment: url.searchParams.get("deployment") || undefined,
  };
}
export function writeBoardUrl(url: URL, update: Partial<BoardUrlState>): URL {
  const next = new URL(url);
  for (const key of ["frame", "side", "variant", "rev", "deployment", "focus"] as const) {
    if (!(key in update)) continue;
    const value = update[key];
    if (value && (!Array.isArray(value) || value.length)) next.searchParams.set(key, Array.isArray(value) ? [...new Set(value)].join(",") : value);
    else next.searchParams.delete(key);
  }
  return next;
}
export function storyCanvasUrl(story: string): string {
  return `./iframe.html?id=${encodeURIComponent(story)}&viewMode=story`;
}
export function storyManagerUrl(story: string): string {
  return `./?path=${encodeURIComponent(`/story/${story}`)}`;
}
export function revisionLink(deployment: string, url: URL): string | undefined {
  if (!/^[a-z\d.-]+(?::\d+)?$/i.test(deployment) || deployment.includes("..")) return undefined;
  return `https://${deployment}/iframe.html${url.search}`;
}
