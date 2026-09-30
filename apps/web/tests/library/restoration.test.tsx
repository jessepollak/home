import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { LibraryItem } from "@/stories/review/explorations/library/catalog";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { LibraryPreview } = await import("@/stories/review/explorations/library/preview");

const item: LibraryItem = {
  id: "ui-button", name: "Button", title: "UI/Button", story: "ui-button--default", storyName: "Default",
  stories: 1, changed: false,
};
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
function child(iframe: HTMLIFrameElement) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const updates: Array<{ kind: string; value: unknown }> = [];
  const currentRender = { id: item.story, phase: "finished", story: {
    id: item.story, argTypes: {}, initialArgs: { children: "Continue" },
  } };
  const rendered = { args: { children: "Continue" } as Record<string, unknown>, theme: "light" };
  let pending: (() => void) | undefined;
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const update = (kind: string, value: unknown, paint: () => void) => {
    updates.push({ kind, value });
    currentRender.phase = "loading";
    emit("storyRenderPhaseChanged", { storyId: item.story, newPhase: "loading" });
    pending = () => { paint(); currentRender.phase = "finished"; };
  };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: {
    __STORYBOOK_ADDONS_CHANNEL__: {
      on(event: string, listener: (payload: unknown) => void) {
        const handlers = listeners.get(event) ?? new Set();
        handlers.add(listener);
        listeners.set(event, handlers);
      },
      off(event: string, listener: (payload: unknown) => void) { listeners.get(event)?.delete(listener); },
    },
    __STORYBOOK_PREVIEW__: {
      currentRender,
      onUpdateGlobals: ({ globals }: { globals: { theme: string } }) => {
        update("globals", globals.theme, () => { rendered.theme = globals.theme; });
      },
      onUpdateArgs: ({ updatedArgs }: { updatedArgs: Record<string, unknown> }) => {
        update("args", updatedArgs, () => { rendered.args = updatedArgs; });
      },
    },
  } });
  return { updates, rendered, complete: () => { const run = pending; pending = undefined; run?.(); },
    listenerCount: () => [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0) };
}
const props = {
  item, theme: "dark", args: { children: "RESTORED" }, annotating: false, frameSource: "blank" as const,
  scale: 1, onPrepared: () => ({ children: "RESTORED" }), onExitAnnotate: () => {},
};

for (const change of ["args", "theme", "both"]) {
  test(`restoration waits for the latest ${change} to finish before revealing`, () => {
    const view = render(<LibraryPreview {...props} />);
    const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
    const preview = child(iframe);
    fireEvent.load(iframe);
    tick();
    expect(preview.updates.map(({ kind }) => kind)).toEqual(["globals"]);
    preview.complete();
    tick();
    expect(preview.updates.map(({ kind }) => kind)).toEqual(["globals", "args"]);
    const latest = { ...props, args: { children: change === "theme" ? "RESTORED" : "NEWER" },
      theme: change === "args" ? "dark" : "light" };
    view.rerender(<LibraryPreview {...latest} />);
    preview.complete();
    tick();
    expect(view.queryByText("Loading Default…")).not.toBeNull();
    expect(preview.rendered.args.children).toBe("RESTORED");
    if (change !== "args") {
      expect(preview.updates.at(-1)).toEqual({ kind: "globals", value: "light" });
      preview.complete();
      tick();
      if (change === "both") expect(view.queryByText("Loading Default…")).not.toBeNull();
    }
    if (change !== "theme") {
      expect(preview.updates.at(-1)).toEqual({ kind: "args", value: { children: "NEWER" } });
      preview.complete();
      tick();
    }
    expect(view.queryByText("Loading Default…")).toBeNull();
    expect(preview.rendered).toEqual({ args: latest.args, theme: latest.theme });
    expect(callbacks.size).toBe(0);
    expect(preview.listenerCount()).toBe(0);
  });
}

test("a reload cancels obsolete restoration and applies the latest desired state to the new document", () => {
  const view = render(<LibraryPreview {...props} />);
  const iframe = view.getByTitle("Button · Default") as HTMLIFrameElement;
  const first = child(iframe);
  fireEvent.load(iframe);
  tick();
  expect(first.listenerCount()).toBeGreaterThan(0);
  const latest = { ...props, args: { children: "NEWER" }, theme: "light" };
  view.rerender(<LibraryPreview {...latest} />);
  const reloaded = child(iframe);
  fireEvent.load(iframe);
  expect(first.listenerCount()).toBe(0);
  first.complete();
  tick();
  expect(view.queryByText("Loading Default…")).not.toBeNull();
  reloaded.complete();
  tick();
  expect(view.queryByText("Loading Default…")).not.toBeNull();
  reloaded.complete();
  tick();
  expect(view.queryByText("Loading Default…")).toBeNull();
  expect(reloaded.rendered).toEqual({ args: latest.args, theme: latest.theme });
  view.unmount();
  expect(callbacks.size).toBe(0);
  expect(reloaded.listenerCount()).toBe(0);
});
