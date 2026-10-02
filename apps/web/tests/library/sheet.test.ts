import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { componentModulePaths, frameReason, hasPinnedTheme, rendersPortal } from "@/stories/review/explorations/library/isolation";
import {
  createFrameSlots, declaredViewport, fittedFrameHeight, framedWidth, restoredFocus, scaledViewport, spansFullRow, toggleFocus,
} from "@/stories/review/explorations/library/sheet-state";
import { readLibraryUrl, writeLibraryUrl } from "@/stories/review/explorations/library/url-state";

describe("section isolation rules", () => {
  test("plain stories render in the Library document", () => {
    expect(frameReason({ args: { children: "Continue" }, parameters: { layout: "centered" } },
      { args: { disabled: true }, loaders: [] })).toBeNull();
  });

  test("stories that need their own preview fall back to a frame, in rule order", () => {
    const play = () => undefined;
    expect(frameReason({}, { loaders: [async () => ({})], play })).toBe("Loaders");
    expect(frameReason({ loaders: [async () => ({})] }, {})).toBe("Loaders");
    expect(frameReason({}, { parameters: { msw: { handlers: [] } }, play })).toBe("Network mocks");
    expect(frameReason({ parameters: { msw: { handlers: { balances: [] } } } }, {})).toBe("Network mocks");
    expect(frameReason({ parameters: { msw: [] } }, {})).toBeNull();
    expect(frameReason({ beforeEach: () => undefined }, { play })).toBe("Setup hook");
    expect(frameReason({}, { play })).toBeNull();
    expect(frameReason({ play }, {})).toBeNull();
    expect(frameReason({}, { globals: { locale: "en" } })).toBe("Pinned globals");
    expect(frameReason({ globals: { theme: "dark" } }, {})).toBeNull();
    expect(frameReason({}, { globals: { theme: "dark" } })).toBeNull();
    expect(frameReason({ globals: { locale: "en", theme: "dark" } }, {})).toBe("Pinned globals");
    expect(frameReason({ args: { defaultOpen: true } }, {})).toBe("Opens an overlay");
    expect(frameReason({}, { args: { open: true } })).toBe("Opens an overlay");
    expect(frameReason({ args: { open: true } }, { args: { open: false } })).toBeNull();
  });

  test("raw source detection conservatively frames portal text, comments and wrappers", () => {
    for (const source of [
      "const Content = () => <DialogPrimitive.Portal><Popup /></DialogPrimitive.Portal>",
      "const Content = () => <DrawerPortal />",
      "const Content = () => <Portal />",
      "const Content = () => createPortal(children, document.body)",
      "const Content = () => ReactDOM.createPortal(children, document.body)",
      "const Content = () => <div>Don't miss <Primitive.Portal/> today's content</div>",
      'const label = "Portal";',
      '// <Portal />\n/* createPortal(children, document.body) */',
      'const label = "<Portal />"; const tooltip = `createPortal()`;',
      "type Props = Primitive.Portal.Props; const Portal = 'placeholder'",
    ]) expect(rendersPortal(source)).toBe(true);
    for (const source of [
      "const Content = () => <Button>Continue</Button>",
    ]) expect(rendersPortal(source)).toBe(false);
  });

  test("story imports resolve relative and aliased UI modules without a component roster", () => {
    expect(componentModulePaths(["./drawer", "@/components/ui/button", "../ui/dialog.tsx", "./button", "@/client/money-modal"],
      "components/ui/drawer.stories.tsx")).toEqual([
      "components/ui/drawer", "components/ui/button", "components/ui/dialog.tsx",
    ]);
  });

  test("theme pins at either annotation level are hidden, including when a story overrides meta", () => {
    expect(hasPinnedTheme({}, {})).toBe(false);
    expect(hasPinnedTheme({}, { globals: { locale: "en" } })).toBe(false);
    expect(hasPinnedTheme({}, { globals: { theme: "dark" } })).toBe(true);
    expect(hasPinnedTheme({ globals: { theme: "dark" } }, {})).toBe(true);
    expect(hasPinnedTheme({ globals: { theme: "dark" } }, { globals: { theme: "light" } })).toBe(true);
    const stories = [{ id: "default", annotation: {} }, { id: "dark", annotation: { globals: { theme: "dark" } } }];
    const visible = stories.filter((story) => !hasPinnedTheme({}, story.annotation)).map((story) => story.id);
    expect(restoredFocus("dark", visible)).toBeNull();
    expect(restoredFocus("default", visible)).toBe("default");
  });

  test("per-story render overrides win over portal detection but not existing isolation rules", () => {
    expect(frameReason({}, {}, true)).toBe("Portals outside the sheet");
    expect(frameReason({}, { parameters: { library: { render: "document" } } }, true)).toBeNull();
    expect(frameReason({}, { parameters: { library: { render: "frame" } } })).toBe("Library override");
    expect(frameReason({}, { parameters: { library: { render: "invalid" } } }, true)).toBe("Portals outside the sheet");
    expect(frameReason({ parameters: { library: { render: "document" } } }, {}, true)).toBe("Portals outside the sheet");
    expect(frameReason({}, { play: () => {}, parameters: { library: { render: "document" } } }, true)).toBeNull();
    expect(frameReason({}, {}, false, false)).toBe("Couldn't read component source");
    expect(frameReason({}, { parameters: { library: { render: "document" } } }, false, false))
      .toBe("Couldn't read component source");
  });
});

describe("section focus", () => {
  test("activating a heading focuses its section and activating it again clears focus", () => {
    expect(toggleFocus(null, "ui-button--default")).toBe("ui-button--default");
    expect(toggleFocus("ui-button--default", "ui-button--default")).toBeNull();
    expect(toggleFocus("ui-button--default", "ui-button--sizes")).toBe("ui-button--sizes");
  });

  test("a linked focus survives only when the story belongs to the sheet", () => {
    const stories = ["ui-button--default", "ui-button--sizes"];
    expect(restoredFocus("ui-button--sizes", stories)).toBe("ui-button--sizes");
    expect(restoredFocus("ui-badge--default", stories)).toBeNull();
    expect(restoredFocus(undefined, stories)).toBeNull();
  });
});

describe("frame fallback scheduling", () => {
  test("frames load a bounded number at a time and release their slot when settled or removed", () => {
    const slots = createFrameSlots(2);
    const granted: string[] = [];
    const release = ["a", "b", "c", "d"].map((id) => slots.request(id, () => granted.push(id)));
    expect(granted).toEqual(["a", "b"]);
    release[3]();
    release[0]();
    expect(granted).toEqual(["a", "b", "c"]);
    release[0]();
    release[1]();
    release[2]();
    expect(granted).toEqual(["a", "b", "c"]);
    expect(() => createFrameSlots(0)).toThrow();
  });

  test("visible waiting tickets take the next free slot without evicting admitted frames", () => {
    const slots = createFrameSlots(2);
    const granted: string[] = [];
    const release = slots.request("first", () => granted.push("first"));
    slots.request("second", () => granted.push("second"));
    slots.request("preload", () => granted.push("preload"), { visible: () => false });
    slots.request("visible", () => granted.push("visible"), { visible: () => true });
    slots.prioritize();
    expect(granted).toEqual(["first", "second"]);
    release();
    expect(granted).toEqual(["first", "second", "visible"]);
  });

  test("frames fit their measured content within the phone height", () => {
    expect(fittedFrameHeight(40, false)).toBe(160);
    expect(fittedFrameHeight(300, false)).toBe(348);
    expect(fittedFrameHeight(2000, false)).toBe(844);
    expect(fittedFrameHeight(Number.NaN, false)).toBe(844);
  });
  test("portal frames stay 560 tall regardless of content, while fullscreen retains its height", () => {
    for (const content of [40, 2000, Number.NaN, Infinity]) expect(fittedFrameHeight(content, true)).toBe(560);
    expect(fittedFrameHeight(40, false, true)).toBe(844);
    expect(fittedFrameHeight(40, true, true)).toBe(844);
  });
});

describe("declared frame viewports", () => {
  const viewports = {
    money1440: { styles: { width: "1440px", height: "900px" } },
    money1024: { styles: { width: "1024px", height: "768px" } },
    phone: { styles: { width: "430px", height: "932px" } },
  };

  test("legacy defaultViewport resolves the desktop Drawer dimensions", () => {
    expect(declaredViewport({ viewport: { viewports, defaultViewport: "money1440" } })).toEqual({ width: 1440, height: 900 });
    expect(declaredViewport({ viewport: { viewports, defaultViewport: "money1024" } })).toEqual({ width: 1024, height: 768 });
  });

  test("global selection overrides parameters and supports modern options and rotation", () => {
    const parameters = { viewport: { options: viewports, defaultViewport: "money1440" } };
    expect(declaredViewport(parameters, { viewport: "money1024" })).toEqual({ width: 1024, height: 768 });
    expect(declaredViewport(parameters, { viewport: { value: "money1024", isRotated: true } }))
      .toEqual({ width: 768, height: 1024 });
    expect(declaredViewport(parameters, { viewport: { value: "phone" } })).toBeUndefined();
    expect(declaredViewport(parameters, { viewport: { value: "reset" } })).toBeUndefined();
  });

  test("phone-sized, absent, disabled and invalid declarations keep the default phone behavior", () => {
    expect(declaredViewport({})).toBeUndefined();
    expect(declaredViewport({ viewport: { viewports, defaultViewport: "phone" } })).toBeUndefined();
    expect(declaredViewport({ viewport: { viewports, defaultViewport: "unknown" } })).toBeUndefined();
    expect(declaredViewport({ viewport: { viewports, defaultViewport: "money1440", disable: true } })).toBeUndefined();
    for (const styles of [
      { width: "100%", height: "900px" }, { width: "1440px", height: "auto" },
      { width: -1, height: 900 }, { width: 1440, height: 0 }, { width: Infinity, height: 900 },
      { width: "767px", height: "900px" },
    ]) expect(declaredViewport({ viewport: { options: { custom: { styles } }, defaultViewport: "custom" } })).toBeUndefined();
    expect(declaredViewport({ viewport: { options: { custom: { styles: { width: 768, height: 600 } } }, defaultViewport: "custom" } }))
      .toEqual({ width: 768, height: 600 });
  });

  test("scale math fits the available column without upscaling and reserves the exact scaled result", () => {
    const desktop = { width: 1440, height: 900 };
    const phoneColumn = scaledViewport(desktop, 390);
    expect(phoneColumn.width).toBe(390);
    expect(phoneColumn.height).toBeCloseTo(243.75);
    expect(phoneColumn.scale).toBe(390 / 1440);
    expect(scaledViewport(desktop, 720)).toEqual({ width: 720, height: 450, scale: 0.5 });
    expect(scaledViewport(desktop, 2000)).toEqual({ width: 1440, height: 900, scale: 1 });
    for (const available of [0, -1, Number.NaN, Infinity]) expect(scaledViewport(desktop, available)).toEqual(phoneColumn);
    expect(scaledViewport({ width: 1024, height: 768 }, 390).height).toBeCloseTo(292.5);
  });

  test("undeclared frames fill a narrow stage but never exceed the phone width", () => {
    expect(framedWidth(320)).toBe(320);
    expect(framedWidth(1200)).toBe(390);
    for (const available of [0, -1, Number.NaN, Infinity]) expect(framedWidth(available)).toBe(390);
  });
});

describe("sheet grid spans", () => {
  const base = { layout: "padded", frame: null, portals: false };
  test("fullscreen layouts and declared viewports span the full row", () => {
    expect(spansFullRow({ ...base, layout: "fullscreen" })).toBe(true);
    expect(spansFullRow({ ...base, frame: "Declared viewport", viewport: { width: 1440, height: 900 } })).toBe(true);
    expect(spansFullRow({ ...base, layout: "fullscreen", frame: "Renders a portal", portals: true })).toBe(true);
  });
  test("other stories take one cell", () => {
    expect(spansFullRow(base)).toBe(false);
    expect(spansFullRow({ ...base, layout: "centered" })).toBe(false);
    expect(spansFullRow({ ...base, frame: "Uses loaders" })).toBe(false);
    expect(spansFullRow({ ...base, frame: "Renders a portal", portals: true })).toBe(false);
    expect(spansFullRow({ ...base, portals: true })).toBe(false);
  });
});

describe("sheet URL", () => {
  test("component, focused story and props round-trip, and clearing focus removes them", () => {
    const base = new URL("https://example.test/iframe.html?id=review-library--library&rev=abc");
    const focused = writeLibraryUrl(base, { component: "ui-button", story: "ui-button--sizes", props: { size: "lg" } });
    expect(readLibraryUrl(focused)).toEqual({ component: "ui-button", story: "ui-button--sizes", props: { size: "lg" } });
    const cleared = writeLibraryUrl(focused, { component: "ui-button", story: undefined, props: {} });
    expect(cleared.searchParams.has("story")).toBe(false);
    expect(cleared.searchParams.has("props")).toBe(false);
    expect(cleared.searchParams.get("rev")).toBe("abc");
    expect(readLibraryUrl(cleared)).toEqual({ component: "ui-button", story: undefined, props: {} });
  });
});
