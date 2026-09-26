import { expect, test } from "bun:test";
import { layout } from "../../stories/review/explorations/board/layout";
import { parseBoard } from "../../stories/review/explorations/board/manifest";
import { createFrameStore, formatFrameStatus } from "../../stories/review/explorations/board/use-frame-loading";

const positions = layout(parseBoard({
  id: "fixture",
  title: "Fixture",
  summary: "Fixture",
  sections: [{
    id: "section",
    title: "Section",
    frames: Array.from({ length: 7 }, (_, id) => ({
      id: `${id}`, story: `story-${id}`, label: `Frame ${id}`, viewport: "mobile", change: "new",
    })),
  }],
}), "after").sections[0].frames;

function clock() {
  let now = 100;
  const timers = new Map<ReturnType<typeof setTimeout>, { callback: () => void; due: number }>();
  return {
    now: () => now,
    schedule(callback: () => void, delay: number) {
      const id = {} as ReturnType<typeof setTimeout>;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    cancel(id: ReturnType<typeof setTimeout>) { timers.delete(id); },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    count: () => timers.size,
  };
}

test("render timeout fails a frame after 20 seconds and frees the queue slot", () => {
  const time = clock();
  const store = createFrameStore("fixture", "rev", positions, time);
  store.subscribe(() => {
    const snapshot = store.getSnapshot();
    expect(snapshot.loaded.size).toBeLessThanOrEqual(6);
    for (const frame of snapshot.metrics.frames.filter((entry) => entry.status === "errored")) {
      expect(snapshot.loaded.has(frame.id)).toBe(false);
    }
  });
  store.start({ x: 0, y: 0 });
  expect(store.metrics.frames.filter((frame) => frame.status === "loading")).toHaveLength(6);
  expect(store.getSnapshot().loaded.size).toBe(6);
  expect(time.count()).toBe(6);
  time.advance(20_000);
  const timedOut = store.metrics.frames.filter((frame) => frame.status === "errored");
  expect(timedOut).toHaveLength(6);
  expect(timedOut[0]?.error).toBe("Story did not finish rendering in 20 s");
  expect(store.getSnapshot().loaded.size).toBe(0);
  for (const frame of timedOut) expect(store.getSnapshot().loaded.has(frame.id)).toBe(false);
  const snapshot = store.getSnapshot();
  store.mark(timedOut[0].id, { status: "loaded", loadedAt: time.now() });
  store.finish(timedOut[0].id, "rendered");
  expect(store.getSnapshot()).toBe(snapshot);
  store.start({ x: 0, y: 0 });
  expect(store.metrics.frames.filter((frame) => frame.status === "loading")).toHaveLength(1);
  expect(store.getSnapshot().loaded.size).toBeLessThanOrEqual(6);
  store.finish("6", "rendered");
  expect(store.metrics.allRenderedAt).toBe(20_100);
  expect(time.count()).toBe(0);
  expect(formatFrameStatus(store.metrics)).toBe("1 live · 6 failed · 20.0 s");
});

test("cancelled loading frames return to the queue and can render on retry", () => {
  const time = clock();
  const store = createFrameStore("fixture", "rev", positions.slice(0, 1), time);
  const center = { x: 0, y: 0 };
  store.start(center);
  expect(store.getSnapshot().loaded.has("0")).toBe(true);
  expect(time.count()).toBe(1);
  time.advance(100);
  store.mark("0", { status: "loaded", loadedAt: time.now() });
  store.cancel("0");
  expect(store.metrics.frames[0]).toMatchObject({ status: "queued", loadStartAt: undefined,
    loadedAt: undefined });
  expect(store.getSnapshot().loaded.has("0")).toBe(false);
  expect(time.count()).toBe(0);
  store.start(center, "0");
  expect(store.metrics.frames[0].status).toBe("loading");
  expect(store.getSnapshot().loaded.has("0")).toBe(true);
  store.finish("0", "rendered");
  expect(store.metrics.frames[0].status).toBe("rendered");
  expect(time.count()).toBe(0);
  const snapshot = store.getSnapshot();
  store.cancel("0");
  expect(store.getSnapshot()).toBe(snapshot);
  expect(store.metrics.frames[0].status).toBe("rendered");
});

test("frames rendered on mobile never hold a desktop load slot", () => {
  const time = clock();
  const store = createFrameStore("fixture", "rev", positions, time);
  for (const id of ["0", "1", "2", "3", "4", "5"]) {
    store.start({ x: 0, y: 0 }, id);
    store.finish(id, "rendered");
  }
  store.start({ x: 0, y: 0 });
  expect(store.metrics.frames.find((frame) => frame.id === "6")?.status).toBe("loading");
});

test("completed frames cancel their timeout and report live status", () => {
  const time = clock();
  const store = createFrameStore("fixture", "rev", positions.slice(0, 1), time);
  store.start({ x: 0, y: 0 });
  time.advance(3_100);
  store.finish("0", "rendered");
  expect(store.metrics.allRenderedAt).toBe(3_200);
  expect(time.count()).toBe(0);
  expect(formatFrameStatus(store.metrics)).toBe("1 of 1 live · 3.1 s");
});
