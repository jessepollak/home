import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { lexLibraryImports, libraryImportsPlugin } from "../../.storybook/library-imports-plugin";

for (const [name, source] of [
  ["commented from", "import Dialog from /* c */ './dialog';"],
  ["commented side effect", "import /* c */ './dialog';"],
  ["escaped static", 'import Dialog from "\\u002e/dialog";'],
  ["escaped dynamic", 'const Dialog = lazy(() => import("\\u002e/dialog"));'],
  ["regex literal", 'const pattern = /}/; import Dialog from "./dialog";'],
  ["lazy import", "const Dialog = lazy(() => import('./dialog'));"],
  ["multiline import", 'import {\n Dialog,\n DialogContent\n} from\n"./dialog";'],
  ["export star", 'export * from "./dialog";'],
] as const) {
  test(`lexes ${name}`, async () => {
    expect(await lexLibraryImports(source, "probe.tsx")).toEqual({
      specifiers: ["./dialog"], nonLiteralDynamic: false, lexFailure: false,
    });
  });
}

test("comments, strings and type-only imports are not executable import edges", async () => {
  expect(await lexLibraryImports(`
    // import Dialog from './dialog';
    /* export * from './dialog'; */
    const label = "import Dialog from './dialog';";
    const template = \`export * from './dialog';\`;
    import type { Dialog } from './dialog';
    export type { Dialog } from './dialog';
  `, "probe.tsx")).toEqual({ specifiers: [], nonLiteralDynamic: false, lexFailure: false });
});

test("TS and JSX are stripped without removing unused executable imports", async () => {
  const result = await lexLibraryImports('import Dialog from "./dialog"; const node: unknown = <span />;', "probe.tsx");
  expect(result.specifiers).toContain("./dialog");
  expect(result.lexFailure).toBe(false);
});

for (const source of ["import(x)", "import( x )", 'import("./" + x)', 'import(`./${x}`)']) {
  test(`flags non-literal ${source}`, async () => {
    expect(await lexLibraryImports(source, "probe.tsx")).toEqual({ specifiers: [], nonLiteralDynamic: true, lexFailure: false });
  });
}

test("import.meta is not a non-literal dynamic import", async () => {
  expect(await lexLibraryImports("const url = import.meta.url;", "probe.tsx"))
    .toEqual({ specifiers: [], nonLiteralDynamic: false, lexFailure: false });
});

test("invalid source reports a lex failure instead of a safe empty import graph", async () => {
  expect(await lexLibraryImports('import { from "./dialog";', "probe.tsx"))
    .toEqual({ specifiers: [], nonLiteralDynamic: false, lexFailure: true });
});

test("watched source changes, additions and deletions invalidate the virtual module and reload", () => {
  const plugin = libraryImportsPlugin("/fixture");
  const watcher = Object.assign(new EventEmitter(), { add: (_path: string) => {} });
  const node = {};
  const invalidated: unknown[] = [];
  const messages: unknown[] = [];
  const server = { watcher, moduleGraph: {
    getModuleById: (id: string) => id === "\u0000virtual:library-imports" ? node : undefined,
    invalidateModule: (value: unknown) => { invalidated.push(value); },
  }, ws: { send: (message: unknown) => { messages.push(message); } } };
  if (typeof plugin.configureServer !== "function") throw new Error("Missing configureServer hook");
  Reflect.apply(plugin.configureServer, undefined, [server]);
  for (const event of ["change", "add", "unlink"]) {
    watcher.emit(event, "/fixture/components/ui/probe.stories.tsx");
    watcher.emit(event, "/fixture/components/ui/nested/index.tsx");
    watcher.emit(event, "/fixture/components/ui/nested/ignored.tsx");
    watcher.emit(event, "/fixture/client/ignored.tsx");
  }
  expect(invalidated).toEqual(Array(6).fill(node));
  expect(messages).toEqual(Array(6).fill({ type: "full-reload" }));
  if (typeof plugin.closeBundle !== "function") throw new Error("Missing closeBundle hook");
  Reflect.apply(plugin.closeBundle, undefined, []);
  watcher.emit("change", "/fixture/components/ui/probe.stories.tsx");
  expect(messages).toHaveLength(6);
});
