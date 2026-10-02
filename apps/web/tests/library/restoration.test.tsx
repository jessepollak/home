import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, test } from "bun:test";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { FrameSection } = await import("@/stories/review/explorations/library/preview");

const item = { story: "ui-button--default" };
const target = { story: item.story, component: "Button", label: "Default", changed: false };
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
  cleanup();
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
});
const tick = () => act(() => {
  for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); }
});
const flush = () => act(async () => { await Promise.resolve(); });
function child(iframe: HTMLIFrameElement) {
  const currentRender = { id: item.story, phase: "rendering", story: { id: item.story } };
  const updates: Array<{ kind: string; value: unknown; phase: string }> = [];
  const api = {
    currentRender,
    onUpdateGlobals: ({ globals }: { globals: { theme: string } }) => {
      updates.push({ kind: "globals", value: globals.theme, phase: currentRender.phase });
    },
    onUpdateArgs: ({ updatedArgs }: { updatedArgs: Record<string, unknown> }) => {
      updates.push({ kind: "args", value: updatedArgs, phase: currentRender.phase });
    },
  };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: { __STORYBOOK_PREVIEW__: api } });
  return { updates, currentRender, api };
}
const defaults = { children: "Continue" };
const props = {
  target, theme: "dark", args: { children: "RESTORED" }, initialArgs: defaults,
  annotating: false, frameSource: "story" as const,
  viewport: { width: 390, height: 560 }, onSettled: () => {}, onExitAnnotate: () => {},
};
function mount(patch: Partial<typeof props> = {}) {
  const inputs = { ...props, ...patch };
  const view = render(<FrameSection {...inputs} />);
  const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
  const preview = child(iframe);
  fireEvent.load(iframe);
  return { view, iframe, preview, inputs };
}

for (const theme of ["light", "dark"]) {
  test(`untouched props and ${theme} theme matching the frame URL send no updates`, async () => {
    const { view, iframe, preview } = mount({ args: defaults, theme });
    expect(new URL(iframe.src).searchParams.get("globals")).toBe(`theme:${theme}`);
    for (const phase of ["playing", "played", "finished"]) {
      preview.currentRender.phase = phase;
      tick();
      await flush();
      expect(preview.updates).toEqual([]);
    }
    view.unmount();
    expect(callbacks.size).toBe(0);
  });
}

for (const phase of ["finished", "completed", "played"]) {
  test(`a differing restored prop waits for ${phase} rather than rerendering during play`, async () => {
    let settled = 0;
    const { view, preview } = mount({ onSettled: () => { settled++; } });
    preview.currentRender.phase = "playing";
    tick();
    await flush();
    expect(preview.updates).toEqual([]);
    expect(view.queryByRole("status")).toBeNull();
    expect(settled).toBe(1);
    tick();
    await flush();
    expect(preview.updates).toEqual([]);
    preview.currentRender.phase = phase;
    tick();
    await flush();
    expect(preview.updates).toEqual([{ kind: "args", value: props.args, phase }]);
    view.unmount();
    expect(callbacks.size).toBe(0);
  });
}

test("restoration applies on load for a story with no running play", async () => {
  const { preview } = mount();
  preview.currentRender.phase = "finished";
  tick();
  await flush();
  expect(preview.updates).toEqual([{ kind: "args", value: props.args, phase: "finished" }]);
});

for (const change of ["args", "theme", "both"]) {
  test(`a user edit to ${change} during play applies immediately without changing the frame URL`, async () => {
    const { view, iframe, preview, inputs } = mount();
    const src = iframe.getAttribute("src");
    preview.currentRender.phase = "playing";
    tick();
    await flush();
    expect(preview.updates).toEqual([]);
    const latest = { ...inputs, args: change === "theme" ? inputs.args : { children: "NEWER" },
      theme: change === "args" ? inputs.theme : "light" };
    view.rerender(<FrameSection {...latest} />);
    await flush();
    if (change !== "args") expect(preview.updates).toContainEqual({ kind: "globals", value: "light", phase: "playing" });
    if (change !== "theme") expect(preview.updates).toContainEqual({ kind: "args", value: { children: "NEWER" }, phase: "playing" });
    if (change === "theme") expect(preview.updates.filter((update) => update.kind === "args")).toEqual([]);
    expect(iframe.getAttribute("src")).toBe(src);
    expect(preview.currentRender.phase).toBe("playing");
    view.unmount();
    expect(callbacks.size).toBe(0);
  });
}

test("reload fences queued updates and restores the latest props and differing frame theme only after play", async () => {
  const { view, iframe, preview, inputs } = mount();
  preview.currentRender.phase = "playing";
  tick();
  await flush();
  view.rerender(<FrameSection {...inputs} args={{ children: "NEWER" }} theme="light" />);
  const reloaded = child(iframe);
  fireEvent.load(iframe);
  await flush();
  expect(preview.updates).toEqual([]);
  expect(reloaded.updates).toEqual([]);
  reloaded.currentRender.phase = "playing";
  tick();
  await flush();
  expect(reloaded.updates).toEqual([]);
  reloaded.currentRender.phase = "finished";
  tick();
  await flush();
  expect(reloaded.updates).toEqual([
    { kind: "globals", value: "light", phase: "finished" },
    { kind: "args", value: { children: "NEWER" }, phase: "finished" },
  ]);
  view.unmount();
  expect(callbacks.size).toBe(0);
});

test("unmount fences a pending restoration even if its old animation callback runs", async () => {
  const { view, preview } = mount();
  preview.currentRender.phase = "playing";
  tick();
  await flush();
  const pending = [...callbacks.values()];
  view.unmount();
  preview.currentRender.phase = "finished";
  act(() => { for (const callback of pending) callback(0); });
  await flush();
  expect(preview.updates).toEqual([]);
  expect(callbacks.size).toBe(0);
});

test("a running play that later errors still fails the loaded frame", async () => {
  const { view, preview } = mount();
  preview.currentRender.phase = "playing";
  tick();
  await flush();
  expect(view.queryByRole("status")).toBeNull();
  preview.currentRender.phase = "errored";
  tick();
  expect(view.getByRole("alert").textContent).toBe(`Story failed to render: ${item.story}`);
});

test("a rejected args restoration fails rather than silently dropping the restored state", async () => {
  const { view, preview } = mount();
  preview.api.onUpdateArgs = () => { throw new Error("Could not apply args"); };
  preview.currentRender.phase = "finished";
  tick();
  await flush();
  expect(view.getByRole("alert").textContent).toBe("Could not apply args");
});
