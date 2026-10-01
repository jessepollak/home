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
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: {
    __STORYBOOK_PREVIEW__: {
      currentRender,
      onUpdateGlobals: ({ globals }: { globals: { theme: string } }) => {
        updates.push({ kind: "globals", value: globals.theme, phase: currentRender.phase });
      },
      onUpdateArgs: ({ updatedArgs }: { updatedArgs: Record<string, unknown> }) => {
        updates.push({ kind: "args", value: updatedArgs, phase: currentRender.phase });
      },
    },
  } });
  return { updates, currentRender };
}
let settled = 0;
const props = {
  target, theme: "dark", args: { children: "RESTORED" }, annotating: false, frameSource: "story" as const,
  viewport: { width: 390, height: 560 }, onSettled: () => { settled += 1; }, onExitAnnotate: () => {},
};

for (const change of ["args", "theme", "both"]) {
  test(`restoration applies the latest ${change} while play is running`, async () => {
    settled = 0;
    const view = render(<FrameSection {...props} />);
    const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
    const preview = child(iframe);
    fireEvent.load(iframe);
    tick();
    await flush();
    expect(preview.updates).toEqual([]);
    expect(view.getByRole("status").textContent).toBe("Loading Default…");
    preview.currentRender.phase = "playing";
    tick();
    await flush();
    expect(preview.updates).toEqual([
      { kind: "globals", value: "dark", phase: "playing" },
      { kind: "args", value: { children: "RESTORED" }, phase: "playing" },
    ]);
    expect(view.queryByRole("status")).toBeNull();
    expect(settled).toBe(1);
    const latest = { ...props, args: { children: change === "theme" ? "RESTORED" : "NEWER" },
      theme: change === "args" ? "dark" : "light" };
    view.rerender(<FrameSection {...latest} />);
    await flush();
    if (change !== "args") expect(preview.updates).toContainEqual({ kind: "globals", value: "light", phase: "playing" });
    if (change !== "theme") expect(preview.updates).toContainEqual({ kind: "args", value: { children: "NEWER" }, phase: "playing" });
    expect(preview.currentRender.phase).toBe("playing");
    expect(settled).toBe(1);
    view.unmount();
    expect(callbacks.size).toBe(0);
  });
}

test("reload fences pending restoration and applies the latest state only to the new generation", async () => {
  const view = render(<FrameSection {...props} />);
  const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
  const first = child(iframe);
  fireEvent.load(iframe);
  first.currentRender.phase = "playing";
  tick();
  const latest = { ...props, args: { children: "NEWER" }, theme: "light" };
  view.rerender(<FrameSection {...latest} />);
  const reloaded = child(iframe);
  fireEvent.load(iframe);
  await flush();
  expect(first.updates).toEqual([]);
  expect(reloaded.updates).toEqual([]);
  expect(view.getByRole("status").textContent).toBe("Loading Default…");
  reloaded.currentRender.phase = "playing";
  tick();
  await flush();
  expect(reloaded.updates).toEqual([
    { kind: "globals", value: "light", phase: "playing" },
    { kind: "args", value: { children: "NEWER" }, phase: "playing" },
  ]);
  expect(view.queryByRole("status")).toBeNull();
  view.unmount();
  expect(callbacks.size).toBe(0);
});

test("a running play that later errors still fails the loaded frame", async () => {
  const view = render(<FrameSection {...props} />);
  const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
  const preview = child(iframe);
  fireEvent.load(iframe);
  preview.currentRender.phase = "playing";
  tick();
  await flush();
  expect(view.queryByRole("status")).toBeNull();
  preview.currentRender.phase = "errored";
  tick();
  expect(view.getByRole("alert").textContent).toBe(`Story failed to render: ${item.story}`);
});

test("a rejected args restoration fails rather than silently dropping the restored state", async () => {
  const view = render(<FrameSection {...props} />);
  const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: {
    __STORYBOOK_PREVIEW__: {
      currentRender: { id: item.story, story: { id: item.story }, phase: "playing" },
      onUpdateGlobals: () => {},
      onUpdateArgs: () => Promise.reject(new Error("Could not apply args")),
    },
  } });
  fireEvent.load(iframe);
  tick();
  await flush();
  expect(view.getByRole("alert").textContent).toBe("Could not apply args");
});
