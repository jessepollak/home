import { expect, test } from "bun:test";
import { componentModulePaths, frameReason, readPortalRule, resolveComponentPath } from "@/stories/review/explorations/library/isolation";

const key = "../../../../components/ui/probe.stories.tsx";
const button = "../../../../components/ui/button.tsx";
const dialog = "../../../../components/ui/dialog.tsx";

function sources(source: string) {
  return { [key]: async () => source, [button]: async () => "<Button />", [dialog]: async () => "<Primitive.Portal />" };
}

test("raw import paths include comments, types, strings and templates conservatively", () => {
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
    "components/ui/ghost", "components/ui/button", "components/ui/dialog.js", "components/ui/menu", "components/ui/styles",
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

test("a commented unresolved UI import intentionally frames an otherwise readable story", async () => {
  expect(await readPortalRule(key, sources('// import { Ghost } from "./ghost";\nimport { Button } from "./button";')))
    .toEqual({ portals: false, sourceReadable: false });
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

for (const [name, source] of [
  ["regex literal", 'const pattern = /}/; import { Dialog } from "./dialog";'],
  ["overlapping raw matches", 'const pattern = /from "/; import { Dialog } from "./dialog";'],
  ["lazy dynamic import", 'const Dialog = lazy(() => import("./dialog"));'],
  ["multiline import", 'import {\n  Dialog,\n  DialogContent\n} from\n"./dialog";'],
  ["export star", 'export * from "./dialog";'],
  ["side-effect import", 'import "./dialog";'],
  ["inline Portal", 'export const Default = { render: () => <Portal /> };'],
  ["inline createPortal", 'export const Default = { render: () => createPortal("overlay", document.body) };'],
  ["commented Portal", '// <Portal />'],
] as const) {
  test(`${name} selects portal isolation`, async () => {
    const rule = await readPortalRule(key, sources(source));
    expect(rule).toEqual({ portals: true, sourceReadable: true });
    expect(frameReason({}, {}, rule.portals, rule.sourceReadable)).toBe("Portals outside the sheet");
  });
}

for (const source of ['import(x)', 'import( x )', 'import("./" + x)', 'import(`./${x}`)', '// import(x)']) {
  test(`${source} conservatively frames unsupported import expressions`, async () => {
    const rule = await readPortalRule(key, sources(source));
    expect(rule.sourceReadable).toBe(false);
    expect(frameReason({}, {}, rule.portals, rule.sourceReadable)).toBe("Couldn't read component source");
  });
}

test("reachable UI imports are scanned cycle-safe, including dynamic imports and re-exports", async () => {
  let reads = 0;
  const modules = { ...sources('import { Button } from "./button";'),
    [button]: async () => { reads++; return 'export * from "./nested";'; },
    "../../../../components/ui/nested/index.tsx": async () => 'import("../button"); import("../dialog");',
    [dialog]: async () => 'import "./button"; <Primitive.Portal />',
  };
  expect(await readPortalRule(key, modules)).toEqual({ portals: true, sourceReadable: true });
  expect(reads).toBe(1);
});

test("unresolved imports and unsupported dynamic imports in component sources fail closed", async () => {
  for (const source of ['import "./missing";', 'const Content = lazy(() => import(path));']) {
    const rule = await readPortalRule(key, { ...sources('import { Button } from "./button";'), [button]: async () => source });
    expect(rule.sourceReadable).toBe(false);
    expect(frameReason({}, {}, rule.portals, rule.sourceReadable)).toBe("Couldn't read component source");
  }
});

test("local sources outside components/ui and packages remain outside the inspection boundary", async () => {
  const source = 'import "@/client/money-modal"; import "../../shared/classnames"; import "react";';
  expect(componentModulePaths(source, key)).toEqual([]);
  expect(await readPortalRule(key, sources(source))).toEqual({ portals: false, sourceReadable: true });
});
