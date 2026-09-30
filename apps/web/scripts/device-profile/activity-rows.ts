import { loadedRowCount } from "./model";

export const visible = (element: Element | null): element is HTMLElement => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
const unavailable = /unavailable|could not be loaded|failed to load|may be out of date/i;
const settledSourceStatuses = new Set(["ready", "error", "unavailable"]);
const expectedSourceNames = ["transfers", "actions", "orders"];
export function activitySurfaces(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('section[data-activity-feed], section[aria-label="Activity"]:not([id="navigation-panel"])')].filter(visible);
}
const parseSourceStates = (attribute: string | null) => (attribute ?? "").split(/\s+/).filter(Boolean).map((token) => {
  const [name, status, ...rest] = token.split(":");
  return name && status && rest.length === 0 ? { name, status } : { name: token, status: "unknown" };
});
export function activitySourceStates(root: HTMLElement): { name: string; status: string }[] {
  return activitySurfaces(root).flatMap((surface) => parseSourceStates(surface.getAttribute("data-activity-sources")));
}
export function activityReadinessProblems(root: HTMLElement): string[] {
  const surfaces = activitySurfaces(root).filter((surface) => surface.querySelectorAll("li").length > 0);
  if (!surfaces.length) return ["Activity sources did not report readiness"];
  const problems: string[] = [];
  for (const surface of surfaces) {
    const states = parseSourceStates(surface.getAttribute("data-activity-sources"));
    if (!states.length) { problems.push("Activity sources did not report readiness"); continue; }
    const names = states.map((state) => state.name);
    problems.push(...expectedSourceNames.filter((name) => !names.includes(name)).map((name) => `Activity source ${name} did not report readiness`));
    problems.push(...[...new Set(names.filter((name) => !expectedSourceNames.includes(name)))].map((name) => `Activity source ${name} is unrecognised`));
    problems.push(...[...new Set(names.filter((name, index) => names.indexOf(name) !== index))].map((name) => `Activity source ${name} is reported twice`));
  }
  return [...new Set(problems)];
}
export function activityReadinessMarkers(root: HTMLElement): string[] {
  return [
    ...activityReadinessProblems(root),
    ...activitySourceStates(root).filter(({ status }) => status === "error" || status === "unavailable").map(({ name, status }) => `Activity source ${name} reported ${status}`),
  ];
}
export const activityUnsettledSources = (root: HTMLElement): string[] =>
  activitySourceStates(root).filter(({ status }) => !settledSourceStatuses.has(status)).map(({ name }) => name);
export function activityList(root: HTMLElement) {
  return activitySurfaces(root).flatMap((surface) => [...surface.querySelectorAll<HTMLElement>("ul:has(li[aria-posinset])")]).find(visible);
}
const recentItems = (list: HTMLElement | undefined) => [...list?.querySelectorAll<HTMLElement>("li[aria-posinset]") ?? []].map((item) => ({ posinset: Number(item.getAttribute("aria-posinset")), setsize: Number(item.getAttribute("aria-setsize")) }));
export function activityRecentRows(root: HTMLElement) {
  const list = activityList(root);
  return loadedRowCount(recentItems(list), list?.querySelectorAll("li").length ?? 0);
}
export function activityRowCount(root: HTMLElement) {
  const lists = activitySurfaces(root).flatMap((surface) => [...surface.querySelectorAll<HTMLElement>("ul:has(li[aria-posinset])")]).filter(visible);
  const logical = lists.reduce((count, list) => count + loadedRowCount(recentItems(list), list.querySelectorAll("li").length), 0);
  const listed = activitySurfaces(root).reduce((count, surface) => count + surface.querySelectorAll("li").length, 0);
  const mounted = lists.reduce((count, list) => count + list.querySelectorAll("li").length, 0);
  return logical + listed - mounted;
}
export function activityPartialSources(root: HTMLElement) {
  return activitySurfaces(root).flatMap((surface) => [...surface.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]')])
    .filter((node) => visible(node) && unavailable.test(node.textContent ?? ""))
    .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60));
}
export const mergePartialSources = (before: string[], after: string[]) => [...new Set([...before, ...after])];
