import { loadedRowCount } from "./model";

export const visible = (element: Element | null): element is HTMLElement => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
const unavailable = /unavailable|could not be loaded|failed to load|may be out of date/i;
export function activitySurfaces(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('section[data-activity-feed], section[aria-label="Activity"]:not([id="navigation-panel"])')].filter(visible);
}
export function activityList(root: HTMLElement) {
  return activitySurfaces(root).flatMap((surface) => [...surface.querySelectorAll<HTMLElement>("ul:has(li[aria-posinset])")]).find(visible);
}
const recentItems = (list: HTMLElement | undefined) => [...list?.querySelectorAll<HTMLElement>("li[aria-posinset]") ?? []].map((item) => ({ posinset: Number(item.getAttribute("aria-posinset")), setsize: Number(item.getAttribute("aria-setsize")) }));
export function activityRecentRows(root: HTMLElement) {
  const list = activityList(root);
  return loadedRowCount(recentItems(list), list?.querySelectorAll("li").length ?? 0);
}
export function activityRowCount(root: HTMLElement) {
  const list = activityList(root);
  const listed = activitySurfaces(root).reduce((count, surface) => count + surface.querySelectorAll("li").length, 0);
  return activityRecentRows(root) + listed - (list?.querySelectorAll("li").length ?? 0);
}
export function activityPartialSources(root: HTMLElement) {
  return activitySurfaces(root).flatMap((surface) => [...surface.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]')])
    .filter((node) => visible(node) && unavailable.test(node.textContent ?? ""))
    .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60));
}
export const mergePartialSources = (before: string[], after: string[]) => [...new Set([...before, ...after])];
