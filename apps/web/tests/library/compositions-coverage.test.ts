import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { requireStoryMeta } from "./fixtures/story-meta";
import { compositionNotUsedInProduct, compositionUiImports, lexCompositionUiImports, libraryImportsPlugin, productUiImports, walkCompositionUiImports } from "../../.storybook/library-imports-plugin";
import type { ReviewBuild, StoryIndexEntry } from "@/stories/review/explorations/board/review-build";
import { libraryCatalog } from "@/stories/review/explorations/library/catalog";

const root = `${import.meta.dir}/../..`;
const build: ReviewBuild = { revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };
const expectedNotUsedInProduct = ["button-group", "dialog", "kbd", "progress"];

function requireCompositionCoverage(components: Map<string, string>, compositions: string[][], product: string[], notUsed: string[]): number {
  const covered = new Set(compositions.flat().filter((name) => components.has(name)));
  const productUsed = new Set(product);
  const listed = new Set(notUsed);
  const invalid = notUsed.filter((name) => !components.has(name));
  if (invalid.length) throw new Error(`Unknown unused components: ${invalid.join(", ")}`);
  const used = notUsed.filter((name) => productUsed.has(name));
  if (used.length) throw new Error(`Listed components are used in product: ${used.join(", ")}`);
  const unlisted = [...components.keys()].filter((name) => !productUsed.has(name) && !listed.has(name));
  if (unlisted.length) throw new Error(`Product-unused catalog components missing from reviewed list: ${unlisted.join(", ")}`);
  const uncovered = [...components].filter(([name]) => productUsed.has(name) && !covered.has(name))
    .map(([name, id]) => `${name} (${id})`).sort();
  if (uncovered.length) throw new Error(`Product-used catalog components not reached by any composition: ${uncovered.join(", ")}`);
  return [...components.keys()].filter((name) => productUsed.has(name) && covered.has(name) || listed.has(name)).length;
}

async function catalogComponents(): Promise<Map<string, string>> {
  const files = [...new Bun.Glob("components/ui/*.stories.tsx").scanSync({ cwd: root })].sort();
  const metas = await Promise.all(files.map(async (file) => {
    const meta = requireStoryMeta(await import(`@/${file}`));
    return { file, id: meta.id ?? meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: meta.title };
  }));
  const index: Record<string, StoryIndexEntry> = Object.fromEntries(metas.map(({ file, id, title }) =>
    [`${id}--default`, { id: `${id}--default`, title, name: "Default", type: "story", importPath: `./${file}` }]));
  const ids = new Set(libraryCatalog(index, build).items.map((item) => item.id));
  return new Map(metas.filter((meta) => ids.has(meta.id))
    .map((meta) => [meta.file.slice("components/ui/".length, -".stories.tsx".length), meta.id]));
}

describe("library compositions", () => {
  test("cover every catalog component or explicitly report it unused", async () => {
    const components = await catalogComponents();
    const imports = await compositionUiImports();
    expect(Object.keys(imports)).toEqual(["card-onboarding.stories.tsx", "coverage.stories.tsx", "home.stories.tsx", "invest.stories.tsx", "operator.stories.tsx"]);
    const compositions = Object.values(imports);
    expect(components.size).toBeGreaterThan(0);
    expect(compositions).toHaveLength(5);
    expect(await compositionNotUsedInProduct()).toEqual(expectedNotUsedInProduct);
    expect(requireCompositionCoverage(components, compositions, await productUiImports(), expectedNotUsedInProduct)).toBe(components.size);
  }, 15_000);

  test("fail when a product-used catalog component has no composition, even if listed unused", () => {
    const components = new Map([["button", "ui-button"], ["rail-nav", "ui-rail-nav"]]);
    expect(() => requireCompositionCoverage(components, [["button"]], ["button", "rail-nav"], []))
      .toThrow("Product-used catalog components not reached by any composition: rail-nav (ui-rail-nav)");
    expect(() => requireCompositionCoverage(components, [["button"]], ["button", "rail-nav"], ["rail-nav"]))
      .toThrow("Listed components are used in product: rail-nav");
  });

  test("enforce the reviewed product-unused list in both directions, independently of compositions", () => {
    const components = new Map([["button", "ui-button"], ["input", "ui-input"]]);
    expect(requireCompositionCoverage(components, [["button", "input"]], ["button"], ["input"])).toBe(2);
    expect(() => requireCompositionCoverage(components, [["button"]], ["button"], []))
      .toThrow("Product-unused catalog components missing from reviewed list: input");
    expect(() => requireCompositionCoverage(components, [["button"]], ["button"], ["missing"]))
      .toThrow("Unknown unused components: missing");
  });

  test("walk transitive value imports, aliases, relative paths, index files and cycles without following packages", async () => {
    const graph = new Map([
      ["/fixture/story.stories.tsx", 'import { Screen } from "@/client/screen"; import { Remote } from "package-name"; import type { Missing } from "./missing";'],
      ["/fixture/client/screen.tsx", 'import { Group } from "./group"; import { type Missing } from "./missing"; import "./side-effect";'],
      ["/fixture/client/group/index.ts", 'export { Button } from "../../components/ui/button.js"; export * from "../screen"; const input = import("@/components/ui/input");'],
      ["/fixture/components/ui/button.tsx", 'import { Label } from "./label"; import {} from "./empty"; export type { Missing } from "./missing";'],
      ["/fixture/components/ui/label/index.tsx", 'import { Button } from "../button";'],
      ["/fixture/components/ui/input.tsx", 'export const Input = 1;'],
      ["/fixture/node_modules/package-name/index.ts", 'import { Remote } from "@/components/ui/remote";'],
    ]);
    const reads: string[] = [];
    const read = async (file: string) => { reads.push(file); return graph.get(file); };
    expect(await walkCompositionUiImports("story.stories.tsx", "/fixture", read)).toEqual(["button", "input", "label"]);
    expect(reads.some((file) => file.includes("node_modules") || file.includes("missing") || file.includes("side-effect") || file.endsWith("empty.tsx"))).toBe(false);
    expect(reads.filter((file) => file === "/fixture/client/screen.tsx")).toHaveLength(1);
  });

  test("walk every Next route entry, excluding stories, tests, explorations and non-route files", async () => {
    const kinds = ["page", "layout", "template", "loading", "error", "global-error", "not-found", "default", "route"];
    const files = kinds.map((kind, index) => `(group)/${kind}/${kind}.${["ts", "tsx", "js", "jsx"][index % 4]}`);
    const graph = new Map(files.map((file, index) => [`/fixture/app/${file}`, `import { UI } from "@/components/ui/route-${index}";`]));
    kinds.forEach((_kind, index) => graph.set(`/fixture/components/ui/route-${index}.tsx`, "export const UI = 1;"));
    graph.set("/fixture/components/ui/route-0.tsx", 'export const UI = 1; import { Story } from "@/client/widget.stories"; import { Test } from "@/client/widget.test"; import { Spec } from "@/client/widget.spec"; import { Exploration } from "@/client/explorations/widget";');
    for (const file of ["client/widget.stories.tsx", "client/widget.test.tsx", "client/widget.spec.tsx", "client/explorations/widget.tsx"]) {
      graph.set(`/fixture/${file}`, 'import { Hidden } from "@/components/ui/hidden";');
    }
    const excluded = ["widget.tsx", "page.stories.tsx", "page.test.tsx", "tests/page.tsx", "__tests__/page.tsx", "stories/page.tsx", "explorations/page.tsx"];
    const reads: string[] = [];
    expect(await productUiImports("/fixture", [...files, ...excluded], async (file) => { reads.push(file); return graph.get(file); }))
      .toEqual(kinds.map((_kind, index) => `route-${index}`));
    expect(excluded.some((file) => reads.includes(`/fixture/app/${file}`))).toBe(false);
    expect(reads.some((file) => file.includes("components/ui/hidden"))).toBe(false);
    await expect(productUiImports("/fixture", ["widget.tsx"])).rejects.toThrow("No product route entries");
  });

  test("fail closed on nonliteral dynamic imports with their file and position", async () => {
    const source = 'const modulePath = "@/components/ui/button"; import(modulePath);';
    await expect(lexCompositionUiImports(source, "probe.stories.tsx"))
      .rejects.toThrow(/Nonliteral dynamic composition import in probe\.stories\.tsx at offset \d+/);
    await expect(walkCompositionUiImports("story.tsx", "/fixture", async () => source))
      .rejects.toThrow(/Nonliteral dynamic composition import in \/fixture\/story\.tsx at offset \d+/);
  });

  test("fail rather than report missing or invalid local source as unused", async () => {
    const graph = new Map([["/fixture/story.tsx", 'import { Missing } from "@/client/missing";']]);
    await expect(walkCompositionUiImports("story.tsx", "/fixture", async (file) => graph.get(file)))
      .rejects.toThrow("Couldn't resolve composition import");
    await expect(walkCompositionUiImports("story.tsx", "/fixture", async () => 'import { from "./invalid";'))
      .rejects.toThrow();
  });

  test("the virtual module exports the same computed unused list as the coverage check", async () => {
    const plugin = libraryImportsPlugin();
    if (typeof plugin.resolveId !== "function" || typeof plugin.load !== "function") throw new Error("Missing virtual module hooks");
    const id = Reflect.apply(plugin.resolveId, undefined, ["virtual:composition-coverage"]);
    expect(id).toBe("\u0000virtual:composition-coverage");
    expect(await Reflect.apply(plugin.load, { addWatchFile() {} }, [id]))
      .toBe(`export const notUsedInProduct = ${JSON.stringify(expectedNotUsedInProduct)};`);
  }, 15_000);

  test("coverage is lazy, cached across concurrent loads and recomputed after a source edit", async () => {
    let names: string[] = [];
    let fail = false;
    let computations = 0;
    const plugin = libraryImportsPlugin("/fixture", async () => {
      computations += 1;
      if (fail) throw new Error("Coverage failed");
      return names;
    });
    const watcher = Object.assign(new EventEmitter(), { add: (_path: unknown) => {} });
    const server = { watcher, moduleGraph: { getModuleById: () => undefined }, ws: { send() {} } };
    if (typeof plugin.configureServer !== "function" || typeof plugin.load !== "function" || typeof plugin.closeBundle !== "function") {
      throw new Error("Missing coverage hooks");
    }
    const loadCoverage = plugin.load;
    const load = async (): Promise<unknown> => {
      const result: unknown = await Reflect.apply(loadCoverage, { addWatchFile() {} }, ["\u0000virtual:composition-coverage"]);
      return result;
    };
    try {
      Reflect.apply(plugin.configureServer, undefined, [server]);
      expect(await Reflect.apply(plugin.load, {}, ["unrelated-story.tsx"])).toBeUndefined();
      expect(computations).toBe(0);
      const code = "export const notUsedInProduct = [];";
      expect(await Promise.all([load(), load()])).toEqual([code, code]);
      expect(computations).toBe(1);
      names = ["button"];
      expect(await load()).toBe(code);
      expect(computations).toBe(1);
      watcher.emit("change", "/fixture/app/page.tsx");
      expect(await load()).toBe('export const notUsedInProduct = ["button"];');
      expect(computations).toBe(2);
      fail = true;
      watcher.emit("change", "/fixture/app/page.tsx");
      await expect(load()).rejects.toThrow("Coverage failed");
      fail = false;
      names = [];
      expect(await load()).toBe(code);
      expect(computations).toBe(4);
    } finally {
      Reflect.apply(plugin.closeBundle, undefined, []);
    }
  });

  test("real source edits and composition additions invalidate the coverage module, then unsubscribe", () => {
    const plugin = libraryImportsPlugin("/fixture");
    const watcher = Object.assign(new EventEmitter(), { add: (_path: unknown) => {} });
    const node = {};
    const invalidated: unknown[] = [];
    const messages: unknown[] = [];
    const server = { watcher, moduleGraph: {
      getModuleById: (id: string) => id === "\u0000virtual:composition-coverage" ? node : undefined,
      invalidateModule: (value: unknown) => { invalidated.push(value); },
    }, ws: { send: (message: unknown) => { messages.push(message); } } };
    if (typeof plugin.configureServer !== "function" || typeof plugin.closeBundle !== "function") throw new Error("Missing watcher hooks");
    Reflect.apply(plugin.configureServer, undefined, [server]);
    watcher.emit("change", "/fixture/client/home.tsx");
    watcher.emit("add", "/fixture/stories/review/compositions/new.stories.tsx");
    watcher.emit("unlink", "/fixture/components/ui/input.tsx");
    watcher.emit("add", "/fixture/app/admin/page.tsx");
    watcher.emit("change", "/elsewhere/client/home.tsx");
    watcher.emit("change", "/fixture/node_modules/package/index.ts");
    expect(invalidated).toEqual([node, node, node, node]);
    expect(messages).toEqual(Array(4).fill({ type: "full-reload" }));
    Reflect.apply(plugin.closeBundle, undefined, []);
    watcher.emit("change", "/fixture/client/home.tsx");
    expect(invalidated).toHaveLength(4);
  });

  for (const [name, source, covered] of [
    ["inline type-only", 'import { type InputOTP } from "@/components/ui/input-otp";', false],
    ["all inline type-only", 'import { type InputOTP, type InputOTPGroup } from "@/components/ui/input-otp";', false],
    ["statement type-only", 'import type { InputOTP } from "@/components/ui/input-otp";', false],
    ["default type-only", 'import type InputOTP from "@/components/ui/input-otp";', false],
    ["mixed default", 'import InputOTP, { type InputOTPGroup } from "@/components/ui/input-otp";', true],
    ["mixed named", 'import { type InputOTPGroup, InputOTP } from "@/components/ui/input-otp";', true],
    ["namespace", 'import * as OTP from "@/components/ui/input-otp";', true],
    ["multiline commented", 'import { /* type */ InputOTP,\n type InputOTPGroup } from\n "@/components/ui/input-otp";', true],
    ["empty", 'import {} from "@/components/ui/input-otp";', false],
    ["side effect", 'import "@/components/ui/input-otp";', false],
  ] satisfies [string, string, boolean][]) {
    test(`coverage counts value bindings only: ${name}`, async () => {
      expect(await lexCompositionUiImports(source, "probe.stories.tsx")).toEqual(covered ? ["input-otp"] : []);
    });
  }

  test("the covering core has eight tiles and contiguous screen orders", async () => {
    const expected = [
      ["home", ["Home", "HomeLoading"]],
      ["invest", ["Invest", "SearchToOrbitDetail"]],
      ["card-onboarding", ["Active", "CardOnboarding"]],
      ["coverage", ["Coverage"]],
      ["operator", ["Operator"]],
    ] as const;
    let count = 0;
    for (const [index, [file, names]] of expected.entries()) {
      const storyModule: Record<string, unknown> = await import(`@/stories/review/compositions/${file}.stories.tsx`);
      expect(Object.keys(storyModule).filter((name) => name !== "default").sort()).toEqual([...names].sort());
      expect(requireStoryMeta(storyModule).parameters?.library?.order).toBe(index + 1);
      count += names.length;
    }
    expect(count).toBe(8);
  });

  test("render each composition in its own frame", async () => {
    const files = [...new Bun.Glob("stories/review/compositions/*.stories.tsx").scanSync({ cwd: root })].sort();
    for (const file of files) {
      const meta = requireStoryMeta(await import(`@/${file}`));
      expect(meta.title.startsWith("Compositions/")).toBe(true);
      expect(meta.parameters?.library?.render).toBe("frame");
    }
  });
});
