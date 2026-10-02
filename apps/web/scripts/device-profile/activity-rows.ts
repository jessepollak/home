import { loadedRowCount } from "./model";

export const visible = (element: Element | null): element is HTMLElement => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
export const visibleIn = (element: Element | null, host: Element): boolean => {
  if (!visible(element)) return false;
  const rect = element.getBoundingClientRect();
  const documentScroll = host === (document.scrollingElement ?? document.documentElement);
  const top = documentScroll ? 0 : host.getBoundingClientRect().top;
  const bottom = documentScroll ? window.innerHeight : host.getBoundingClientRect().bottom;
  return rect.bottom > top && rect.top < bottom;
};
const detailControl = "button[aria-describedby]:not([aria-expanded])";
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
export function activityScrollHost(root: HTMLElement): HTMLElement {
  for (let node = activityList(root)?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}
const recentItems = (list: HTMLElement | undefined) => [...list?.querySelectorAll<HTMLElement>("li[aria-posinset]") ?? []].map((item) => ({ posinset: Number(item.getAttribute("aria-posinset")), setsize: Number(item.getAttribute("aria-setsize")) }));
export function activityRecentRows(root: HTMLElement) {
  const list = activityList(root);
  return loadedRowCount(recentItems(list), list?.querySelectorAll("li").length ?? 0);
}
export type ActivityRowFacts = { posinset: number; key: string | null; detail: boolean; group: { count: number | null; expanded: boolean } | null };
export function activityRowFacts(root: HTMLElement): ActivityRowFacts[] {
  return [...activityList(root)?.querySelectorAll<HTMLElement>("li[aria-posinset]") ?? []].map((item) => {
    const posinset = Number(item.getAttribute("aria-posinset")), detail = item.querySelector(detailControl) !== null;
    const key = item.getAttribute("data-row-key");
    const control = item.querySelector('button[aria-expanded]');
    if (!control) return { posinset, key, detail, group: null };
    const id = control.getAttribute("aria-describedby"), description = id ? document.getElementById(id)?.textContent : null;
    const count = Number(/^\s*(\d+)\b/.exec(description ?? "")?.[1]);
    return { posinset, key, detail, group: { count: Number.isSafeInteger(count) && count > 0 ? count : null, expanded: control.getAttribute("aria-expanded") === "true" } };
  });
}
export function mergeRowFacts(previous: readonly ActivityRowFacts[], rows: readonly ActivityRowFacts[]): { facts: ActivityRowFacts[]; changed: boolean } {
  const byPosinset = new Map(previous.map((row) => [row.posinset, row]));
  const positionsByKey = new Map(previous.flatMap((row) => row.key === null ? [] : [[row.key, row.posinset] as const]));
  let changed = false;
  for (const row of rows) {
    const known = byPosinset.get(row.posinset);
    if (known && known.key !== null && row.key !== null && known.key !== row.key) changed = true;
    if (known && (known.detail !== row.detail || (known.group === null) !== (row.group === null) || known.group?.count !== row.group?.count || known.group?.expanded !== row.group?.expanded)) changed = true;
    if (row.key !== null) {
      const seenAt = positionsByKey.get(row.key);
      if (seenAt !== undefined && seenAt !== row.posinset) changed = true;
      positionsByKey.set(row.key, row.posinset);
    }
    byPosinset.set(row.posinset, row);
  }
  return { facts: [...byPosinset.values()].sort((a, b) => a.posinset - b.posinset), changed };
}
export function feedCounts(facts: readonly ActivityRowFacts[], rows: number): { grouped: number; underlying: number; unreadable: number } {
  const groups = facts.flatMap((row) => row.group ? [row.group] : []);
  const collapsed = groups.reduce((total, group) => total + (!group.expanded && group.count !== null ? group.count : 0), 0);
  return { grouped: groups.length, underlying: rows - groups.length + collapsed, unreadable: groups.filter((group) => group.count === null).length };
}
export function activityDetailOpener(root: HTMLElement, posinset: number): HTMLElement | null {
  return activityList(root)?.querySelector<HTMLElement>(`li[aria-posinset="${posinset}"] ${detailControl}`) ?? null;
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
