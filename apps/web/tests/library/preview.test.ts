import { afterEach, beforeEach, expect, test } from "bun:test";
import { startRenderDeadline } from "../../stories/review/explorations/board/render-deadline";
import { watchStoryRender } from "../../stories/review/explorations/board/render-watcher";

const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
let next = 0;
const callbacks = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  callbacks.clear();
  globalThis.requestAnimationFrame = (callback) => { callbacks.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => { callbacks.delete(id); };
});
afterEach(() => {
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
});
const tick = () => {
  for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); }
};
function fixture() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const render = { id: "story", phase: "finished" };
  const iframe = {
    isConnected: true,
    contentWindow: {
      __STORYBOOK_PREVIEW__: { currentRender: render },
      __STORYBOOK_ADDONS_CHANNEL__: {
        on(event: string, listener: (payload: unknown) => void) {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(listener);
          listeners.set(event, handlers);
        },
        off(event: string, listener: (payload: unknown) => void) { listeners.get(event)?.delete(listener); },
      },
    },
  } as unknown as HTMLIFrameElement;
  return { iframe, render, emit: (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  }, count: () => [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0) };
}

test("an update promise cannot reveal the previous finished render", async () => {
  const child = fixture();
  const statuses: string[] = [];
  watchStoryRender(child.iframe, "story", (status) => statuses.push(status), () => Promise.resolve());
  await Promise.resolve();
  tick();
  expect(statuses).toEqual([]);
  child.render.phase = "loading";
  tick();
  expect(statuses).toEqual([]);
  child.render.phase = "finished";
  tick();
  expect(statuses).toEqual(["rendered"]);
  expect(callbacks.size).toBe(0);
  expect(child.count()).toBe(0);
});

test("a fast completed update is observed through the child channel", () => {
  const child = fixture();
  const statuses: string[] = [];
  watchStoryRender(child.iframe, "story", (status) => statuses.push(status), () => {
    child.emit("storyRenderPhaseChanged", { storyId: "story", newPhase: "loading" });
    child.emit("storyRendered", "story");
  });
  tick();
  expect(statuses).toEqual(["rendered"]);
});

test("rejected updates and render failures error instead of reporting success", async () => {
  for (const failure of ["application", "render"]) {
    const child = fixture();
    const statuses: string[] = [];
    watchStoryRender(child.iframe, "story", (status) => statuses.push(status), () => {
      if (failure === "application") return Promise.reject(new Error("Could not apply args"));
      child.emit("storyFinished", { storyId: "story", status: "error" });
    });
    await Promise.resolve();
    tick();
    expect(statuses).toEqual(["errored"]);
  }
});

test("cancellation on reload or unmount removes polling and stale completion listeners", () => {
  const child = fixture();
  const statuses: string[] = [];
  const cancel = watchStoryRender(child.iframe, "story", (status) => statuses.push(status), () => undefined);
  expect(callbacks.size).toBe(1);
  expect(child.count()).toBeGreaterThan(0);
  cancel();
  child.emit("storyRendered", "story");
  tick();
  expect(statuses).toEqual([]);
  expect(callbacks.size).toBe(0);
  expect(child.count()).toBe(0);
});

test("the shared navigation-to-render deadline fails stuck loading without real sleeps", () => {
  let callback: (() => void) | undefined;
  let delay: number | undefined;
  const errors: string[] = [];
  const cancel = startRenderDeadline((error) => errors.push(error), {
    schedule: (run, ms) => { callback = run; delay = ms; return 1 as unknown as ReturnType<typeof setTimeout>; },
    cancel: () => { callback = undefined; },
  });
  expect(delay).toBe(20_000);
  callback?.();
  expect(errors).toEqual(["Story did not finish rendering in 20 s"]);
  cancel();
  expect(callback).toBeUndefined();
});
