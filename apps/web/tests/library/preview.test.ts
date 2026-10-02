import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { isFrameLoaded, watchFrameLoaded } from "../../stories/review/explorations/library/frame-loading";

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
  const render = { id: "story", story: { id: "story" }, phase: "rendering" };
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "isConnected", { value: true });
  Object.defineProperty(iframe, "contentWindow", { value: { __STORYBOOK_PREVIEW__: { currentRender: render } } });
  return { iframe, render };
}

for (const phase of ["playing", "played", "completing", "completed", "afterEach", "finished"]) {
  test(`${phase} loads only the matching story and stops polling`, () => {
    const child = fixture();
    const statuses: string[] = [];
    watchFrameLoaded(child.iframe, "story", (status) => statuses.push(status));
    child.render.phase = phase;
    child.render.story.id = "other";
    tick();
    expect(statuses).toEqual([]);
    child.render.story.id = "story";
    tick();
    expect(statuses).toEqual(["rendered"]);
    expect(callbacks.size).toBe(0);
  });
}

for (const phase of ["errored", "aborted"]) {
  test(`${phase} fails rather than loading`, () => {
    const child = fixture();
    const statuses: string[] = [];
    watchFrameLoaded(child.iframe, "story", (status) => statuses.push(status));
    child.render.phase = phase;
    tick();
    expect(statuses).toEqual(["errored"]);
    expect(callbacks.size).toBe(0);
  });
}

test("rendering is not loaded and cancellation fences pending completion", () => {
  const child = fixture();
  const statuses: string[] = [];
  const cancel = watchFrameLoaded(child.iframe, "story", (status) => statuses.push(status));
  tick();
  expect(isFrameLoaded(child.render, "story")).toBe(false);
  expect(statuses).toEqual([]);
  cancel();
  child.render.phase = "playing";
  tick();
  expect(statuses).toEqual([]);
  expect(callbacks.size).toBe(0);
});
