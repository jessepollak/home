import { expect, test } from "bun:test";
import { componentModulePaths, frameReason, readPortalRule, resolveComponentPath } from "@/stories/review/explorations/library/isolation";

const key = "../../../../components/ui/probe.stories.tsx";
const button = "../../../../components/ui/button.tsx";
const dialog = "../../../../components/ui/dialog.tsx";

function sources(source: string) {
  return { [key]: async () => source, [button]: async () => "<Button />", [dialog]: async () => "<Primitive.Portal />" };
}

test("direct import paths ignore commented code, type imports and string contents", () => {
  expect(componentModulePaths(`
    // import { Ghost } from './ghost';
    /* export { Ghost } from './ghost'; */
    const label = "import { Ghost } from './ghost';";
    const template = \`export { Ghost } from './ghost';\`;
    import type { Ghost } from './ghost';
    export type { Ghost } from './ghost';
    import { Button } /* import { Ghost } from './ghost'; */ from './button';
    export { Dialog } from './dialog.js';
    export * from '@/components/ui/menu';
    import './styles';
  `, "components/ui/probe.stories.tsx")).toEqual([
    "components/ui/button", "components/ui/dialog.js", "components/ui/menu", "components/ui/styles",
  ]);
});

test("source resolution tries real keys in exact, extension-substitution and index order", () => {
  const base = "../../../../components/ui/dialog";
  expect(resolveComponentPath(`${base}.js`, [`${base}.js`, `${base}.tsx`])).toBe(`${base}.js`);
  for (const extension of ["", ".js", ".jsx", ".ts", ".tsx"]) {
    expect(resolveComponentPath(`${base}${extension}`, [`${base}.tsx`])).toBe(`${base}.tsx`);
  }
  expect(resolveComponentPath(`${base}.js`, [`${base}.ts`])).toBe(`${base}.ts`);
  expect(resolveComponentPath(base, [`${base}/index.tsx`])).toBe(`${base}/index.tsx`);
  expect(resolveComponentPath(base, [])).toBeUndefined();
});

test("a .js import reads the existing TSX portal component", async () => {
  expect(await readPortalRule(key, sources('import { Dialog } from "./dialog.js";')))
    .toEqual({ portals: true, sourceReadable: true });
});

test("a commented import cannot reject otherwise readable story sources", async () => {
  expect(await readPortalRule(key, sources('// import { Ghost } from "./ghost";\nimport { Button } from "./button";')))
    .toEqual({ portals: false, sourceReadable: true });
});

test("unresolvable or rejected component source fails closed without rejecting the story load", async () => {
  const unreadable = { portals: false, sourceReadable: false };
  const rules = await Promise.all([
    readPortalRule(key, sources('import { Ghost } from "./ghost";')),
    readPortalRule(key, { ...sources('import { Dialog } from "./dialog";'), [dialog]: async () => { throw new Error("Read failed"); } }),
    readPortalRule(key, {}),
  ]);
  expect(rules).toEqual([unreadable, unreadable, unreadable]);
  for (const rule of rules) expect(frameReason({}, {}, rule.portals, rule.sourceReadable)).toBe("Couldn't read component source");
});

test("one-level index and export-from sources can trigger portal isolation", async () => {
  const indexed = { ...sources('export { Dialog } from "./nested";'),
    "../../../../components/ui/nested/index.tsx": async () => "<Primitive.Portal />" };
  expect(await readPortalRule(key, indexed)).toEqual({ portals: true, sourceReadable: true });
});
