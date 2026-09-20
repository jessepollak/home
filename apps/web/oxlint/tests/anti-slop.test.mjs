import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-anti-slop-"));
const outsideRoot = await mkdtemp(path.join(tmpdir(), "home-oxlint-outside-root-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(async () => Promise.all([
  rm(mirror, { recursive: true, force: true }),
  rm(outsideRoot, { recursive: true, force: true }),
]));

let fixtureIndex = 0;
async function lint(rule, code, relativePath = "client") {
  fixtureIndex += 1;
  const fixture = /\.[cm]?[jt]sx?$/u.test(relativePath)
    ? relativePath
    : path.join(relativePath, `fixture-${fixtureIndex}.ts`);
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await mkdir(path.dirname(path.join(mirror, fixture)), { recursive: true });
  await writeFile(path.join(mirror, fixture), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { [`home/${rule}`]: "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  return diagnostics.filter((diagnostic) => diagnostic.code === `home(${rule})`);
}

async function lintOutsideRoot(rule, code) {
  fixtureIndex += 1;
  const fixture = path.join(outsideRoot, "collision/apps/web/tests/server-only-preload.ts");
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await mkdir(path.dirname(fixture), { recursive: true });
  await writeFile(fixture, code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { [`home/${rule}`]: "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === `home(${rule})`);
}

async function expectHits(rule, code, count = 1, relativePath) {
  expect(await lint(rule, code, relativePath)).toHaveLength(count);
}

async function expectClean(rule, code, relativePath) {
  expect(await lint(rule, code, relativePath)).toHaveLength(0);
}

describe("existing anti-slop rules", () => {
  it("rejects mixed chained assertions, including parentheses and angle syntax", async () => {
    await expectHits("no-chained-type-assertions", "const value = input as unknown as User;");
    await expectHits("no-chained-type-assertions", "const value = (input as unknown) as User;");
    await expectHits("no-chained-type-assertions", "const value = <User>(<unknown>input);");
    await expectClean("no-chained-type-assertions", "const value = ({ id: 1 } as const) as const;");
  });

  it("keeps direct Reflect, parameter, and alias policies isolated", async () => {
    await expectHits("no-reflect-indirection", "Reflect.get(value, 'id'); Reflect.apply(fn, null, []);", 2);
    await expectClean("no-reflect-indirection", "value.id; fn();");
    await expectHits("no-vague-object-parameters", "function read(value: object) { return value; }");
    await expectClean("no-vague-object-parameters", "function read(value: { id: string }) { return value.id; }");
    await expectHits("no-unknown-aliases", "type Payload = unknown;");
    await expectClean("no-unknown-aliases", "type Payload = { id: string };");
  });

  it("resolves direct, aliased, namespace, computed, and immutable Bun mock bindings", async () => {
    await expectHits("exact-mock-modules", `
      import { mock as bunMock } from "bun:test";
      import * as bunTest from "bun:test";
      const alias = bunMock;
      const namespaceAlias = bunTest;
      const { mock: destructuredAlias } = bunTest;
      bunMock.module("unreviewed", () => ({}));
      bunTest.mock.module("unreviewed", () => ({}));
      alias["module"]("unreviewed", () => ({}));
      namespaceAlias["mock"].module("unreviewed", () => ({}));
      destructuredAlias.module("unreviewed", () => ({}));
    `, 5, "tests");
  });

  it("ignores unrelated, shadowed, and mutable mock lookalikes", async () => {
    await expectClean("exact-mock-modules", `
      import { mock as bunMock } from "bun:test";
      const mock = { module() {} };
      mock.module("unreviewed", () => ({}));
      function run(bunMock: { module(name: string, factory: () => object): void }) {
        bunMock.module("unreviewed", () => ({}));
      }
      let mutableAlias = bunMock;
      mutableAlias = mock;
      mutableAlias.module("unreviewed", () => ({}));
      run(mock);
    `, "tests");
  });

  it("uses exact canonical paths and still rejects dynamic module names", async () => {
    await expectClean("exact-mock-modules", "import { mock } from 'bun:test'; mock.module('server-only', () => ({}));", "tests/server-only-preload.ts");
    await expectHits("exact-mock-modules", "import { mock } from 'bun:test'; mock.module('server-only', () => ({}));", 1, "nested/tests/server-only-preload.ts");
    await expectHits("exact-mock-modules", "import { mock } from 'bun:test'; const name = 'server-only'; mock.module(name, () => ({}));", 1, "tests/server-only-preload.ts");
  });

  it("never derives an approved identity from an absolute path outside cwd", async () => {
    const diagnostics = await lintOutsideRoot(
      "exact-mock-modules",
      "import { mock } from 'bun:test'; mock.module('server-only', () => ({}));",
    );
    expect(diagnostics).toHaveLength(1);
  });
});

describe("reducer accumulation rules", () => {
  it("recognizes reducer variants, immutable aliases, and nested returns for spread", async () => {
    await expectHits("no-reducer-accumulator-spread", "items.reduceRight((acc, item) => ({ ...acc, [item.id]: item }), {});");
    await expectHits("no-reducer-accumulator-spread", "items['reduce']((acc, item) => { const alias = acc; if (item) { return { ...alias }; } return acc; }, {});");
    await expectHits("no-reducer-accumulator-spread", "items.reduce((acc, item) => { const alias = acc; return [[{ ...alias }]]; }, {});");
    await expectClean("no-reducer-accumulator-spread", "items.reduce((acc, item) => ({ ...item }), {});");
    await expectClean("no-reducer-accumulator-spread", "items.reduce((acc, item) => { const alias = item; return { ...alias }; }, {});");
    await expectClean("no-reducer-accumulator-spread", "function merge(acc, item) { return { ...acc, item }; } items.reduce(merge, {});");
  });

  it("rejects Object.assign and Array.from accumulator copies", async () => {
    await expectHits("no-reduce-accumulator-copy", "items.reduce((acc, item) => Object.assign({}, acc, item), {});");
    await expectHits("no-reduce-accumulator-copy", "items['reduceRight']((acc, item) => { const alias = acc; if (item) return Array['from'](alias); return acc; }, []);");
    await expectClean("no-reduce-accumulator-copy", "items.reduce((acc, item) => Object.assign(acc, item), {});");
    await expectClean("no-reduce-accumulator-copy", "items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);");
    await expectClean("no-reduce-accumulator-copy", "const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});");
    await expectClean("no-reduce-accumulator-copy", "const Array = custom; items.reduce((acc, item) => Array.from(acc), []);");
    await expectClean("no-reduce-accumulator-copy", "function copy(acc) { return Object.assign({}, acc); } items.reduce(copy, {});");
  });

  it("rejects all bounded array copy methods only with array evidence", async () => {
    for (const expression of [
      "acc.concat(item)",
      "acc.slice()",
      "acc.toSpliced(0, 0, item)",
      "acc.toSorted()",
      "acc.toReversed()",
      "acc.with(0, item)",
    ]) await expectHits("no-reduce-accumulator-copy", `items.reduce((acc, item) => ${expression}, []);`);
    await expectHits("no-reduce-accumulator-copy", "const initial: Item[] = []; items.reduceRight((acc, item) => { const alias = acc; return alias['concat'](item); }, initial);");
    await expectClean("no-reduce-accumulator-copy", "items.reduce((acc, item) => acc.concat(item), '');");
    await expectClean("no-reduce-accumulator-copy", "items.reduce((acc, item) => acc.concat(item), customCollection);");
    await expectClean("no-reduce-accumulator-copy", "items.reduce((acc, item) => item.slice(), []);");
    await expectClean("no-reduce-accumulator-copy", "items.reduce((acc, item) => { let alias = acc; alias = item; return alias.concat(item); }, []);");
  });
});

describe("no-widen-then-assert", () => {
  it("reports known evidence widened through every approved broad type", async () => {
    await expectHits("no-widen-then-assert", "const source = { id: 'x' }; const erased: unknown = source; const value = erased as { id: string };");
    await expectHits("no-widen-then-assert", "const source = { id: 'x' }; const erased: any = source; const value = <{ id: string }>(erased);");
    await expectHits("no-widen-then-assert", "const source = { id: 'x' }; const erased: object = source; const value = (erased) as typeof source;");
    await expectHits("no-widen-then-assert", "const source = { id: 'x' }; const erased: Record<string, unknown> = source; const value = erased as Record<'id', string>;");
    await expectHits("no-widen-then-assert", "const source = { id: 'x' }; const erased = source as unknown; const value = erased as { id: string };");
  });

  it("keeps genuine boundaries, validation, mutation, and function boundaries clean", async () => {
    await expectClean("no-widen-then-assert", "declare const input: unknown; const value = input as { id: string };");
    await expectClean("no-widen-then-assert", "declare const input: unknown; const erased: unknown = input; const value = erased as { id: string };");
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; let erased: unknown = source; erased = read(); const value = erased as { id: string };");
    await expectClean("no-widen-then-assert", "let source: { id: string } = { id: 'x' }; const erased: unknown = source; source = { id: 'y' }; const value = erased as { id: string };");
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; const erased: unknown = source; function later() { return erased as { id: string }; }");
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; const erased: unknown = source; if (isPayload(erased)) use(erased);");
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; const checked = source satisfies Record<string, unknown>;");
  });

  it("does not report direct or same-width assertions", async () => {
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; const value = source as { id: string };");
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; const erased: unknown = source; const value = erased as any;");
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; const erased: object = source; const value = erased as object;");
    await expectClean("no-widen-then-assert", "const source = { id: 'x' }; const erased: Record<string, unknown> = source; const value = erased as Readonly<Record<string, unknown>>;");
  });

  it("keeps runtime-keyed maps and mutable Record fixtures clean", async () => {
    await expectClean("no-widen-then-assert", "const byRuntimeKey: Record<string, Item> = {}; for (const item of items) byRuntimeKey[item.id] = item;");
    await expectClean("no-widen-then-assert", "const submissions: Record<string, string>[] = []; submissions.push(Object.fromEntries(new FormData(form)) as Record<string, string>);");
  });
});
