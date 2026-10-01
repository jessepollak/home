import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, test } from "bun:test";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { FrameSection } = await import("@/stories/review/explorations/library/preview");

const story = "ui-button--default";
const target = { story, component: "Button", label: "Default", changed: false };
const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
const callbacks = new Map<number, FrameRequestCallback>();
let next = 0;
beforeEach(() => {
  callbacks.clear();
  globalThis.requestAnimationFrame = (callback) => { callbacks.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => { callbacks.delete(id); };
});
afterEach(() => {
  cleanup();
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
});
const tick = () => act(() => {
  for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); }
});
const flush = () => act(async () => { await Promise.resolve(); });
type Payload = { storyId?: string; status?: string; name?: string; message?: string; title?: string; description?: string };
type Listener = (payload: Payload) => void;
function child(iframe: HTMLIFrameElement) {
  const currentRender = { id: story, story: { id: story }, phase: "playing" };
  const listeners = new Map<string, Set<Listener>>();
  const channel = {
    on: (event: string, listener: Listener) => {
      const subscribed = listeners.get(event) ?? new Set<Listener>();
      subscribed.add(listener);
      listeners.set(event, subscribed);
    },
    off: (event: string, listener: Listener) => { listeners.get(event)?.delete(listener); },
  };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: {
    __STORYBOOK_ADDONS_CHANNEL__: channel,
    __STORYBOOK_PREVIEW__: { currentRender, onUpdateGlobals: () => {}, onUpdateArgs: () => {} },
  } });
  const emit = (event: string, payload: Payload) => act(() => {
    for (const listener of [...listeners.get(event) ?? []]) listener(payload);
  });
  const listenerCount = () => [...listeners.values()].reduce((count, subscribed) => count + subscribed.size, 0);
  return { currentRender, listeners, emit, listenerCount };
}
async function revealed() {
  let settled = 0;
  const props = {
    target, theme: "dark", args: { children: "Restored" }, annotating: false, frameSource: "story" as const,
    viewport: { width: 390, height: 560 }, onSettled: () => { settled += 1; }, onExitAnnotate: () => {},
  };
  const view = render(<FrameSection {...props} />);
  const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
  const preview = child(iframe);
  fireEvent.load(iframe);
  tick();
  await flush();
  expect(view.queryByRole("status")).toBeNull();
  expect(settled).toBe(1);
  return { view, iframe, preview, props, settled: () => settled };
}

for (const event of ["playFunctionThrewException", "storyThrewException", "storyErrored"]) {
  test(`${event} after reveal displays its native error payload`, async () => {
    const { view, preview, settled } = await revealed();
    preview.emit(event, event === "storyErrored"
      ? { title: "Render failed", description: "Late failure" }
      : { name: "Error", message: "Late failure" });
    tick();
    expect(view.getByRole("alert").textContent).toBe("Late failure");
    expect(settled()).toBe(1);
    expect(callbacks.size).toBe(0);
    expect(preview.listenerCount()).toBe(0);
  });
}

for (const event of ["playFunctionThrewException", "storyThrewException", "storyErrored"]) {
  test(`${event} with a matching story id retains its message when the shared frame also reports failure`, async () => {
    const { view, preview } = await revealed();
    preview.emit(event, { storyId: story, message: "First failure" });
    tick();
    expect(view.getByRole("alert").textContent).toBe("First failure");
  });
}

test("an errored play that finishes between animation frames keeps its failure after restoration", async () => {
  const { view, preview, props, settled } = await revealed();
  await flush();
  preview.currentRender.phase = "errored";
  preview.emit("playFunctionThrewException", { name: "Error", message: "Fast play failure" });
  preview.currentRender.phase = "finished";
  preview.emit("storyFinished", { storyId: story, status: "error" });
  preview.emit("storyFinished", { storyId: story, status: "success" });
  view.rerender(<FrameSection {...props} theme="light" args={{ children: "New args" }} />);
  tick();
  await flush();
  expect(view.getByRole("alert").textContent).toBe("Fast play failure");
  expect(settled()).toBe(1);
});

test("storyFinished with error status fails even without an exception event", async () => {
  const { view, preview } = await revealed();
  preview.currentRender.phase = "finished";
  preview.emit("storyFinished", { storyId: story, status: "error" });
  expect(view.getByRole("alert").textContent).toBe(`Story failed to render: ${story}`);
});

test("a persistent abort after an intermediate successful restore fails on the next poll", async () => {
  const { view, preview, props, settled } = await revealed();
  preview.currentRender.phase = "finished";
  preview.emit("storyFinished", { storyId: story, status: "success" });
  view.rerender(<FrameSection {...props} theme="light" args={{ children: "New args" }} />);
  await flush();
  tick();
  expect(view.queryByRole("alert")).toBeNull();
  preview.currentRender.phase = "aborted";
  tick();
  expect(view.getByRole("alert").textContent).toBe(`Story failed to render: ${story}`);
  expect(settled()).toBe(1);
  expect(callbacks.size).toBe(0);
});

test("events for another story and unscoped exceptions from another current render are ignored", async () => {
  const { view, preview } = await revealed();
  for (const event of ["storyErrored", "storyThrewException", "playFunctionThrewException", "storyFinished"]) {
    preview.emit(event, { storyId: "other", status: "error", message: "Other failure" });
  }
  preview.currentRender.story.id = "other";
  preview.emit("playFunctionThrewException", { message: "Other unscoped failure" });
  tick();
  expect(view.queryByRole("alert")).toBeNull();
  preview.currentRender.story.id = story;
  preview.emit("playFunctionThrewException", { message: "Matching failure" });
  expect(view.getByRole("alert").textContent).toBe("Matching failure");
});

test("reload removes old listeners and fences already queued events from the old generation", async () => {
  const { view, iframe, preview } = await revealed();
  const queued = [...preview.listeners.get("playFunctionThrewException") ?? []];
  expect(queued.length).toBeGreaterThan(0);
  const reloaded = child(iframe);
  fireEvent.load(iframe);
  expect(preview.listenerCount()).toBe(0);
  act(() => { for (const listener of queued) listener({ storyId: story, message: "Stale failure" }); });
  tick();
  await flush();
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.queryByRole("status")).toBeNull();
  reloaded.emit("playFunctionThrewException", { message: "New failure" });
  expect(view.getByRole("alert").textContent).toBe("New failure");
});

test("unmount removes listeners and cancels ongoing failure polling", async () => {
  const { view, preview } = await revealed();
  expect(preview.listenerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(preview.listenerCount()).toBe(0);
  expect(callbacks.size).toBe(0);
});
