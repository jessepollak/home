"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { isRecord } from "@/shared/guards";

type RowAnchor = { index: number; key: string | null; top: number };
type SavedScroll = { y: number; anchor: RowAnchor | null; owner: string | null };
type PendingScroll = SavedScroll & { path: string; entry: string | null; started: number };

const scrollKey = "__homeShellScrollY";
const anchorKey = "__homeShellScrollAnchor";
const scrollOwnerKey = "__homeShellScrollOwner";
export const shellVirtualMeasurementsKey = "__homeShellVirtualMeasurements";
export const shellVirtualSnapshotEvent = "home:shell-virtual-snapshot";
export const shellVirtualScrollKeyEvent = "home:shell-virtual-scroll-key";
export const shellVirtualKeyMissingEvent = "home:shell-virtual-key-missing";
export type ShellVirtualSnapshotEvent = CustomEvent<{ measurements: VirtualItem[] | null }>;
const rowSelector = "main[data-app-main-authenticated] ul[id] > li[data-index][aria-posinset]";

function navigationApi(): EventTarget | null {
  const navigation: unknown = "navigation" in window ? window.navigation : undefined;
  return navigation instanceof EventTarget ? navigation : null;
}

function navigationKey(navigation: EventTarget | null): string | null {
  const entry: unknown = navigation && "currentEntry" in navigation ? navigation.currentEntry : null;
  return isRecord(entry) && typeof entry.key === "string" ? entry.key : null;
}

function isCallable(value: unknown): value is () => unknown {
  return typeof value === "function";
}

function navigationKeys(navigation: EventTarget): Set<string> | null {
  if (!("entries" in navigation) || !isCallable(navigation.entries)) return null;
  const entries: unknown = navigation.entries();
  if (!Array.isArray(entries)) return null;
  return new Set(entries.flatMap((entry: unknown) => isRecord(entry) && typeof entry.key === "string" ? [entry.key] : []));
}

function visibleRow(): RowAnchor | null {
  let first: RowAnchor | null = null;
  for (const row of document.querySelectorAll<HTMLElement>(rowSelector)) {
    const index = Number(row.getAttribute("aria-posinset"));
    const rect = row.getBoundingClientRect();
    if (!Number.isInteger(index) || index < 1 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    const key = row.dataset.rowKey || null;
    if (!first || rect.top < first.top) first = { index, key, top: rect.top };
  }
  return first;
}

function savedScroll(state: unknown): SavedScroll | null {
  if (!isRecord(state)) return null;
  const y = state[scrollKey];
  if (typeof y !== "number" || !Number.isFinite(y) || y < 0) return null;
  const candidate = state[anchorKey];
  const anchor = isRecord(candidate) ? candidate : null;
  const key = anchor && typeof anchor.key === "string" && anchor.key.length > 0 ? anchor.key : null;
  const ownerValue = state[scrollOwnerKey];
  const owner = typeof ownerValue === "string" ? ownerValue : null;
  return { y, owner, anchor: anchor && typeof anchor.index === "number" && Number.isInteger(anchor.index) && anchor.index > 0 &&
    typeof anchor.top === "number" && Number.isFinite(anchor.top)
    ? { index: anchor.index, key, top: anchor.top } : null };
}

export function scopedSavedScroll(state: unknown, ownerKey: string | null): SavedScroll | null {
  const saved = savedScroll(state);
  return saved && saved.owner !== null && saved.owner === ownerKey ? saved : null;
}

export function nextScrollOwner(
  previous: string | null,
  incoming: string | null,
  savedOwner: string | null,
): { owner: string | null; reset: boolean; clear: boolean } {
  if (incoming === null || incoming === previous) return { owner: previous, reset: false, clear: false };
  if (previous === null) return { owner: incoming, reset: false, clear: savedOwner !== incoming };
  return { owner: incoming, reset: true, clear: true };
}

export function useShellDocumentScrollRestoration(pathname: string, ownerKey: string | null): void {
  const path = useRef(pathname);
  const schedule = useRef<() => void>(() => {});
  const owner = useRef(ownerKey);
  const verified = useRef(ownerKey !== null);
  const cancelPending = useRef<() => void>(() => {});
  const left = useRef(new Map<string, SavedScroll>());

  useLayoutEffect(() => {
    path.current = pathname;
    schedule.current();
  }, [pathname]);
  useLayoutEffect(() => {
    const next = nextScrollOwner(owner.current, ownerKey, savedScroll(window.history.state)?.owner ?? null);
    owner.current = next.owner;
    verified.current = ownerKey !== null;
    if (!next.reset && !next.clear) return;
    cancelPending.current();
    left.current.clear();
    const state: unknown = window.history.state;
    if (isRecord(state)) {
      const cleared = { ...state };
      delete cleared[scrollKey];
      delete cleared[anchorKey];
      delete cleared[shellVirtualMeasurementsKey];
      delete cleared[scrollOwnerKey];
      window.history.replaceState(cleared, "");
    }
    if (next.reset) window.scrollTo(0, 0);
  }, [ownerKey]);

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    let pending: PendingScroll | null = null;
    let arrivingKey: string | null = null;
    let frame = 0;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const clearExpiry = () => { if (expiry !== null) { clearTimeout(expiry); expiry = null; } };
    const cancel = () => {
      pending = null;
      clearExpiry();
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const main = document.querySelector<HTMLElement>("main[data-app-main-authenticated]");
    const navigation = navigationApi();

    const persist = () => {
      if (pending) return;
      if (!verified.current) return;
      const y = window.scrollY;
      const previous = savedScroll(window.history.state);
      if (y === 0 && (previous === null || previous.y === 0)) return;
      const anchor = visibleRow();
      const detail: ShellVirtualSnapshotEvent["detail"] = { measurements: null };
      window.dispatchEvent(new CustomEvent(shellVirtualSnapshotEvent, { detail }));
      const rawState: unknown = window.history.state;
      const state = isRecord(rawState) ? rawState : {};
      const savedOwner = state[scrollOwnerKey];
      const ownerMatches = typeof savedOwner === "string" && savedOwner === owner.current;
      const storedCache = ownerMatches ? state[shellVirtualMeasurementsKey] : undefined;
      const cached: unknown[] | null = Array.isArray(storedCache) ? storedCache : null;
      const measurements: readonly unknown[] | null = detail.measurements ?? cached;
      const previousAnchor = previous?.anchor ?? null;
      if (previous && Math.abs(previous.y - y) < 1 && previousAnchor?.index === anchor?.index &&
        (previousAnchor?.key ?? null) === (anchor?.key ?? null) &&
        (anchor === null || (previousAnchor !== null && Math.abs(previousAnchor.top - anchor.top) < 1)) &&
        (measurements === null || cached !== null && cached.length === measurements.length &&
          cached.every((item, index) => {
            const next = measurements[index];
            return isRecord(item) && isRecord(next) && item.key === next.key && item.size === next.size;
          }))) return;
      window.history.replaceState({ ...state, [scrollKey]: y, [anchorKey]: anchor,
        [shellVirtualMeasurementsKey]: measurements, [scrollOwnerKey]: owner.current }, "");
    };
    const attempt = () => {
      frame = 0;
      if (!pending) return;
      if (window.location.pathname !== pending.path) { cancel(); return; }
      if (path.current !== pending.path) return;
      const target = pending;
      if (performance.now() - target.started > 5_000) {
        cancel();
        persist();
        return;
      }
      window.scrollTo(0, target.y);
      if (Math.abs(window.scrollY - target.y) > 1) return;
      const anchor = target.anchor;
      if (anchor) {
        const rows = [...document.querySelectorAll<HTMLElement>(rowSelector)].filter((node) => node.getClientRects().length > 0);
        const row = anchor.key !== null
          ? rows.find((node) => (node.dataset.rowKey ?? "") === anchor.key)
          : rows.find((node) => Number(node.getAttribute("aria-posinset")) === anchor.index);
        if (!row) {
          if (anchor.key !== null) {
            window.dispatchEvent(new CustomEvent(shellVirtualScrollKeyEvent, { detail: { key: anchor.key } }));
          }
          return;
        }
        const delta = row.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      }
      cancel();
    };
    const requestAttempt = () => {
      if (pending && !frame) frame = requestAnimationFrame(() => { frame = requestAnimationFrame(attempt); });
    };
    schedule.current = () => {
      if (pending && path.current !== pending.path) cancel();
      else requestAttempt();
    };
    const onKeyMissing = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return;
      const key = event.detail.key;
      if (typeof key !== "string" || !pending?.anchor || pending.anchor.key !== key) return;
      pending.anchor = { ...pending.anchor, key: null };
      requestAttempt();
    };
    const onEntryChange = (event: Event) => {
      if (!isRecord(event) || event.navigationType !== "traverse" || !isRecord(event.from) ||
        typeof event.from.key !== "string") return;
      arrivingKey = navigationKey(navigation);
      if (!verified.current || pending && pending.entry !== event.from.key) return;
      left.current.set(event.from.key, pending
        ? { y: pending.y, anchor: pending.anchor, owner: pending.owner }
        : { y: window.scrollY, anchor: visibleRow(), owner: owner.current });
      const keys = navigation ? navigationKeys(navigation) : null;
      if (keys) for (const key of left.current.keys()) if (!keys.has(key)) left.current.delete(key);
    };
    const onPop = (event: PopStateEvent) => {
      const key = navigationKey(navigation);
      const arriving = arrivingKey;
      arrivingKey = null;
      const record = arriving !== null && arriving === key ? left.current.get(arriving) : undefined;
      if (arriving !== null && arriving === key) left.current.delete(arriving);
      const saved = record && record.owner !== null && record.owner === owner.current
        ? record : scopedSavedScroll(event.state, owner.current);
      if (!saved && path.current === window.location.pathname) return;
      cancel();
      pending = saved ? { ...saved, path: window.location.pathname, entry: key, started: performance.now() } : null;
      window.scrollTo(0, saved ? saved.y : 0);
      requestAttempt();
      const target = pending;
      if (target) expiry = setTimeout(() => {
        if (pending !== target) return;
        cancel();
        if (path.current !== target.path || window.location.pathname !== target.path || owner.current !== target.owner) return;
        persist();
      }, 5_000);
    };
    cancelPending.current = cancel;
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancel();
      if (event.key === "Enter" || event.key === " ") persist();
    };
    const onScroll = () => {
      if ("onscrollend" in window || pending) return;
      clearTimeout(quietTimer ?? undefined);
      quietTimer = setTimeout(persist, 150);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") persist(); };
    const observer = new MutationObserver(requestAttempt);
    if (main) observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    const resize = new ResizeObserver(requestAttempt);
    if (main) resize.observe(main);
    window.addEventListener("scrollend", persist, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    navigation?.addEventListener("currententrychange", onEntryChange);
    window.addEventListener("popstate", onPop);
    window.addEventListener(shellVirtualKeyMissingEvent, onKeyMissing);
    window.addEventListener("pagehide", persist);
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("pointerdown", cancel, { passive: true });
    document.addEventListener("click", persist, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      schedule.current = () => {};
      cancelPending.current = () => {};
      cancel();
      clearTimeout(quietTimer ?? undefined);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("scrollend", persist);
      window.removeEventListener("scroll", onScroll);
      navigation?.removeEventListener("currententrychange", onEntryChange);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(shellVirtualKeyMissingEvent, onKeyMissing);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("pointerdown", cancel);
      document.removeEventListener("click", persist, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);
}
