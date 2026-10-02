import { inactiveTimer, requireInstance } from "../library/fixtures/runtime";
import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { layout } from "@/stories/review/explorations/board/layout";
import { parseBoard } from "@/stories/review/explorations/board/manifest";
import { createFrameStore } from "@/stories/review/explorations/board/use-frame-loading";
import { deferred } from "@/tests/helpers/async";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { LiveFrame } = await import("@/stories/review/explorations/board/live-frame");
afterEach(cleanup);

const positions = layout(parseBoard({
  id: "fixture", title: "Fixture", summary: "Fixture", sections: [{
    id: "section", title: "Section", frames: Array.from({ length: 7 }, (_, id) => ({
      id: `${id}`, story: `story-${id}`, label: `Frame ${id}`, viewport: "mobile", change: "new",
    })),
  }],
}), "after").sections[0].frames;

test("omitting src keeps the board's standalone story URL", () => {
  const view = render(<LiveFrame position={positions[0]} loaded active frameSource="story"
    onMark={() => {}} onFinish={() => {}} onCancel={() => {}} onSelect={() => {}} onInteract={() => {}} />);
  expect(view.getByTitle("Section · Frame 0").getAttribute("src")).toBe("./iframe.html?id=story-0&viewMode=story");
});

test("string storyRendered keeps the deadline and queue slot until held afterEach finishes", async () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  globalThis.requestAnimationFrame = (callback) => { callbacks.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => { callbacks.delete(id); };
  try {
    const store = createFrameStore("fixture", "rev", positions, {
      now: () => 100,
      schedule: () => { const timer = inactiveTimer(); timers.add(timer); return timer; },
      cancel: (timer) => { timers.delete(timer); },
    });
    store.start({ x: 0, y: 0 });
    const position = positions[0];
    const view = render(<LiveFrame position={position} metric={store.metrics.frames[0]} loaded active
      frameSource="story" onMark={store.mark} onFinish={store.finish} onCancel={store.cancel}
      onSelect={() => {}} onInteract={() => {}} />);
    const iframe = requireInstance(view.getByTitle("Section · Frame 0"), HTMLIFrameElement);
    const currentRender = { id: position.story, phase: "completed" };
    Object.defineProperty(iframe, "contentWindow", { configurable: true, value: {
      __STORYBOOK_PREVIEW__: { currentRender },
      __STORYBOOK_ADDONS_CHANNEL__: {
        on(event: string, listener: (payload: unknown) => void) {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(listener);
          listeners.set(event, handlers);
        },
        off(event: string, listener: (payload: unknown) => void) { listeners.get(event)?.delete(listener); },
      },
    } });
    fireEvent.load(iframe);
    const afterEach = deferred<void>();
    const finished = afterEach.promise.then(() => { currentRender.phase = "finished"; });
    for (const listener of listeners.get("storyRendered") ?? []) listener(position.story);
    expect(store.metrics.frames[0].status).toBe("loaded");
    currentRender.phase = "afterEach";
    const tick = () => act(() => {
      for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); }
    });
    tick();
    expect(store.metrics.frames[0].status).toBe("loaded");
    expect(timers.size).toBe(6);
    expect(callbacks.size).toBe(1);
    store.start({ x: 0, y: 0 });
    expect(store.metrics.frames[6].status).toBe("queued");
    afterEach.resolve();
    await finished;
    tick();
    expect(store.metrics.frames[0].status).toBe("rendered");
    expect(timers.size).toBe(5);
    expect(callbacks.size).toBe(0);
    expect([...listeners.values()].every((handlers) => handlers.size === 0)).toBe(true);
    store.start({ x: 0, y: 0 });
    expect(store.metrics.frames[6].status).toBe("loading");
    view.unmount();
    for (const { id } of positions) store.cancel(id);
    expect(timers.size).toBe(0);
  } finally {
    cleanup();
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});
