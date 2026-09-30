import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { componentModulePaths, frameReason, rendersPortal } from "@/stories/review/explorations/library/isolation";
import {
  createFrameSlots, fittedFrameHeight, restoredFocus, toggleFocus,
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
    expect(frameReason({}, { play })).toBe("Play function");
    expect(frameReason({ play }, {})).toBe("Play function");
    expect(frameReason({}, { globals: { theme: "dark" } })).toBe("Pinned globals");
    expect(frameReason({ args: { defaultOpen: true } }, {})).toBe("Opens an overlay");
    expect(frameReason({}, { args: { open: true } })).toBe("Opens an overlay");
    expect(frameReason({ args: { open: true } }, { args: { open: false } })).toBeNull();
  });

  test("portal detection recognizes JSX wrappers, namespace portals and createPortal calls", () => {
    for (const source of [
      "const Content = () => <DialogPrimitive.Portal><Popup /></DialogPrimitive.Portal>",
      "const Content = () => <DrawerPortal />",
      "const Content = () => <Portal />",
      "const Content = () => createPortal(children, document.body)",
      "const Content = () => ReactDOM.createPortal(children, document.body)",
    ]) expect(rendersPortal(source)).toBe(true);
    for (const source of [
      "const Content = () => <Button>Continue</Button>",
      '// <Portal />\n/* createPortal(children, document.body) */',
      'const label = "<Portal />"; const tooltip = `createPortal()`;',
      "type Props = Primitive.Portal.Props; const Portal = 'placeholder'",
    ]) expect(rendersPortal(source)).toBe(false);
  });

  test("story imports resolve relative and aliased UI modules without a component roster", () => {
    expect(componentModulePaths(`
      import { Drawer } from './drawer';
      import { Button } from '@/components/ui/button';
      import { Dialog } from '../ui/dialog.tsx';
      import { Button as OtherButton } from './button';
      import { Modal } from '@/client/money-modal';
      import type { Props } from './unused';
    `, "components/ui/drawer.stories.tsx")).toEqual([
      "components/ui/drawer.tsx", "components/ui/button.tsx", "components/ui/dialog.tsx",
    ]);
  });

  test("per-story render overrides win over portal detection but not existing isolation rules", () => {
    expect(frameReason({}, {}, true)).toBe("Portals outside the sheet");
    expect(frameReason({}, { parameters: { library: { render: "document" } } }, true)).toBeNull();
    expect(frameReason({}, { parameters: { library: { render: "frame" } } })).toBe("Library override");
    expect(frameReason({}, { parameters: { library: { render: "invalid" } } }, true)).toBe("Portals outside the sheet");
    expect(frameReason({ parameters: { library: { render: "document" } } }, {}, true)).toBe("Portals outside the sheet");
    expect(frameReason({}, { play: () => {}, parameters: { library: { render: "document" } } }, true)).toBe("Play function");
  });
});

describe("section focus", () => {
  test("clicking a section focuses it and clicking it again clears focus", () => {
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

  test("frames fit their measured content within the phone height", () => {
    expect(fittedFrameHeight(40, false)).toBe(160);
    expect(fittedFrameHeight(300, false)).toBe(348);
    expect(fittedFrameHeight(2000, false)).toBe(844);
    expect(fittedFrameHeight(40, true)).toBe(844);
    expect(fittedFrameHeight(Number.NaN, false)).toBe(844);
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
