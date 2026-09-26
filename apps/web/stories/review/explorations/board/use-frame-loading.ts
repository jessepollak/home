import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createLoadQueue } from "./load-queue";
import type { Point } from "./camera";
import type { Positioned } from "./layout";

export type Metric = {
  id: string;
  story: string;
  queuedAt?: number;
  loadStartAt?: number;
  loadedAt?: number;
  renderedAt?: number;
  status: "queued" | "loading" | "loaded" | "rendered" | "errored";
  error?: string;
};
export type Metrics = {
  boardId: string;
  revision: string;
  frames: Metric[];
  firstRenderedAt?: number;
  allRenderedAt?: number;
  startedAt: number;
};

declare global {
  interface Window {
    __reviewBoardMetrics?: Metrics;
    __STORYBOOK_ADDONS_CHANNEL__?: {
      on: (event: string, fn: (payload: { storyId?: string }) => void) => void;
      off: (event: string, fn: (payload: { storyId?: string }) => void) => void;
    };
    __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string; id?: string } };
  }
}

type FrameClock = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};

export function createFrameStore(
  boardId: string,
  revision: string,
  positions: Positioned[],
  clock: FrameClock = {
    now: () => performance.now(),
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (timer) => clearTimeout(timer),
  },
) {
  const startedAt = clock.now();
  const metrics: Metrics = {
    boardId,
    revision,
    frames: positions.map((position) => ({
      id: position.id,
      story: position.story,
      queuedAt: startedAt,
      status: "queued",
    })),
    startedAt,
  };
  const queue = createLoadQueue(positions.map((position) => ({ id: position.id, ...position.rect })));
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let snapshot = { metrics, loaded: new Set<string>() };
  const publish = () => {
    snapshot = { metrics: { ...metrics, frames: [...metrics.frames] }, loaded: new Set(snapshot.loaded) };
    for (const listener of listeners) listener();
  };
  const mark = (id: string, patch: Partial<Metric>) => {
    const index = metrics.frames.findIndex((entry) => entry.id === id);
    const metric = metrics.frames[index];
    if (!metric || ["rendered", "errored"].includes(metric.status)) return;
    metrics.frames[index] = { ...metric, ...patch };
    if (patch.status === "rendered") metrics.firstRenderedAt ??= patch.renderedAt;
    if (metrics.frames.length && metrics.frames.every((entry) =>
      ["rendered", "errored"].includes(entry.status))) {
      metrics.allRenderedAt ??= clock.now();
    }
    publish();
  };
  const finish = (id: string, status: "rendered" | "errored", error?: string, unload = false) => {
    const metric = metrics.frames.find((entry) => entry.id === id);
    if (!metric || ["rendered", "errored"].includes(metric.status)) return;
    const timer = timers.get(id);
    if (timer !== undefined) clock.cancel(timer);
    timers.delete(id);
    if (unload) {
      const loaded = new Set(snapshot.loaded);
      loaded.delete(id);
      snapshot = { ...snapshot, loaded };
    }
    mark(id, { status, renderedAt: clock.now(), error });
    queue.complete(id);
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    metrics,
    mark,
    start(center: Point, mobileId?: string) {
      const ids = mobileId ? [mobileId] : queue.take(center);
      const next = ids.filter((id) => metrics.frames.some((entry) =>
        entry.id === id && entry.status === "queued"));
      if (!next.length) return;
      for (const id of next) {
        queue.claim(id);
        mark(id, { status: "loading", loadStartAt: clock.now() });
        timers.set(id, clock.schedule(
          () => finish(id, "errored", "Story did not finish rendering in 20 s", true), 20_000,
        ));
      }
      snapshot = { ...snapshot, loaded: new Set([...snapshot.loaded, ...next]) };
      for (const listener of listeners) listener();
    },
    finish: (id: string, status: "rendered" | "errored", error?: string) => finish(id, status, error),
    cancel(id: string) {
      const index = metrics.frames.findIndex((entry) => entry.id === id);
      const metric = metrics.frames[index];
      if (!metric || ["queued", "rendered", "errored"].includes(metric.status)) return;
      const timer = timers.get(id);
      if (timer !== undefined) clock.cancel(timer);
      timers.delete(id);
      metrics.frames[index] = { ...metric, status: "queued", loadStartAt: undefined, loadedAt: undefined };
      snapshot = { ...snapshot, loaded: new Set([...snapshot.loaded].filter((entry) => entry !== id)) };
      queue.requeue(id);
      publish();
    },
  };
}

export function formatFrameStatus(metrics: Metrics): string {
  const live = metrics.frames.filter((entry) => entry.status === "rendered").length;
  const failed = metrics.frames.filter((entry) => entry.status === "errored").length;
  const total = metrics.frames.length;
  if (metrics.allRenderedAt === undefined) return `Loading ${live} of ${total}`;
  const duration = `${((metrics.allRenderedAt - metrics.startedAt) / 1000).toFixed(1)} s`;
  if (!failed) return `${live} of ${total} live · ${duration}`;
  return [
    `${live} live`,
    ...(failed ? [`${failed} failed`] : []),
    duration,
  ].join(" · ");
}

export function useFrameLoading(
  boardId: string,
  revision: string,
  positions: Positioned[],
  center: Point,
  mobileId?: string,
) {
  const store = useMemo(
    () => createFrameStore(boardId, revision, positions),
    [boardId, revision, positions],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => {
    window.__reviewBoardMetrics = store.metrics;
    return () => {
      if (window.__reviewBoardMetrics === store.metrics) delete window.__reviewBoardMetrics;
    };
  }, [store]);
  useEffect(() => {
    store.start(center, mobileId);
  }, [store, center, mobileId, snapshot]);
  return { ...snapshot, mark: store.mark, finish: store.finish, cancel: store.cancel };
}
