import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, test } from "bun:test";
import { lexLibraryImports } from "../../.storybook/library-imports-plugin";
import { frameReason, readPortalRule } from "@/stories/review/explorations/library/isolation";

const { act, cleanup, render } = await import("@testing-library/react");
const { VariantSheet } = await import("@/stories/review/explorations/library/sheet");
const originalIntersection = globalThis.IntersectionObserver;
beforeEach(() => { globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver; });
afterEach(() => { cleanup(); globalThis.IntersectionObserver = originalIntersection; });

for (const name of ["commented", "escaped"]) {
  test(`${name} executable import cannot mount its real portal in the parent document`, async () => {
    const key = "../../../../components/ui/probe.stories.tsx";
    const dialog = "../../../../components/ui/dialog.tsx";
    const source = name === "commented" ? 'import Dialog from /* explanation */ "./dialog";'
      : 'const Dialog = lazy(() => import("\\u002e/dialog"));';
    const dialogSource = 'createPortal(<p>Escaped imported overlay</p>, document.body);';
    const rule = await readPortalRule(key, { [key]: async () => source, [dialog]: async () => dialogSource }, {
      [key]: await lexLibraryImports(source, "probe.stories.tsx"),
      [dialog]: await lexLibraryImports(dialogSource, "dialog.tsx"),
    });
    const { Default } = await import(`./fixtures/${name}.stories`);
    const view = render(<VariantSheet root={null} component="Probe" changed={false} stories={[{
      id: "probe", name: "Probe", Story: Default, argTypes: {}, initialArgs: {}, layout: "centered", themePinned: false,
      portals: rule.portals, frame: frameReason({}, {}, rule.portals, rule.sourceReadable),
    }]} theme="light" focused={null} focusedArgs={null} annotating={false} frameSource="blank"
      onToggle={() => {}} onEscape={() => {}} onExitAnnotate={() => {}} />);
    await act(async () => { await import("./fixtures/dialog"); });
    expect(rule).toEqual({ portals: true, sourceReadable: true });
    expect(document.body.textContent).not.toContain("Escaped imported overlay");
    expect(view.getByTitle("Probe · Probe")).toBeTruthy();
  });
}
