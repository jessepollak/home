import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, test } from "bun:test";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { frameReason, readPortalRule, rendersPortal } from "@/stories/review/explorations/library/isolation";
import type { SheetStory } from "@/stories/review/explorations/library/stories";

import { lexLibraryImports } from "../../.storybook/library-imports-plugin";
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { VariantSheet } = await import("@/stories/review/explorations/library/sheet");

const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
const originalIntersection = globalThis.IntersectionObserver;
let next = 0;
const callbacks = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  callbacks.clear();
  globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
  globalThis.requestAnimationFrame = (callback) => { callbacks.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => { callbacks.delete(id); };
});
afterEach(() => {
  cleanup();
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
  globalThis.IntersectionObserver = originalIntersection;
});
const tick = () => act(() => {
  for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); }
});
const flush = () => act(async () => { await Promise.resolve(); });

function story(id: string, Story: SheetStory["Story"], source = "", frame: SheetStory["frame"] = null): SheetStory {
  const portals = rendersPortal(source);
  return { id, name: id, Story, portals, frame: frame ?? frameReason({}, {}, portals),
    argTypes: {}, initialArgs: {}, layout: "centered", themePinned: false };
}
function sheet(stories: SheetStory[]) {
  const props = { root: null, component: "Fixture", changed: false, stories, theme: "light", focused: null,
    focusedArgs: null, annotating: false, frameSource: "blank" as const,
    onToggle: (_id: string) => {}, onActivate: (_id: string) => {}, onEscape: () => {}, onExitAnnotate: () => {} };
  const view = render(<VariantSheet {...props} />);
  return { ...view, update: (patch: Partial<Parameters<typeof VariantSheet>[0]>) => {
    Object.assign(props, patch);
    view.rerender(<VariantSheet {...props} />);
  } };
}
function preview(iframe: HTMLIFrameElement, id: string) {
  const currentRender = { id, story: { id }, phase: "finished" };
  let complete: (() => void) | undefined;
  const update = () => { currentRender.phase = "loading"; complete = () => { currentRender.phase = "finished"; }; };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: {
    __STORYBOOK_PREVIEW__: { currentRender, onUpdateGlobals: update, onUpdateArgs: update },
  } });
  return { complete: () => act(() => { complete?.(); complete = undefined; }) };
}
function trustedPointerDown(target: HTMLElement) {
  const event = new PointerEvent("pointerdown", { bubbles: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  fireEvent(target, event);
}

test("source-known portals never mount in the parent; unrelated nodes cannot frame plain neighbors", () => {
  let portalMounts = 0;
  const portal = story("portal", () => { portalMounts++; return null; }, "const Content = () => <Primitive.Portal />");
  const plain = story("plain", () => <p>Plain neighbor</p>);
  const view = sheet([portal, plain]);
  expect(portalMounts).toBe(0);
  expect(view.getByTitle("Fixture · portal")).toBeTruthy();
  expect(view.getByText("Plain neighbor")).toBeTruthy();
  const unrelated = document.createElement("div");
  document.body.append(unrelated);
  tick();
  expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
  unrelated.remove();
  view.update({ stories: [story("plain", () => { portalMounts++; return null; }, "createPortal(children, document.body)")], theme: "dark" });
  expect(portalMounts).toBe(0);
  expect(view.getByTitle("Fixture · plain")).toBeTruthy();
});

for (const portals of [true, false]) {
  test(`${portals ? "portal" : "non-portal"} frames keep the correct viewport after restoration`, () => {
    const entry = story("height", () => null, portals ? "<Portal />" : "", "Play function");
    const view = sheet([entry]);
    const iframe = view.getByTitle("Fixture · height") as HTMLIFrameElement;
    if (portals) expect(iframe.height).toBe("844");
    const doc = iframe.contentDocument!;
    const content = doc.createElement("div");
    content.id = "storybook-root";
    Object.defineProperty(content, "scrollHeight", { value: 64 });
    doc.body.append(content);
    const wrapper = doc.createElement("div");
    wrapper.setAttribute("data-base-ui-portal", "");
    wrapper.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    const dialog = doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.style.position = "fixed";
    wrapper.append(dialog);
    doc.body.append(wrapper);
    const child = preview(iframe, entry.id);
    fireEvent.load(iframe);
    for (let turn = 0; turn < 3; turn++) { tick(); tick(); child.complete(); }
    tick();
    expect(view.queryByText("Loading height…") === null).toBe(true);
    expect(iframe.height).toBe(portals ? "844" : "160");
    if (!portals) {
      view.update({ stories: [{ ...entry, portals: true }] });
      expect(iframe.height).toBe("844");
    }
  });
}

test("only trusted child pointerdown activates; programmatic focus and untrusted events do not", async () => {
  const view = sheet([story("frame", () => null, "<Portal />")]);
  const activated: string[] = [];
  let escaped = 0;
  view.update({ onActivate: (id) => activated.push(id), onEscape: () => { escaped++; } });
  const iframe = view.getByTitle("Fixture · frame") as HTMLIFrameElement;
  fireEvent.load(iframe);
  const doc = iframe.contentDocument!;
  const control = doc.createElement("button");
  doc.body.append(control);
  control.focus();
  fireEvent.pointerDown(control);
  fireEvent.focusIn(control);
  expect(activated).toEqual([]);
  trustedPointerDown(control);
  expect(activated).toEqual(["frame"]);
  const consume = (event: KeyboardEvent) => { if (event.key === "Escape") event.preventDefault(); };
  doc.addEventListener("keydown", consume);
  fireEvent.keyDown(control, { key: "Escape" });
  await flush();
  expect(escaped).toBe(0);
  doc.removeEventListener("keydown", consume);
  fireEvent.keyDown(control, { key: "Enter" });
  fireEvent.keyDown(control, { key: "Escape" });
  await flush();
  expect(escaped).toBe(1);
  view.update({ annotating: true });
  trustedPointerDown(control);
  fireEvent.focusIn(control);
  fireEvent.keyDown(control, { key: "Escape" });
  await flush();
  expect(activated).toHaveLength(1);
  expect(escaped).toBe(1);
});

test("reload and unmount remove child listeners and fence pending Escape from the old generation", async () => {
  const view = sheet([story("frame", () => null, "<Portal />")]);
  let activated = 0;
  let escaped = 0;
  view.update({ onActivate: () => { activated++; }, onEscape: () => { escaped++; } });
  const iframe = view.getByTitle("Fixture · frame") as HTMLIFrameElement;
  fireEvent.load(iframe);
  const previous = iframe.contentDocument!;
  fireEvent.keyDown(previous.body, { key: "Escape" });
  const replacement = document.implementation.createHTMLDocument();
  Object.defineProperty(replacement, "defaultView", { value: window });
  Object.defineProperty(iframe, "contentDocument", { configurable: true, value: replacement });
  fireEvent.load(iframe);
  trustedPointerDown(previous.body);
  fireEvent.focusIn(previous.body);
  await flush();
  expect(activated).toBe(0);
  expect(escaped).toBe(0);
  trustedPointerDown(replacement.body);
  fireEvent.focusIn(replacement.body);
  expect(activated).toBe(1);
  fireEvent.keyDown(replacement.body, { key: "Escape" });
  view.unmount();
  trustedPointerDown(replacement.body);
  fireEvent.focusIn(replacement.body);
  fireEvent.keyDown(replacement.body, { key: "Escape" });
  await flush();
  expect(activated).toBe(1);
  expect(escaped).toBe(0);
  expect(callbacks.size).toBe(0);
});

test("a framed play focus preserves restored Default props until intentional activation", () => {
  const stories = [story("default", ({ children }) => <button>{String(children)}</button>),
    story("play", () => null, "", "Play function")];
  const view = sheet(stories);
  view.update({ focused: "default", focusedArgs: { children: "PERSISTED" },
    onActivate: (id) => view.update({ focused: id, focusedArgs: null }) });
  const iframe = view.getByTitle("Fixture · play") as HTMLIFrameElement;
  fireEvent.load(iframe);
  const control = iframe.contentDocument!.createElement("button");
  iframe.contentDocument!.body.append(control);
  act(() => control.focus());
  expect(view.getByRole("button", { name: "PERSISTED" })).toBeTruthy();
  expect(view.getByRole("button", { name: "default" }).getAttribute("aria-pressed")).toBe("true");
  trustedPointerDown(control);
  expect(view.getByRole("button", { name: "play" }).getAttribute("aria-pressed")).toBe("true");
});

test("JSX apostrophes do not let a portal escape into the Library document", () => {
  const source = "const Content = () => <div>Don't miss <Primitive.Portal/> today's content</div>";
  const Primitive = { Portal: () => createPortal(<p>Escaped overlay</p>, document.body) };
  const Content = () => <div>{"Don't miss "}<Primitive.Portal />{" today's content"}</div>;
  const view = sheet([story("apostrophe", Content, source)]);
  expect(view.queryByText("Escaped overlay")).toBeNull();
  expect(document.body.textContent).not.toContain("Escaped overlay");
  expect(view.getByTitle("Fixture · apostrophe")).toBeTruthy();
});

test("raw story and lexed imports prevent parent-document portal escapes", async () => {
  for (const source of [
    'const Content = lazy(() => import("./dialog"));',
    'import Dialog from /* c */ "./dialog";',
    'import /* c */ "./dialog";',
    'import Dialog from "\\u002e/dialog";',
    'const Content = lazy(() => import("\\u002e/dialog"));',
    'export const Default = { render: () => <Portal /> };',
  ]) {
    const key = "../../../../components/ui/fixture.stories.tsx";
    const rule = await readPortalRule(key, { [key]: async () => source,
      "../../../../components/ui/dialog.tsx": async () => "<Primitive.Portal />" }, {
      [key]: await lexLibraryImports(source, "fixture.stories.tsx"),
      "../../../../components/ui/dialog.tsx": await lexLibraryImports("<Primitive.Portal />", "dialog.tsx"),
    });
    const entry = story("raw-portal", () => createPortal(<p>Escaped raw overlay</p>, document.body));
    const view = sheet([{ ...entry, portals: rule.portals, frame: frameReason({}, {}, rule.portals, rule.sourceReadable) }]);
    expect(document.body.textContent).not.toContain("Escaped raw overlay");
    expect(view.getByTitle("Fixture · raw-portal")).toBeTruthy();
    view.unmount();
  }
});

test("desktop frames keep their declared dimensions and expose a standalone scaled caption link", () => {
  const entry = { ...story("desktop", () => null, "", "Declared viewport"), viewport: { width: 1440, height: 900 } };
  const view = sheet([entry]);
  const iframe = view.getByTitle("Fixture · desktop") as HTMLIFrameElement;
  expect(iframe.width).toBe("1440");
  expect(iframe.height).toBe("900");
  const link = view.getByRole("link", { name: "1440 × 900 · scaled" });
  expect(link.getAttribute("href")).toContain("id=desktop");
  expect(link.getAttribute("target")).toBe("_blank");
  const child = preview(iframe, entry.id);
  fireEvent.load(iframe);
  for (let turn = 0; turn < 3; turn++) { tick(); tick(); child.complete(); }
  tick();
  expect(iframe.height).toBe("900");
});

test("hidden theme stories are disclosed once at the end of the sheet", () => {
  const view = sheet([story("default", () => <p>Visible story</p>)]);
  expect(view.queryByText(/theme-pinned/)).toBeNull();
  view.update({ hiddenThemes: 2 });
  expect(view.getByText("2 theme-pinned stories hidden · use Theme")).toBeTruthy();
  expect(view.container.lastElementChild?.textContent).toBe("2 theme-pinned stories hidden · use Theme");
  view.update({ hiddenThemes: 1 });
  expect(view.getByText("1 theme-pinned story hidden · use Theme")).toBeTruthy();
});

test("a failed section recovers on args changes without remounting a healthy section", () => {
  let healthyMounts = 0;
  function Fragile({ crash = false }: Record<string, unknown>) {
    if (crash) throw new Error("Invalid crash args");
    return <p>Recovered story</p>;
  }
  function Healthy() {
    useEffect(() => { healthyMounts++; }, []);
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
  }
  const view = sheet([story("fragile", Fragile), story("healthy", Healthy)]);
  fireEvent.click(view.getByText("Count 0"));
  view.update({ focused: "fragile", focusedArgs: { crash: true } });
  expect(view.getByRole("alert").textContent).toBe("Invalid crash args");
  view.update({ focusedArgs: { crash: false } });
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.getByText("Recovered story")).toBeTruthy();
  expect(view.getByText("Count 1")).toBeTruthy();
  expect(healthyMounts).toBe(1);
});

for (const input of ["identity", "theme"]) {
  test(`a failed section retries when its ${input} changes`, () => {
    let crash = true;
    const Original = () => { if (crash) throw new Error("Render crash"); return <p>Retried story</p>; };
    const view = sheet([story("retry", Original)]);
    expect(view.getByRole("alert").textContent).toBe("Render crash");
    crash = false;
    view.update(input === "identity" ? { stories: [story("retry", () => <p>Retried story</p>)] } : { theme: "dark" });
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Retried story")).toBeTruthy();
  });
}

test("Enter and Space on an annotation anchor exit annotation for document and framed sections", async () => {
  const view = sheet([story("inline", () => null), story("frame", () => null, "<Portal />")]);
  let exits = 0;
  view.update({ annotating: true, onExitAnnotate: () => { exits++; } });
  await flush();
  for (const name of [/^Fixture · inline$/, /^Fixture · frame · /]) {
    for (const key of ["Enter", " "]) {
      const before = exits;
      fireEvent.keyDown(view.getByRole("button", { name }), { key });
      expect(exits).toBe(before + 1);
    }
  }
});
